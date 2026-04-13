"""Session management and password utilities."""

from datetime import datetime, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

import aiosqlite
from asclepius.config import get_config
from asclepius.db.connection import get_db

COOKIE_NAME = "asclepius_session"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_session_token(user_id: int) -> str:
    config = get_config()
    s = URLSafeTimedSerializer(config.auth.secret_key)
    return s.dumps({"user_id": user_id})


def validate_session_token(token: str) -> Optional[dict]:
    config = get_config()
    s = URLSafeTimedSerializer(config.auth.secret_key)
    try:
        data = s.loads(token, max_age=config.auth.session_ttl_hours * 3600)
        return data
    except (BadSignature, SignatureExpired):
        return None


async def get_current_user(
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict:
    """FastAPI dependency: extract and validate session, return user dict."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session_data = validate_session_token(token)
    if not session_data:
        raise HTTPException(status_code=401, detail="Session expired")

    cursor = await db.execute(
        "SELECT id, username, display_name, role FROM users WHERE id = ?",
        (session_data["user_id"],),
    )
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return {"id": user[0], "username": user[1], "display_name": user[2], "role": user[3] or "editor"}


def require_role(*allowed_roles: str):
    """FastAPI dependency factory: require user to have one of the specified roles."""
    async def _check(current_user: dict = Depends(get_current_user)):
        user_role = current_user.get("role", "viewer")
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires role: {', '.join(allowed_roles)}. Your role: {user_role}",
            )
        return current_user
    return _check


async def ensure_admin_exists(db: aiosqlite.Connection) -> None:
    """Create default admin user if no users exist."""
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    row = await cursor.fetchone()
    if row[0] == 0:
        await db.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
            ("admin", hash_password("admin"), "Administrator", "admin"),
        )
        await db.commit()
