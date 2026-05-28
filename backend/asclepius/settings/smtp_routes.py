"""SMTP diagnostic endpoint.

A single admin-only POST that fires the existing :func:`send_test_email`
helper against the current in-memory SMTP settings. Kept in its own
module so the main settings router stays focused on the flat get/patch
blob (same separation as ``backup_routes.py``).
"""

from __future__ import annotations

import logging

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from asclepius.audit.service import audit_log, get_client_ip
from asclepius.auth.session import require_role
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.email import EmailSendError, send_test_email

logger = logging.getLogger(__name__)

router = APIRouter()


class SmtpTestRequest(BaseModel):
    # Free-form length cap large enough for any real address; lower
    # bound 3 because "a@b" is the shortest theoretically-valid mailbox
    # the server-side regex would accept anyway.
    to: str = Field(min_length=3, max_length=320)


@router.post("/smtp/test")
async def smtp_test(
    body: SmtpTestRequest,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Send a fixed diagnostic message to ``body.to``.

    Returns ``{"ok": true}`` on success, or a 400/502 with a short
    error description on failure. The SMTP server's raw response is
    never returned — we only surface the underlying exception's class
    name so the admin learns the failure mode without giving an
    attacker a way to fingerprint internal infrastructure.
    """
    cfg = get_config()
    if not cfg.smtp.enabled:
        raise HTTPException(status_code=400, detail="SMTP is disabled in settings.")

    try:
        await send_test_email(cfg, to=body.to.strip())
    except EmailSendError as exc:
        await audit_log(
            db,
            current_user["id"],
            "settings.smtp_test",
            "settings",
            details={"to_domain": _domain_or_empty(body.to), "ok": False, "cause": exc.cause_class},
            ip_address=get_client_ip(request),
        )
        raise HTTPException(
            status_code=502,
            detail=f"SMTP test failed: {exc.cause_class}",
        )

    await audit_log(
        db,
        current_user["id"],
        "settings.smtp_test",
        "settings",
        details={"to_domain": _domain_or_empty(body.to), "ok": True},
        ip_address=get_client_ip(request),
    )
    return {"ok": True}


def _domain_or_empty(addr: str) -> str:
    """Audit-safe slice of the test recipient — domain only."""
    addr = (addr or "").strip()
    if "@" not in addr:
        return ""
    return addr.split("@", 1)[1].lower()
