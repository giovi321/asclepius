"""Public, unauthenticated endpoints for the doctor share flow.

Mounted under ``/api/share`` (note the singular, vs. admin's plural
``/api/shares``). These are the only share endpoints reachable without a
prior session cookie:

  - POST /share/{token}/request-otp   – issues an OTP, surfaces no detail
  - POST /share/{token}/verify-otp    – exchanges code for a session cookie,
                                        OR mints a queue token if the
                                        share is currently bound to
                                        another live session.
  - POST /share/claim                  – called repeatedly by a queued
                                        doctor; promotes the queue
                                        token into a session once the
                                        active slot frees.
  - DELETE /share/queue                – explicit cancel from the
                                        waiting page.
  - POST /share/heartbeat              – cheap keepalive so the server's
                                        idle clock matches reality
                                        while the doctor is reading.
  - POST /share/logout                 – revokes whatever session is held.

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
from asclepius.email import EmailSendError, send_otp_email
from asclepius.share import service as share_service
from asclepius.share.cookies import (
    clear_share_cookie,
    clear_share_queue_cookie,
    set_share_cookie,
    set_share_queue_cookie,
)
from asclepius.share.dependencies import SHARE_COOKIE_NAME, SHARE_QUEUE_COOKIE_NAME
from asclepius.share.rate_limit import otp_request_allowed
from asclepius.share.service import OtpCooldownError

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

    delivery = share.get("otp_delivery") or "manual"
    user_agent = request.headers.get("user-agent")

    # Email-delivery shares get an extra rate-limit layer: a per-share
    # daily cap so a leaked URL cannot be used to flood the doctor's
    # inbox. The 30 s cooldown is enforced inside ``issue_otp`` (raises
    # ``OtpCooldownError``) which we surface as 429 with Retry-After.
    if delivery == "email":
        sent_today = await share_service.count_email_otps_today(db, share["id"])
        if sent_today >= cfg.share.email_otp_daily_cap:
            await share_service.write_audit(
                db,
                share_id=share["id"],
                action="otp_email_rate_limited",
                client_ip=ip,
                user_agent=user_agent,
                detail={"reason": "daily_cap", "cap": cfg.share.email_otp_daily_cap},
            )
            raise HTTPException(
                status_code=429,
                detail="Daily email OTP cap reached for this share.",
            )

    try:
        code = await share_service.issue_otp(
            db,
            share_id=share["id"],
            ttl_minutes=cfg.share.otp_ttl_minutes,
            delivery=delivery,
            cooldown_seconds=(
                cfg.share.email_otp_resend_cooldown_seconds if delivery == "email" else 0
            ),
        )
    except OtpCooldownError as e:
        raise HTTPException(
            status_code=429,
            detail="Please wait before requesting another code.",
            headers={"Retry-After": str(e.retry_after_seconds)},
        )

    await share_service.write_audit(
        db,
        share_id=share["id"],
        action="otp_request",
        client_ip=ip,
        user_agent=user_agent,
    )

    if delivery == "email":
        try:
            await send_otp_email(
                cfg,
                to=share["recipient_contact"],
                code=code,
                recipient_label=share.get("recipient_label") or "",
                expires_minutes=cfg.share.otp_ttl_minutes,
            )
        except EmailSendError as exc:
            await share_service.write_audit(
                db,
                share_id=share["id"],
                action="otp_email_failed",
                client_ip=ip,
                user_agent=user_agent,
                detail={"cause": exc.cause_class},
            )
            # 502: we accepted the request but the upstream (SMTP)
            # failed. The doctor's UI surfaces this so the practice
            # can fall back to manual delivery.
            raise HTTPException(
                status_code=502,
                detail="Could not deliver the access code by email. "
                "Ask your contact to switch this share to manual delivery.",
            )
        # Best-effort mask of the recipient address: first character of
        # the local-part only. Full address is on the share row already;
        # the audit detail does not need to duplicate it.
        contact = share.get("recipient_contact") or ""
        masked = (
            f"{contact[0]}***@{contact.split('@', 1)[1]}"
            if "@" in contact and contact
            else "(masked)"
        )
        await share_service.write_audit(
            db,
            share_id=share["id"],
            action="otp_email_sent",
            client_ip=ip,
            user_agent=user_agent,
            detail={"to_masked": masked},
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
    """Exchange a valid OTP for a session cookie OR a queue token.

    On success when the share has no live session, a row is written to
    ``document_share_sessions`` and the ``asclepius_share`` cookie is
    set with ``max_age = session TTL`` (returns ``status: "active"``).

    When the share is already bound to a live session on another device
    we instead mint a short-lived queue token, set
    ``asclepius_share_queue``, and return ``status: "queued"`` (HTTP
    202). The doctor's frontend then polls ``/claim`` until the active
    session dies (logout, idle, TTL, revocation).

    The OTP is consumed in either branch — the doctor proved possession
    of the code; whether they get the session immediately or have to
    wait depends on the share's state, not on the code's validity.
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
        # Share-level lockout: after N consecutive failed verifies on
        # the same share, revoke it. Applies to BOTH manual and email
        # delivery so a brute-force attempt over the wire kills the
        # share regardless of how the code was conveyed. The audit
        # ``reason`` distinguishes the two so the admin can tell at a
        # glance whether the failure was over the phone or over HTTP.
        failures = await share_service.bump_consecutive_failures(db, share["id"])
        if failures >= cfg.share.share_lockout_after_failed:
            delivery = share.get("otp_delivery") or "manual"
            await share_service.revoke_share(db, share["id"])
            await share_service.write_audit(
                db,
                share_id=share["id"],
                action="share.locked",
                client_ip=ip,
                user_agent=user_agent,
                detail={
                    "reason": f"otp_brute_force_{delivery}",
                    "failures": failures,
                },
            )
        raise HTTPException(status_code=401, detail="Invalid or expired code")
    # Successful verify resets the per-share counter so a doctor whose
    # session expires and re-OTPs months later does not inherit old
    # failed attempts from a previous (legitimate) typo.
    await share_service.reset_consecutive_failures(db, share["id"])

    # Cheap inline GC so the queue table does not grow unboundedly.
    await share_service.purge_expired_queue(db)

    active = await share_service.get_active_session_for_share(
        db,
        share["id"],
        idle_timeout_minutes=cfg.share.idle_timeout_minutes,
    )
    if active is not None:
        # Slot busy: hand back a queue token. The doctor's UI will poll
        # /claim until the active session dies.
        queue_token, queue_expires_at = await share_service.enqueue_for_share(
            db,
            share_id=share["id"],
            ttl_minutes=cfg.share.queue_ttl_minutes,
            client_ip=ip,
            user_agent=user_agent,
        )
        # Make sure no stale session cookie lingers from a previous tab.
        clear_share_cookie(response, config=cfg)
        set_share_queue_cookie(
            response,
            queue_token,
            config=cfg,
            max_age=cfg.share.queue_ttl_minutes * 60,
        )
        await share_service.write_audit(
            db,
            share_id=share["id"],
            action="otp_verify_queued",
            client_ip=ip,
            user_agent=user_agent,
            detail={"queue_expires_at": queue_expires_at},
        )
        response.status_code = 202
        return {
            "status": "queued",
            "queue_expires_at": queue_expires_at,
            "recipient_label": share["recipient_label"],
            "retry_after_seconds": 5,
        }

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
    # If this device was previously queued, drop the stale queue cookie.
    clear_share_queue_cookie(response, config=cfg)
    await share_service.write_audit(
        db,
        share_id=share["id"],
        action="otp_verify_ok",
        session_id=sid,
        client_ip=ip,
        user_agent=user_agent,
    )
    return {
        "status": "active",
        "expires_at": expires_at,
        "recipient_label": share["recipient_label"],
    }


@router.post("/claim")
async def claim_session(
    request: Request,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Promote a queue token into a real session, or report still-busy.

    Polled by a queued doctor's UI every few seconds. Three outcomes:

    - The slot is free → create a session, swap the cookies (clear
      ``asclepius_share_queue``, set ``asclepius_share``), return 200
      with ``status: "active"``.
    - The slot is still busy → return 202 with ``status: "queued"``
      and a ``retry_after_seconds`` hint. Cookie unchanged.
    - The queue token is gone (expired, share revoked, or never set)
      → return 410 Gone so the UI can punt the doctor back to the
      landing page to re-OTP.
    """
    cfg = get_config()
    ip = get_client_ip(request) or "unknown"
    user_agent = request.headers.get("user-agent")

    raw = request.cookies.get(SHARE_QUEUE_COOKIE_NAME)
    if not raw:
        raise HTTPException(status_code=410, detail="No queue position")

    entry = await share_service.get_queue_entry(db, raw)
    if not entry or not share_service.queue_entry_active(entry):
        # Stale or revoked — drop the cookie too so the UI doesn't loop.
        clear_share_queue_cookie(response, config=cfg)
        if entry:
            await share_service.delete_queue_entry(db, raw)
        raise HTTPException(status_code=410, detail="Queue position expired")

    active = await share_service.get_active_session_for_share(
        db,
        entry["share_id"],
        idle_timeout_minutes=cfg.share.idle_timeout_minutes,
    )
    if active is not None:
        response.status_code = 202
        return {
            "status": "queued",
            "queue_expires_at": entry["expires_at"],
            "recipient_label": entry["recipient_label"],
            "retry_after_seconds": 5,
        }

    # Slot is free. Promote.
    sid, expires_at = await share_service.create_session(
        db,
        share_id=entry["share_id"],
        ttl_minutes=cfg.share.session_ttl_minutes,
        client_ip=ip,
        user_agent=user_agent,
    )
    await share_service.delete_queue_entry(db, raw)
    set_share_cookie(
        response,
        sid,
        config=cfg,
        max_age=cfg.share.session_ttl_minutes * 60,
    )
    clear_share_queue_cookie(response, config=cfg)
    await share_service.write_audit(
        db,
        share_id=entry["share_id"],
        action="queue_claim_ok",
        session_id=sid,
        client_ip=ip,
        user_agent=user_agent,
    )
    return {
        "status": "active",
        "expires_at": expires_at,
        "recipient_label": entry["recipient_label"],
    }


@router.delete("/queue", status_code=204)
async def cancel_queue(
    request: Request,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Explicit cancel from the waiting UI. Idempotent."""
    cfg = get_config()
    raw = request.cookies.get(SHARE_QUEUE_COOKIE_NAME)
    if raw:
        try:
            entry = await share_service.get_queue_entry(db, raw)
            await share_service.delete_queue_entry(db, raw)
            if entry:
                await share_service.write_audit(
                    db,
                    share_id=entry["share_id"],
                    action="queue_cancel",
                    client_ip=get_client_ip(request),
                    user_agent=request.headers.get("user-agent"),
                )
        except Exception:
            logger.debug("queue cancel cleanup failed", exc_info=True)
    clear_share_queue_cookie(response, config=cfg)
    return Response(status_code=204)


@router.post("/heartbeat", status_code=204)
async def heartbeat(
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Bump ``last_seen_at`` on the current share session.

    Called by the doctor's UI every ~60s while the page is visible and
    the user has interacted recently. Without this, a doctor reading a
    long PDF (no API traffic for minutes) would be flagged idle and
    bounced. Returns 204 whether the session exists or not so the UI
    does not need to differentiate.
    """
    cfg = get_config()
    sid = request.cookies.get(SHARE_COOKIE_NAME)
    if not sid:
        return Response(status_code=204)
    session = await share_service.get_session(db, sid)
    if session and share_service.session_active(
        session, idle_timeout_minutes=cfg.share.idle_timeout_minutes
    ):
        try:
            await share_service.touch_session(db, sid)
        except Exception:
            logger.debug("heartbeat touch failed", exc_info=True)
    return Response(status_code=204)


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Revoke the current share session and clear its cookie.

    Idempotent: if no cookie is set we still clear and return 200 so the
    UI can call this on hard navigation away. Also clears any queue
    cookie because a "log out" gesture from any share-related screen
    should leave the doctor in a clean state.
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
    # Also drop any queue cookie so the doctor restarts clean.
    raw_queue = request.cookies.get(SHARE_QUEUE_COOKIE_NAME)
    if raw_queue:
        try:
            await share_service.delete_queue_entry(db, raw_queue)
        except Exception:
            logger.debug("share logout queue cleanup failed", exc_info=True)
    clear_share_cookie(response, config=cfg)
    clear_share_queue_cookie(response, config=cfg)
    return {"ok": True}
