"""Share session create / validate / revoke, plus admin-side listing.

Session TTL and the idle-timeout semantics are part of the trust
boundary and are moved here verbatim.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import aiosqlite

from asclepius.share.tokens import generate_session_id, in_minutes, utcnow_iso

# ── Sessions ─────────────────────────────────────────────────────


async def create_session(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    ttl_minutes: int,
    client_ip: str | None,
    user_agent: str | None,
) -> tuple[str, str]:
    """Create a share session row. Returns (session_id, expires_at_iso).

    ``last_seen_at`` defaults to ``CURRENT_TIMESTAMP`` at the schema
    level, so a fresh session starts the idle clock at zero.
    """
    sid = generate_session_id()
    expires_at = in_minutes(ttl_minutes)
    await db.execute(
        """INSERT INTO document_share_sessions
              (id, share_id, expires_at, client_ip, user_agent)
           VALUES (?, ?, ?, ?, ?)""",
        (sid, share_id, expires_at, client_ip, (user_agent or "")[:500] or None),
    )
    await db.commit()
    return sid, expires_at


async def get_session(db: aiosqlite.Connection, session_id: str) -> dict | None:
    cursor = await db.execute(
        """SELECT s.*, sh.patient_id, sh.recipient_label, sh.expires_at AS share_expires_at,
                  sh.revoked_at AS share_revoked_at
             FROM document_share_sessions s
             JOIN document_shares sh ON sh.id = s.share_id
            WHERE s.id = ?""",
        (session_id,),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


async def touch_session(db: aiosqlite.Connection, session_id: str) -> None:
    """Bump ``last_seen_at`` so the idle-timeout clock resets.

    Called on every authenticated share-side request (and on the
    explicit heartbeat ping while the page is visible). Cheap: keyed
    on the session PK and writes a single column.
    """
    await db.execute(
        """UPDATE document_share_sessions
              SET last_seen_at = CURRENT_TIMESTAMP
            WHERE id = ?""",
        (session_id,),
    )
    await db.commit()


async def revoke_session(db: aiosqlite.Connection, session_id: str) -> None:
    await db.execute(
        """UPDATE document_share_sessions
              SET revoked_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revoked_at IS NULL""",
        (session_id,),
    )
    await db.commit()


def session_active(session: dict, *, idle_timeout_minutes: int | None = None) -> bool:
    """True iff the session is alive: not revoked, not past TTL, share still
    valid, and (if ``idle_timeout_minutes`` is given) not idle.

    The idle check uses ``last_seen_at`` as the floor, falling back to
    ``created_at`` for legacy rows that pre-date the column.
    """
    if session.get("revoked_at") or session.get("share_revoked_at"):
        return False
    now = utcnow_iso()
    if session.get("expires_at") and session["expires_at"] < now:
        return False
    if session.get("share_expires_at") and session["share_expires_at"] < now:
        return False
    if idle_timeout_minutes is not None and idle_timeout_minutes > 0:
        last = session.get("last_seen_at") or session.get("created_at")
        if last:
            # SQLite ``CURRENT_TIMESTAMP`` emits ``2026-05-03 15:29:52``
            # (space separator) while Python's ``isoformat`` uses a ``T``.
            # Normalise both sides before lexicographic compare or the
            # space-vs-T ASCII difference makes a freshly-touched session
            # look older than a 10-minute-old cutoff.
            last_norm = last.replace(" ", "T")
            cutoff = (datetime.utcnow() - timedelta(minutes=idle_timeout_minutes)).isoformat(
                timespec="seconds"
            )
            if last_norm < cutoff:
                return False
    return True


async def get_active_session_for_share(
    db: aiosqlite.Connection,
    share_id: int,
    *,
    idle_timeout_minutes: int,
) -> dict | None:
    """Return the live session row for this share, if any.

    A session is "live" when it is not revoked, not past TTL, and was
    seen within the idle window. Used to enforce the
    one-session-per-share invariant: a second device verifying an OTP
    while this returns non-None gets a queue token instead of a
    session, and ``/claim`` waits for it to return None.
    """
    cursor = await db.execute(
        """SELECT s.*, sh.expires_at AS share_expires_at,
                  sh.revoked_at AS share_revoked_at
             FROM document_share_sessions s
             JOIN document_shares sh ON sh.id = s.share_id
            WHERE s.share_id = ?
              AND s.revoked_at IS NULL
            ORDER BY s.created_at DESC""",
        (share_id,),
    )
    rows = [dict(r) for r in await cursor.fetchall()]
    for row in rows:
        if session_active(row, idle_timeout_minutes=idle_timeout_minutes):
            return row
    return None


# ── Admin-side session listing and termination ────────────────────


async def list_active_sessions_for_share(
    db: aiosqlite.Connection,
    share_id: int,
    *,
    idle_timeout_minutes: int,
) -> list[dict]:
    """List non-revoked, not-past-TTL sessions for the share, with
    metadata the admin needs (IP, UA, timestamps).

    The cookie-equivalent ``id`` column is intentionally NOT returned —
    we expose ``rowid`` instead so the admin's terminate action can key
    on a stable handle that does not double as an authentication token.
    Each row carries an ``is_idle`` flag computed against
    ``idle_timeout_minutes`` so the UI can flag dead-but-not-revoked
    sessions (the queue treats those as free slots).
    """
    now_iso = utcnow_iso()
    cursor = await db.execute(
        """SELECT s.rowid AS rowid, s.share_id, s.expires_at, s.last_seen_at,
                  s.client_ip, s.user_agent, s.created_at
             FROM document_share_sessions s
            WHERE s.share_id = ?
              AND s.revoked_at IS NULL
              AND s.expires_at > ?
            ORDER BY s.created_at DESC""",
        (share_id, now_iso),
    )
    rows = [dict(r) for r in await cursor.fetchall()]
    if idle_timeout_minutes > 0:
        cutoff = (datetime.utcnow() - timedelta(minutes=idle_timeout_minutes)).isoformat(
            timespec="seconds"
        )
        for row in rows:
            last = row.get("last_seen_at") or row.get("created_at")
            row["is_idle"] = bool(last and last.replace(" ", "T") < cutoff)
    else:
        for row in rows:
            row["is_idle"] = False
    return rows


async def revoke_session_by_rowid(db: aiosqlite.Connection, share_id: int, rowid: int) -> bool:
    """Mark a single session revoked, scoped to ``share_id`` so an admin
    cannot accidentally kill a session belonging to another share.
    Returns True iff a row was actually updated (idempotent on retries).
    """
    cursor = await db.execute(
        """UPDATE document_share_sessions
              SET revoked_at = CURRENT_TIMESTAMP
            WHERE rowid = ? AND share_id = ? AND revoked_at IS NULL""",
        (rowid, share_id),
    )
    await db.commit()
    return cursor.rowcount > 0
