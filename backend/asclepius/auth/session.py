"""Session management and password utilities.

Sessions are stored server-side in the ``sessions`` table; the user's cookie
carries a signed opaque session id. Server-side storage means admins can list
active sessions and revoke them, and logout actually invalidates the token
instead of just deleting the cookie.

Password hashing pre-hashes the plaintext with SHA-256 before bcrypt to
avoid bcrypt's silent 72-byte truncation; existing hashes produced before
this change remain verifiable via a legacy code path.
"""

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

import aiosqlite
from asclepius.audit.service import get_client_ip
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
                hashed[len(_SHA_BCRYPT_PREFIX) :].encode(),
            )
        # Legacy path — bcrypt directly on the (possibly truncated) password.
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except (ValueError, TypeError):
        return False


async def create_session(
    db: aiosqlite.Connection,
    user_id: int,
    request: Request | None = None,
) -> str:
    """Create a new server-side session and return the signed cookie value.

    Records IP + User-Agent so admins can distinguish concurrent sessions.
    The returned token is the session id wrapped in an itsdangerous signature
    — tampering is detected before we hit the DB.
    """
    config = get_config()
    session_id = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=config.auth.session_ttl_hours)

    ip = None
    user_agent = None
    if request is not None:
        try:
            ip = get_client_ip(request)
        except Exception:
            ip = None
        ua = request.headers.get("user-agent")
        if ua:
            user_agent = ua[:500]

    await db.execute(
        """INSERT INTO sessions
           (session_id, user_id, expires_at, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?)""",
        (session_id, user_id, expires_at.isoformat(timespec="seconds"), ip, user_agent),
    )
    await db.commit()

    s = URLSafeTimedSerializer(config.auth.secret_key)
    return s.dumps({"sid": session_id})


def _unpack_token(token: str) -> Optional[str]:
    """Verify the cookie's signature and return the session id, or None."""
    config = get_config()
    s = URLSafeTimedSerializer(config.auth.secret_key)
    try:
        # Belt-and-braces: also enforce TTL at the signature layer so expired
        # cookies fail without a DB round-trip.
        data = s.loads(token, max_age=config.auth.session_ttl_hours * 3600)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(data, dict):
        return None
    sid = data.get("sid")
    return sid if isinstance(sid, str) and sid else None


async def revoke_session(db: aiosqlite.Connection, session_id: str) -> None:
    """Mark a session revoked. Idempotent."""
    await db.execute(
        "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_id = ? AND revoked_at IS NULL",
        (session_id,),
    )
    await db.commit()


async def get_current_user(
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict:
    """FastAPI dependency: extract and validate session, return user dict.

    Also touches ``last_active_at`` (at most once per minute to avoid a
    per-request write amplification) so the admin Sessions page shows a
    recent-activity timestamp.
    """
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session_id = _unpack_token(token)
    if not session_id:
        raise HTTPException(status_code=401, detail="Session expired")

    cursor = await db.execute(
        """SELECT s.user_id, s.revoked_at, s.expires_at,
                  u.username, u.display_name, u.role
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.session_id = ?""",
        (session_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Session not found")
    if row[1] is not None:
        raise HTTPException(status_code=401, detail="Session revoked")
    if row[2] and row[2] < datetime.utcnow().isoformat(timespec="seconds"):
        raise HTTPException(status_code=401, detail="Session expired")

    # Throttled last-active update: only rewrite the column if >60s has
    # elapsed since the previous update. Keeps this dependency cheap on
    # read-heavy traffic.
    await db.execute(
        """UPDATE sessions
           SET last_active_at = CURRENT_TIMESTAMP
           WHERE session_id = ?
             AND last_active_at < datetime('now', '-60 seconds')""",
        (session_id,),
    )
    await db.commit()

    return {
        "id": row[0],
        "username": row[3],
        "display_name": row[4],
        "role": row[5] or "editor",
        "_session_id": session_id,
    }


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
