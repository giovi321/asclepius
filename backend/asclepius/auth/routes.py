"""Authentication API routes (login / logout / me)."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

import aiosqlite
from asclepius.auth import rate_limit
from asclepius.auth.cookies import clear_auth_cookie, set_auth_cookie
from asclepius.auth.session import (
    COOKIE_NAME,
    create_session,
    get_current_user,
    revoke_session,
    verify_password,
)
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.config import get_config
from asclepius.db.connection import get_db

router = APIRouter()


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=1024)


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str | None
    role: str


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Authenticate with username + password and set the session cookie.

    Failed attempts are rate-limited per ``(client_ip, username)`` pair to
    blunt credential-stuffing. Successful logins clear the counter.
    """
    config = get_config()
    ip = get_client_ip(request) or "unknown"

    # Check the rate-limit *before* hitting the DB so an attacker cannot use
    # the endpoint as an oracle for which usernames exist.
    if not rate_limit.check_and_record(
        ip, body.username,
        max_attempts=config.auth.login_max_attempts,
        window_seconds=config.auth.login_window_seconds,
        record=False,  # we record only on failure below
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Try again later.",
        )

    cursor = await db.execute(
        "SELECT id, username, password_hash, display_name, role FROM users WHERE username = ?",
        (body.username,),
    )
    user = await cursor.fetchone()
    if not user or not verify_password(body.password, user[2]):
        # Record the failure so repeated bad attempts eventually 429.
        rate_limit.check_and_record(
            ip, body.username,
            max_attempts=config.auth.login_max_attempts,
            window_seconds=config.auth.login_window_seconds,
            record=True,
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")

    rate_limit.clear(ip, body.username)

    token = await create_session(db, user[0], request)
    set_auth_cookie(
        response, COOKIE_NAME, token,
        config=config,
        max_age=config.auth.session_ttl_hours * 3600,
    )

    await audit_log(db, user[0], "login", ip_address=ip)

    return UserResponse(id=user[0], username=user[1], display_name=user[3], role=user[4] or "editor")


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Revoke the current session server-side and clear the cookie."""
    from asclepius.auth.session import _unpack_token

    config = get_config()
    try:
        token = request.cookies.get(COOKIE_NAME)
        if token:
            sid = _unpack_token(token)
            if sid:
                # Look up user_id for the audit entry before revocation.
                cursor = await db.execute(
                    "SELECT user_id FROM sessions WHERE session_id = ?", (sid,),
                )
                row = await cursor.fetchone()
                await revoke_session(db, sid)
                if row:
                    await audit_log(
                        db, row[0], "logout",
                        ip_address=get_client_ip(request),
                    )
    except Exception:
        # Never let audit logging or revocation fail the cookie clear.
        pass

    clear_auth_cookie(response, COOKIE_NAME, config=config)
    return {"ok": True}


@router.get("/me")
async def me(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict:
    # Also return accessible patients
    cursor = await db.execute(
        """SELECT p.id, p.slug, p.display_name, upa.role
           FROM patients p
           JOIN user_patient_access upa ON upa.patient_id = p.id
           WHERE upa.user_id = ?""",
        (current_user["id"],),
    )
    patients = [
        {"id": row[0], "slug": row[1], "display_name": row[2], "role": row[3]}
        for row in await cursor.fetchall()
    ]

    # Admins can see all patients
    if current_user.get("role") == "admin":
        cursor = await db.execute(
            """SELECT p.id, p.slug, p.display_name, 'admin' as role
               FROM patients p
               WHERE p.id NOT IN (
                   SELECT patient_id FROM user_patient_access WHERE user_id = ?
               )""",
            (current_user["id"],),
        )
        extra = [
            {"id": row[0], "slug": row[1], "display_name": row[2], "role": row[3]}
            for row in await cursor.fetchall()
        ]
        patients.extend(extra)

    # Drop the internal marker before sending the user record to the client.
    payload = {k: v for k, v in current_user.items() if not k.startswith("_")}
    return {**payload, "patients": patients}
