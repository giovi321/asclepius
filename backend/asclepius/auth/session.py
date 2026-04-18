"""Session management and password utilities.

Session tokens are short signed blobs produced by ``itsdangerous`` and
delivered as HttpOnly cookies. The signing key and TTL come from
:class:`asclepius.config.AuthConfig`.

Password hashing pre-hashes the plaintext with SHA-256 before bcrypt to
avoid bcrypt's silent 72-byte truncation; existing hashes produced before
this change remain verifiable via a legacy code path.
"""

import hashlib
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

import aiosqlite
from asclepius.config import get_config
from asclepius.db.connection import get_db

COOKIE_NAME = "asclepius_session"

# Sentinel prefix written into the hash column for pre-hashed bcrypt entries
# so we can distinguish them from legacy plain-bcrypt hashes on verify.
_SHA_BCRYPT_PREFIX = "sha256$"


def _prehash(password: str) -> bytes:
    """Return a 64-byte hex digest of ``password`` for bcrypt input.

    Using a fixed-width digest sidesteps bcrypt's 72-byte truncation without
    losing entropy for passwords longer than 72 chars (pepper-like patterns
    or passphrases).
    """
    return hashlib.sha256(password.encode("utf-8")).hexdigest().encode("ascii")


def hash_password(password: str) -> str:
    """Hash a plaintext password. Output is safe to store in ``password_hash``."""
    digest = _prehash(password)
    return _SHA_BCRYPT_PREFIX + bcrypt.hashpw(digest, bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    """Verify ``password`` against a stored hash, handling legacy hashes.

    New hashes are prefixed with ``sha256$``. Legacy hashes stored as raw
    bcrypt strings are still accepted so existing users keep working.
    """
    try:
        if hashed.startswith(_SHA_BCRYPT_PREFIX):
            return bcrypt.checkpw(
                _prehash(password),
                hashed[len(_SHA_BCRYPT_PREFIX):].encode(),
            )
        # Legacy path — bcrypt directly on the (possibly truncated) password.
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except (ValueError, TypeError):
        return False


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


# Note: the default ``admin/admin`` user creation was removed — first-time
# setup now runs through :mod:`asclepius.setup.routes` and prompts for a real
# password, creating the initial user as ``role='admin'``.
