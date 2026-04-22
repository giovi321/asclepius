"""User management, patient-access grants, and session management endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

import aiosqlite
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.auth.session import get_current_user, hash_password, require_role
from asclepius.db.connection import get_db

router = APIRouter()


class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    role: str = "editor"


class UserUpdate(BaseModel):
    display_name: str | None = None
    password: str | None = None
    role: str | None = None


class PatientAccessGrant(BaseModel):
    patient_id: int
    role: str = "viewer"


@router.get("/users")
async def list_users(
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "SELECT id, username, display_name, role, created_at FROM users ORDER BY username"
    )
    return [dict(r) for r in await cursor.fetchall()]


@router.post("/users", status_code=201)
async def create_user(
    body: UserCreate,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    try:
        role = getattr(body, "role", "editor") or "editor"
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
            (body.username, hash_password(body.password), body.display_name or body.username, role),
        )
        await db.commit()
        await audit_log(db, current_user["id"], "user.create", "user", cursor.lastrowid,
                        {"username": body.username, "role": role}, get_client_ip(request))
        return {"id": cursor.lastrowid, "username": body.username, "role": role}
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="Username already exists")


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    updates = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.password is not None:
        updates["password_hash"] = hash_password(body.password)
    if body.role is not None:
        if body.role not in ("admin", "editor", "viewer"):
            raise HTTPException(status_code=400, detail="Role must be admin, editor, or viewer")
        updates["role"] = body.role

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [user_id]
    await db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
    await db.commit()
    await audit_log(db, current_user["id"], "user.update", "user", user_id,
                    {"changed": list(updates.keys())}, get_client_ip(request))
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    cursor = await db.execute("SELECT username FROM users WHERE id = ?", (user_id,))
    user_row = await cursor.fetchone()
    username = user_row[0] if user_row else "unknown"

    await db.execute("DELETE FROM user_patient_access WHERE user_id = ?", (user_id,))
    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.commit()
    await audit_log(db, current_user["id"], "user.delete", "user", user_id,
                    {"username": username}, get_client_ip(request))
    return {"ok": True}


@router.get("/users/{user_id}/access")
async def get_user_access(
    user_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        """SELECT p.id, p.slug, p.display_name, upa.role
           FROM patients p
           JOIN user_patient_access upa ON upa.patient_id = p.id
           WHERE upa.user_id = ?""",
        (user_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]


@router.post("/users/{user_id}/access")
async def grant_access(
    user_id: int,
    body: PatientAccessGrant,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    try:
        await db.execute(
            "INSERT OR REPLACE INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, ?)",
            (user_id, body.patient_id, body.role),
        )
        await db.commit()
        await audit_log(db, current_user["id"], "access.grant", "user", user_id,
                        {"patient_id": body.patient_id, "role": body.role}, get_client_ip(request))
        return {"ok": True}
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=400, detail="Invalid user or patient ID")


@router.delete("/users/{user_id}/access/{patient_id}")
async def revoke_access(
    user_id: int,
    patient_id: int,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute(
        "DELETE FROM user_patient_access WHERE user_id = ? AND patient_id = ?",
        (user_id, patient_id),
    )
    await db.commit()
    await audit_log(db, current_user["id"], "access.revoke", "user", user_id,
                    {"patient_id": patient_id}, get_client_ip(request))
    return {"ok": True}


# --- Sessions (admin) ---

@router.get("/sessions")
async def list_sessions(
    include_revoked: bool = Query(default=False),
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List server-side sessions with user + activity details.

    By default shows only sessions that are still usable (not revoked, not
    expired). Pass ``include_revoked=true`` to include the rest for audit.
    """
    where = ""
    if not include_revoked:
        where = "WHERE s.revoked_at IS NULL AND s.expires_at > datetime('now')"
    cursor = await db.execute(
        f"""SELECT s.session_id, s.user_id, u.username, u.display_name, u.role,
                   s.created_at, s.last_active_at, s.expires_at,
                   s.ip_address, s.user_agent, s.revoked_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            {where}
            ORDER BY s.last_active_at DESC"""
    )
    items = []
    for r in await cursor.fetchall():
        d = dict(r)
        d["is_current"] = (r["session_id"] == current_user.get("_session_id"))
        items.append(d)
    return {"items": items}


@router.delete("/sessions/{session_id}")
async def revoke_session_endpoint(
    session_id: str,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Revoke a session. The owner of that session is effectively logged out
    on their next request."""
    from asclepius.auth.session import revoke_session as _revoke

    cursor = await db.execute(
        "SELECT user_id, revoked_at FROM sessions WHERE session_id = ?",
        (session_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    if row[1] is not None:
        return {"ok": True, "already_revoked": True}

    await _revoke(db, session_id)
    await audit_log(
        db, current_user["id"], "session.revoke", "session", None,
        {"target_user_id": row[0], "self": session_id == current_user.get("_session_id")},
        get_client_ip(request),
    )
    return {"ok": True}
