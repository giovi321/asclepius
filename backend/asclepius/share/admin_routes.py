"""Admin-side share management endpoints.

Mounted under ``/api/shares``. Every endpoint requires a regular logged-in
user with admin role on the system OR owner role on the relevant patient.
The admin sees the raw share token exactly once (in the create response)
and the live OTP code through the audit endpoint — both flow back through
this router and never reach the doctor's surface.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from asclepius.audit.service import audit_log, get_client_ip
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access
from asclepius.share import service as share_service

# Same shape as the regex in asclepius.email.sender — duplicated here to
# avoid the admin route pulling in the email package at import time.
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

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
    # 'manual' (legacy default): the OTP is shown to the admin in the
    # dashboard and they convey it out-of-band. 'email': the OTP is
    # sent automatically to ``recipient_contact``; requires SMTP to be
    # enabled in settings and ``recipient_contact`` to be a valid email.
    otp_delivery: Literal["manual", "email"] = "manual"


class ShareCreateResponse(BaseModel):
    share_id: int
    share_url: str
    expires_at: str


class ShareAddDocumentsRequest(BaseModel):
    document_ids: list[int] = Field(min_length=1, max_length=200)


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

    # Email delivery requires SMTP to be configured and the recipient
    # contact to actually look like an email. Fail fast at create time
    # so the admin learns immediately instead of when the doctor first
    # hits ``request-otp``.
    if body.otp_delivery == "email":
        if not cfg.smtp.enabled:
            raise HTTPException(
                status_code=400,
                detail="Email OTP delivery requires SMTP to be enabled in settings",
            )
        if not _EMAIL_RE.match(body.recipient_contact.strip()):
            raise HTTPException(
                status_code=400,
                detail="Recipient contact must be a valid email address for email delivery",
            )

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
        otp_delivery=body.otp_delivery,
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
            "otp_delivery": body.otp_delivery,
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


@router.post("/{share_id}/documents")
async def add_share_documents(
    share_id: int,
    body: ShareAddDocumentsRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Add documents to an existing share.

    Lets the admin build a share across several filter/search views: pick
    a subset, add it here, change the filter, add the next subset to the
    same share — without having to get every document into one filtered
    list at once.

    Same guard rails as creation: admin or patient-owner only, and every
    document must belong to the share's patient. Adding to a revoked share
    is refused (revive by creating a fresh one). Documents already on the
    share are silently skipped.
    """
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    await _require_admin_or_owner(db, current_user, share["patient_id"])

    if share.get("revoked_at"):
        raise HTTPException(
            status_code=400,
            detail="Cannot add documents to a revoked share. Create a new share instead.",
        )

    # Every requested document must belong to the share's patient — same
    # invariant enforced at creation time.
    placeholders = ",".join(["?"] * len(body.document_ids))
    cursor = await db.execute(
        f"""SELECT id FROM documents
             WHERE id IN ({placeholders})
               AND patient_id = ?""",
        (*body.document_ids, share["patient_id"]),
    )
    valid_ids = {row[0] for row in await cursor.fetchall()}
    invalid = [i for i in body.document_ids if i not in valid_ids]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Documents do not belong to patient {share['patient_id']}: {invalid}",
        )

    result = await share_service.add_share_documents(db, share_id, body.document_ids)

    await audit_log(
        db,
        current_user["id"],
        "share.documents.add",
        resource_type="share",
        resource_id=share_id,
        details={
            "patient_id": share["patient_id"],
            "requested": len(body.document_ids),
            "added": result["added"],
            "already_present": result["already_present"],
        },
        ip_address=get_client_ip(request),
    )
    return {"share_id": share_id, **result}


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


@router.delete("/{share_id}/purge")
async def purge_share(
    share_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Permanently delete a share and its dependent rows from the DB.

    Unlike :func:`revoke_share` (which keeps the row, flagged revoked, so
    it still shows on the dashboard), this removes the share, its
    document membership, OTPs, sessions, queue entries, and audit trail
    entirely. Used to clean up old/stale shares — including legacy rows
    that predate the revoke feature. Any live doctor session dies with
    the cascade on the next request.
    """
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    # ``patient_id`` is NOT NULL and cascades on patient delete, so a live
    # share always has a resolvable patient for the ownership check even
    # when ``created_by_user_id`` points at a deleted user.
    await _require_admin_or_owner(db, current_user, share["patient_id"])
    await share_service.delete_share(db, share_id)
    await audit_log(
        db,
        current_user["id"],
        "share.delete",
        resource_type="share",
        resource_id=share_id,
        details={"patient_id": share["patient_id"]},
        ip_address=get_client_ip(request),
    )
    return {"deleted": True}


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
    # Defense in depth: for email-delivery shares we never persist
    # otp_clear, so this would return None anyway. Short-circuit so
    # the API contract is explicit and a future bug that accidentally
    # writes otp_clear for these shares still doesn't leak.
    if share.get("otp_delivery") == "email":
        return {"active_otp": None}
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


@router.get("/{share_id}/sessions")
async def share_sessions(
    share_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Currently-active doctor session(s) and queued waiters for a share.

    Active sessions are filtered by ``revoked_at IS NULL`` and TTL; the
    ``is_idle`` flag tells the admin whether the queue treats the row as
    a free slot. Queue rows are filtered by their own TTL.

    The session row's primary key (which doubles as the cookie value) is
    intentionally NOT returned — the admin's terminate action keys on
    SQLite ``rowid`` instead, so an exfiltrated API response cannot be
    replayed as an authentication token.
    """
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    await _require_admin_or_owner(db, current_user, share["patient_id"])

    cfg = get_config()
    active = await share_service.list_active_sessions_for_share(
        db, share_id, idle_timeout_minutes=cfg.share.idle_timeout_minutes
    )
    queued = await share_service.list_queued_for_share(db, share_id)
    return {"active": active, "queued": queued}


@router.delete("/{share_id}/sessions/{rowid}")
async def share_revoke_session(
    share_id: int,
    rowid: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Force-terminate a specific doctor session for this share.

    Idempotent: revoking an already-revoked row is a no-op. The next
    request the doctor makes is rejected with 401 and they bounce back
    to the landing page; queued waiters can immediately claim the slot.
    """
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    await _require_admin_or_owner(db, current_user, share["patient_id"])

    revoked = await share_service.revoke_session_by_rowid(db, share_id, rowid)
    await audit_log(
        db,
        current_user["id"],
        "share.session.revoke",
        resource_type="share",
        resource_id=share_id,
        details={"session_rowid": rowid, "revoked": revoked},
        ip_address=get_client_ip(request),
    )
    return {"revoked": revoked}


@router.delete("/{share_id}/queue/{rowid}")
async def share_drop_queue(
    share_id: int,
    rowid: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Drop a queued waiter for this share. Idempotent."""
    share = await share_service.get_share_by_id(db, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    await _require_admin_or_owner(db, current_user, share["patient_id"])

    deleted = await share_service.delete_queue_entry_by_rowid(db, share_id, rowid)
    await audit_log(
        db,
        current_user["id"],
        "share.queue.drop",
        resource_type="share",
        resource_id=share_id,
        details={"queue_rowid": rowid, "deleted": deleted},
        ip_address=get_client_ip(request),
    )
    return {"deleted": deleted}
