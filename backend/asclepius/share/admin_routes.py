"""Admin-side share management endpoints.

Mounted under ``/api/shares``. Every endpoint requires a regular logged-in
user with admin role on the system OR owner role on the relevant patient.
The admin sees the raw share token exactly once (in the create response)
and the live OTP code through the audit endpoint — both flow back through
this router and never reach the doctor's surface.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from asclepius.audit.service import audit_log, get_client_ip
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access
from asclepius.share import service as share_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────


class ShareCreateRequest(BaseModel):
    patient_id: int
    document_ids: list[int] = Field(min_length=1, max_length=200)
    recipient_label: str = Field(min_length=1, max_length=200)
    recipient_contact: str = Field(min_length=1, max_length=200)
    expires_in_days: int = Field(default=7, ge=1, le=90)
    # Provider preferences. Both optional — null falls back to the
    # system's first-enabled provider at translate time, which keeps
    # parity with the admin-side translate flow.
    default_ocr_provider_id: str | None = None
    default_llm_provider_id: str | None = None


class ShareCreateResponse(BaseModel):
    share_id: int
    share_url: str
    expires_at: str


# ── Helpers ──────────────────────────────────────────────────────


async def _require_admin_or_owner(
    db: aiosqlite.Connection, current_user: dict, patient_id: int
) -> None:
    """Admin systemwide or 'owner' on this patient may create/manage shares.

    Plain ``editor`` is intentionally NOT enough — sharing PHI to an
    outside party is a privileged action even when the user can otherwise
    edit the document.
    """
    if current_user.get("role") == "admin":
        return
    role = await check_patient_access(db, current_user["id"], patient_id)
    if role == "owner":
        return
    raise HTTPException(
        status_code=403,
        detail="Only admins or the patient owner may create shares",
    )


def _build_share_url(request: Request, raw_token: str) -> str:
    """Construct the absolute share URL we hand back to the admin.

    In split-mode deployments the admin and the doctor reach different
    hostnames; ``share.public_base_url`` (env: ``ASCLEPIUS_SHARE_PUBLIC_URL``)
    pins every generated link to the doctor-facing origin regardless of
    which host the admin used. When unset, fall back to the admin's
    request origin so single-address setups keep working unchanged.
    """
    cfg = get_config()
    public_base = (cfg.share.public_base_url or "").rstrip("/")
    if public_base:
        return f"{public_base}/share/{raw_token}"
    origin = ""
    host = request.headers.get("host")
    if host:
        # FastAPI's request.url.scheme respects forwarded-proto when set.
        origin = f"{request.url.scheme}://{host}"
    return f"{origin}/share/{raw_token}"


# ── Endpoints ────────────────────────────────────────────────────


@router.post("", response_model=ShareCreateResponse)
async def create_share(
    body: ShareCreateRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
) -> ShareCreateResponse:
    """Create a curated share. Returns the raw share URL — shown once."""
    await _require_admin_or_owner(db, current_user, body.patient_id)

    # Enforce: every requested document belongs to the share's patient.
    placeholders = ",".join(["?"] * len(body.document_ids))
    cursor = await db.execute(
        f"""SELECT id FROM documents
             WHERE id IN ({placeholders})
               AND patient_id = ?""",
        (*body.document_ids, body.patient_id),
    )
    valid_ids = {row[0] for row in await cursor.fetchall()}
    invalid = [i for i in body.document_ids if i not in valid_ids]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Documents do not belong to patient {body.patient_id}: {invalid}",
        )

    cfg = get_config()
    expires_at = (datetime.utcnow() + timedelta(days=body.expires_in_days)).isoformat(
        timespec="seconds"
    )

    share_id, raw_token = await share_service.create_share(
        db,
        patient_id=body.patient_id,
        document_ids=body.document_ids,
        recipient_label=body.recipient_label.strip(),
        recipient_contact=body.recipient_contact.strip(),
        expires_at_iso=expires_at,
        created_by_user_id=current_user["id"],
        default_ocr_provider_id=body.default_ocr_provider_id,
        default_llm_provider_id=body.default_llm_provider_id,
    )

    await audit_log(
        db,
        current_user["id"],
        "share.create",
        resource_type="share",
        resource_id=share_id,
        details={
            "patient_id": body.patient_id,
            "document_count": len(body.document_ids),
            "recipient_label": body.recipient_label,
            "expires_in_days": body.expires_in_days,
        },
        ip_address=get_client_ip(request),
    )

    # Make a noop reference to cfg to keep imports tidy if we later
    # gate share creation on a config flag.
    _ = cfg

    return ShareCreateResponse(
        share_id=share_id,
        share_url=_build_share_url(request, raw_token),
        expires_at=expires_at,
    )


@router.get("")
async def list_shares(
    request: Request,
    patient_id: int | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List shares.

    With ``patient_id``: scoped to that patient (admin/owner only — same
    permission gate as creation).

    Without ``patient_id``: all shares the caller can manage. Admins see
    everything; non-admins see only shares for patients they own.

    Each row carries a ``share_url`` decorated with the current public
    base URL so the dashboard's "Copy link" button hands the admin the
    *doctor-facing* URL even when the admin is logged in on the LAN
    host. Falls back to ``request.url.scheme + host`` when
    ``share.public_base_url`` is empty.
    """
    if patient_id is not None:
        await _require_admin_or_owner(db, current_user, patient_id)
        rows = await share_service.list_shares_for_patient(db, patient_id)
    else:
        rows = await share_service.list_shares_for_user(db, current_user)
    for row in rows:
        token = row.get("token_clear")
        if token:
            row["share_url"] = _build_share_url(request, token)
        else:
            row["share_url"] = None
    return rows


@router.delete("/{share_id}")
async def revoke_share(
    share_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    await _require_admin_or_owner(db, current_user, share["patient_id"])
    await share_service.revoke_share(db, share_id)
    await audit_log(
        db,
        current_user["id"],
        "share.revoke",
        resource_type="share",
        resource_id=share_id,
        ip_address=get_client_ip(request),
    )
    return {"ok": True}


@router.get("/{share_id}/audit")
async def share_audit(
    share_id: int,
    include_active_otp: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Return the audit trail for a share. When ``include_active_otp`` is
    set, also surface the live OTP code so the admin can convey it to the
    doctor over a separate channel (phone, in-person)."""
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    await _require_admin_or_owner(db, current_user, share["patient_id"])

    payload: dict = {
        "share": {
            "id": share["id"],
            "patient_id": share["patient_id"],
            "recipient_label": share["recipient_label"],
            "recipient_contact": share["recipient_contact"],
            "expires_at": share["expires_at"],
            "revoked_at": share["revoked_at"],
            "created_at": share["created_at"],
        },
        "events": await share_service.list_audit(db, share_id),
    }
    if include_active_otp:
        payload["active_otp"] = await share_service.get_active_otp_clear(db, share_id)
    return payload


@router.get("/{share_id}/active-otp")
async def share_active_otp(
    share_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Return only the live OTP code for a share, if any.

    Faster than ``/{id}/audit?include_active_otp=true`` because it
    skips the audit-event listing — the dashboard hits this every time
    the admin clicks "Show active code", so it must be cheap.

    Response shape: ``{"active_otp": null}`` when no code is live, or
    ``{"active_otp": {"code": ..., "expires_at": ..., "attempts": ...}}``.
    """
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    await _require_admin_or_owner(db, current_user, share["patient_id"])
    return {"active_otp": await share_service.get_active_otp_clear(db, share_id)}


@router.get("/{share_id}/documents")
async def share_document_list(
    share_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Lightweight admin view of the share's document membership.

    Returns the same JOIN shape the doctor sees so the admin can preview
    exactly what was shared without opening a doctor session.
    """
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    await _require_admin_or_owner(db, current_user, share["patient_id"])
    return await share_service.share_documents(db, share_id)
