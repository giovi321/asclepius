"""FastAPI dependencies for the doctor-share auth surface.

Three deps cover every share endpoint:

- ``get_share_session`` for doctor-facing endpoints — pulls the
  ``asclepius_share`` cookie, validates the session row (not revoked,
  not past TTL, share itself active), and returns the joined session+share
  dict.
- ``get_share_session_optional`` for endpoints that should fall back to
  a public response when the cookie is missing.

These deliberately do NOT touch the regular ``sessions`` table or the
``asclepius_session`` cookie — share auth is a parallel namespace. This
keeps the regular auth code untouched and prevents any token-confusion
bug where a share cookie could be promoted into a real account session.
"""

from __future__ import annotations

import aiosqlite
from fastapi import Depends, HTTPException, Request

from asclepius.db.connection import get_db
from asclepius.share.service import get_session, session_active

SHARE_COOKIE_NAME = "asclepius_share"


async def get_share_session(
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict:
    """Resolve a valid share session or raise 401.

    The caller receives a dict with ``id`` (session_id), ``share_id``,
    ``patient_id``, ``recipient_label``, and the two ``expires_at``
    columns so audit writes and quota lookups have everything they need
    without an extra SELECT.
    """
    sid = request.cookies.get(SHARE_COOKIE_NAME)
    if not sid:
        raise HTTPException(status_code=401, detail="No share session")

    session = await get_session(db, sid)
    if not session:
        raise HTTPException(status_code=401, detail="Share session not found")
    if not session_active(session):
        raise HTTPException(status_code=401, detail="Share session expired")
    return session


async def get_share_session_optional(
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict | None:
    """Same as ``get_share_session`` but returns None instead of raising.

    Used by the public OTP endpoints, which need to know whether a
    session already exists (e.g. to short-circuit a refresh) but should
    not 401 if one does not.
    """
    sid = request.cookies.get(SHARE_COOKIE_NAME)
    if not sid:
        return None
    session = await get_session(db, sid)
    if not session or not session_active(session):
        return None
    return session
