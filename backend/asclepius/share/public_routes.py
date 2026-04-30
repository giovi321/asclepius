"""Public, unauthenticated endpoints for the doctor share flow.

Mounted under ``/api/share`` (note the singular, vs. admin's plural
``/api/shares``). These are the only share endpoints reachable without a
prior cookie:

  - POST /share/{token}/request-otp   – issues an OTP, surfaces no detail
  - POST /share/{token}/verify-otp    – exchanges code for a session cookie
  - POST /share/logout                – revokes whatever session is held

Token validity (active, not expired, not revoked) is checked on every
call so a leaked URL stops working the moment the admin revokes the
share.
"""

from __future__ import annotations

import logging

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from asclepius.audit.service import get_client_ip
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.share import service as share_service
from asclepius.share.cookies import clear_share_cookie, set_share_cookie
from asclepius.share.dependencies import SHARE_COOKIE_NAME
from asclepius.share.rate_limit import otp_request_allowed

logger = logging.getLogger(__name__)

router = APIRouter()


class VerifyOtpRequest(BaseModel):
    code: str = Field(min_length=4, max_length=12)


@router.post("/{token}/request-otp", status_code=204)
async def request_otp(
    token: str,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Generate and store a fresh OTP for this share.

    The doctor sees only ``204 No Content`` — they receive the actual
    code from the admin out-of-band. This intentionally does not leak
    whether the token resolves to a real share: an invalid token returns
    the same shape, but no audit/OTP rows are created.
    """
    cfg = get_config()
    ip = get_client_ip(request) or "unknown"

    share = await share_service.get_share_by_token(db, token)
    if not share or not share_service.is_share_active(share):
        # Constant-shape response — leaks nothing about token validity.
        return Response(status_code=204)

    token_hash = share["token_hash"]
    if not otp_request_allowed(token_hash, ip):
        raise HTTPException(
            status_code=429,
            detail="Too many OTP requests. Try again later.",
        )

    await share_service.issue_otp(
        db,
        share_id=share["id"],
        ttl_minutes=cfg.share.otp_ttl_minutes,
    )
    await share_service.write_audit(
        db,
        share_id=share["id"],
        action="otp_request",
        client_ip=ip,
        user_agent=request.headers.get("user-agent"),
    )
    return Response(status_code=204)


@router.post("/{token}/verify-otp")
async def verify_otp(
    token: str,
    body: VerifyOtpRequest,
    request: Request,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Exchange a valid OTP for a session cookie.

    On success a row is written to ``document_share_sessions`` and the
    ``asclepius_share`` cookie is set with ``max_age = session TTL``.
    """
    cfg = get_config()
    ip = get_client_ip(request) or "unknown"
    user_agent = request.headers.get("user-agent")

    share = await share_service.get_share_by_token(db, token)
    if not share or not share_service.is_share_active(share):
        raise HTTPException(status_code=401, detail="Invalid or expired share")

    ok = await share_service.verify_otp(
        db,
        share_id=share["id"],
        code=body.code.strip(),
        max_attempts=cfg.share.otp_max_attempts,
    )
    if not ok:
        await share_service.write_audit(
            db,
            share_id=share["id"],
            action="otp_verify_fail",
            client_ip=ip,
            user_agent=user_agent,
        )
        raise HTTPException(status_code=401, detail="Invalid or expired code")

    sid, expires_at = await share_service.create_session(
        db,
        share_id=share["id"],
        ttl_minutes=cfg.share.session_ttl_minutes,
        client_ip=ip,
        user_agent=user_agent,
    )
    set_share_cookie(
        response,
        sid,
        config=cfg,
        max_age=cfg.share.session_ttl_minutes * 60,
    )
    await share_service.write_audit(
        db,
        share_id=share["id"],
        action="otp_verify_ok",
        session_id=sid,
        client_ip=ip,
        user_agent=user_agent,
    )
    return {
        "ok": True,
        "expires_at": expires_at,
        "recipient_label": share["recipient_label"],
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Revoke the current share session and clear its cookie.

    Idempotent: if no cookie is set we still clear and return 200 so the
    UI can call this on hard navigation away.
    """
    cfg = get_config()
    sid = request.cookies.get(SHARE_COOKIE_NAME)
    if sid:
        try:
            session = await share_service.get_session(db, sid)
            await share_service.revoke_session(db, sid)
            if session:
                await share_service.write_audit(
                    db,
                    share_id=session["share_id"],
                    action="logout",
                    session_id=sid,
                    client_ip=get_client_ip(request),
                    user_agent=request.headers.get("user-agent"),
                )
        except Exception:
            # Best effort. Cookie clear must always succeed.
            logger.debug("share logout cleanup failed", exc_info=True)
    clear_share_cookie(response, config=cfg)
    return {"ok": True}
