"""Share audit-log writes and the admin-side audit listing.

Leaf module (only depends on stdlib + aiosqlite) so any other share
module can import it without a circular dependency.
"""

from __future__ import annotations

import json

import aiosqlite

# ── Audit ────────────────────────────────────────────────────────


async def write_audit(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    action: str,
    session_id: str | None = None,
    document_id: int | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
    detail: dict | None = None,
) -> None:
    """Append a row to ``document_share_audit``. Best-effort; never raises."""
    try:
        await db.execute(
            """INSERT INTO document_share_audit
                  (share_id, session_id, action, document_id,
                   client_ip, user_agent, detail)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                share_id,
                session_id,
                action,
                document_id,
                client_ip,
                (user_agent or "")[:500] or None,
                json.dumps(detail) if detail else None,
            ),
        )
        await db.commit()
    except Exception:
        # An audit write must never break the user-facing path.
        pass


# ── Audit listing for admin ──────────────────────────────────────


async def list_audit(db: aiosqlite.Connection, share_id: int, limit: int = 200) -> list[dict]:
    cursor = await db.execute(
        """SELECT id, action, session_id, document_id, client_ip, user_agent,
                  detail, created_at
             FROM document_share_audit
            WHERE share_id = ?
            ORDER BY id DESC
            LIMIT ?""",
        (share_id, limit),
    )
    rows: list[dict] = []
    for r in await cursor.fetchall():
        item = dict(r)
        # Best-effort: parse stored JSON detail back into a dict for clients.
        if item.get("detail"):
            try:
                item["detail"] = json.loads(item["detail"])
            except json.JSONDecodeError:
                pass
        rows.append(item)
    return rows
