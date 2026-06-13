"""Single-session queue: queue-token mint, lookup, GC, and admin listing.

When a share already has a live session, a second doctor gets a queue
token (hashed cookie) instead and waits for the slot to free. Moved here
verbatim.
"""

from __future__ import annotations

import aiosqlite

from asclepius.share.tokens import generate_queue_token, hash_token, in_minutes, utcnow_iso

# ── Single-session queue ─────────────────────────────────────────


async def enqueue_for_share(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    ttl_minutes: int,
    client_ip: str | None,
    user_agent: str | None,
) -> tuple[str, str]:
    """Mint a queue token for a doctor waiting on a busy share.

    Returns ``(raw_token, expires_at_iso)``. The raw token goes in the
    ``asclepius_share_queue`` cookie; only its sha256 lives in the DB so
    a database read does not yield a usable cookie.
    """
    raw = generate_queue_token()
    expires_at = in_minutes(ttl_minutes)
    await db.execute(
        """INSERT INTO document_share_session_queue
              (id, share_id, expires_at, client_ip, user_agent)
           VALUES (?, ?, ?, ?, ?)""",
        (
            hash_token(raw),
            share_id,
            expires_at,
            client_ip,
            (user_agent or "")[:500] or None,
        ),
    )
    await db.commit()
    return raw, expires_at


async def get_queue_entry(db: aiosqlite.Connection, raw_token: str) -> dict | None:
    """Resolve a queue cookie value to its row (active or not)."""
    if not raw_token:
        return None
    cursor = await db.execute(
        """SELECT q.*, sh.recipient_label, sh.revoked_at AS share_revoked_at,
                  sh.expires_at AS share_expires_at
             FROM document_share_session_queue q
             JOIN document_shares sh ON sh.id = q.share_id
            WHERE q.id = ?""",
        (hash_token(raw_token),),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


def queue_entry_active(entry: dict) -> bool:
    """True iff the queue row is still usable: parent share alive and not
    past the queue token's own TTL."""
    if entry.get("share_revoked_at"):
        return False
    now = utcnow_iso()
    if entry.get("share_expires_at") and entry["share_expires_at"] < now:
        return False
    if entry.get("expires_at") and entry["expires_at"] < now:
        return False
    return True


async def delete_queue_entry(db: aiosqlite.Connection, raw_token: str) -> None:
    """Idempotent delete keyed by hashed cookie value."""
    if not raw_token:
        return
    await db.execute(
        "DELETE FROM document_share_session_queue WHERE id = ?",
        (hash_token(raw_token),),
    )
    await db.commit()


async def purge_expired_queue(db: aiosqlite.Connection) -> None:
    """Drop queue rows past their TTL. Cheap inline GC so the table does
    not grow unboundedly; called from /claim and verify-otp."""
    await db.execute(
        "DELETE FROM document_share_session_queue WHERE expires_at < ?",
        (utcnow_iso(),),
    )
    await db.commit()


# ── Admin-side queue listing and termination ──────────────────────


async def list_queued_for_share(db: aiosqlite.Connection, share_id: int) -> list[dict]:
    """List queue rows still usable (not past TTL) for this share."""
    now_iso = utcnow_iso()
    cursor = await db.execute(
        """SELECT q.rowid AS rowid, q.share_id, q.expires_at, q.client_ip,
                  q.user_agent, q.created_at
             FROM document_share_session_queue q
            WHERE q.share_id = ?
              AND q.expires_at > ?
            ORDER BY q.created_at ASC""",
        (share_id, now_iso),
    )
    return [dict(r) for r in await cursor.fetchall()]


async def delete_queue_entry_by_rowid(db: aiosqlite.Connection, share_id: int, rowid: int) -> bool:
    """Drop a queue entry by rowid, scoped to ``share_id``. Returns True
    iff a row was actually deleted.
    """
    cursor = await db.execute(
        """DELETE FROM document_share_session_queue
            WHERE rowid = ? AND share_id = ?""",
        (rowid, share_id),
    )
    await db.commit()
    return cursor.rowcount > 0
