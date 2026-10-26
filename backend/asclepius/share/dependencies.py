"""FastAPI dependencies for the doctor-share auth surface.

``get_share_session`` covers every share endpoint — it pulls the
``asclepius_share`` cookie, validates the session row (not revoked,
not past TTL, share itself active, and not idle), bumps
``last_seen_at`` so the idle clock resets, and returns the joined
session+share dict.

This deliberately does NOT touch the regular ``sessions`` table or the
``asclepius_session`` cookie — share auth is a parallel namespace. This
keeps the regular auth code untouched and prevents any token-confusion
bug where a share cookie could be promoted into a real account session.
"""

from __future__ import annotations

import hashlib

import aiosqlite
from fastapi import Depends, HTTPException, Request

from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.share.service import get_session, session_active, touch_session

SHARE_COOKIE_NAME = "asclepius_share"
SHARE_QUEUE_COOKIE_NAME = "asclepius_share_queue"

# A missing, revoked, idle or expired session answers 410, not 401. The
# public proxy's fail2ban jail bans an IP after 10 responses with status
# 401, 403 or 404 in 2 minutes; 410 is not counted, so a doctor whose
# session died (reload after logout, laptop sleep, several image
# requests in flight) cannot get banned by it. The header lets the
# frontend tell a dead session from other 410s (document no longer in
# the share, missing file).
SESSION_ENDED_STATUS = 410
SESSION_ENDED_HEADERS = {"X-Share-Session": "ended"}


def session_tag(session_id: str) -> str:
    """Opaque, stable label for one share session.

    ``/me`` and ``/heartbeat`` both return it. The browser keeps one
    share cookie, so verifying a second share in another tab silently
    swaps the session under the first tab; a changed tag tells that tab
    its session is gone. A hash, so the cookie value never leaves the
    cookie.
    """
    return hashlib.sha256(session_id.encode()).hexdigest()[:16]


def session_ended(detail: str) -> HTTPException:
    """The exception every share endpoint raises for a dead session."""
    return HTTPException(
        status_code=SESSION_ENDED_STATUS,
        detail=detail,
        headers=SESSION_ENDED_HEADERS,
    )


async def get_share_session(
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict:
    """Resolve a valid share session or raise 410 (see ``session_ended``).

    The caller receives a dict with ``id`` (session_id), ``share_id``,
    ``patient_id``, ``recipient_label``, and the two ``expires_at``
    columns so audit writes and quota lookups have everything they need
    without an extra SELECT. Bumps ``last_seen_at`` so the idle clock
    resets on every authenticated call.
    """
    sid = request.cookies.get(SHARE_COOKIE_NAME)
    if not sid:
        raise session_ended("No share session")

    session = await get_session(db, sid)
    if not session:
        raise session_ended("Share session not found")
    cfg = get_config()
    if not session_active(session, idle_timeout_minutes=cfg.share.idle_timeout_minutes):
        raise session_ended("Share session expired")
    # Best-effort touch: a failure here must not break the request, but
    # losing the bump means the session looks idler than it really is.
    try:
        await touch_session(db, sid)
    except Exception:
        pass
    return session
