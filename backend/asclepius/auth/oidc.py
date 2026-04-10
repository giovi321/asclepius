"""OIDC authentication flow for SSO (Authentik, Keycloak, etc.)."""

import logging

from authlib.integrations.httpx_client import AsyncOAuth2Client
from fastapi import APIRouter, Depends, HTTPException, Request, Response

import aiosqlite
from asclepius.auth.session import COOKIE_NAME, create_session_token, hash_password
from asclepius.config import get_config
from asclepius.db.connection import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

# Well-known OIDC discovery suffix
DISCOVERY_PATH = "/.well-known/openid-configuration"


def _get_oidc_client() -> AsyncOAuth2Client:
    config = get_config()
    return AsyncOAuth2Client(
        client_id=config.oidc.client_id,
        client_secret=config.oidc.client_secret,
        scope=config.oidc.scopes,
    )


@router.get("/oidc/enabled")
async def oidc_enabled():
    """Check if OIDC is configured and enabled."""
    config = get_config()
    return {
        "enabled": config.oidc.enabled,
        "provider_url": config.oidc.provider_url if config.oidc.enabled else None,
    }


@router.get("/oidc/login")
async def oidc_login(request: Request):
    """Redirect to OIDC provider for authentication."""
    config = get_config()
    if not config.oidc.enabled:
        raise HTTPException(status_code=400, detail="OIDC not configured")

    client = _get_oidc_client()

    # Discover OIDC endpoints
    provider_url = config.oidc.provider_url.rstrip("/")
    metadata = await client.fetch_server_metadata(provider_url)

    # Build callback URL
    callback_url = str(request.url_for("oidc_callback"))

    authorization_url = metadata["authorization_endpoint"]
    url, state = client.create_authorization_url(
        authorization_url,
        redirect_uri=callback_url,
    )

    # Store state in a signed cookie for CSRF protection
    from itsdangerous import URLSafeTimedSerializer
    s = URLSafeTimedSerializer(config.auth.secret_key)
    state_token = s.dumps({"state": state})

    response = Response(status_code=307, headers={"Location": url})
    response.set_cookie(
        key="asclepius_oidc_state",
        value=state_token,
        httponly=True,
        samesite="lax",
        max_age=600,
        path="/",
    )
    return response


@router.get("/oidc/callback")
async def oidc_callback(
    request: Request,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Handle OIDC callback after provider authentication."""
    config = get_config()
    if not config.oidc.enabled:
        raise HTTPException(status_code=400, detail="OIDC not configured")

    # Verify state
    state_cookie = request.cookies.get("asclepius_oidc_state")
    if not state_cookie:
        raise HTTPException(status_code=400, detail="Missing OIDC state")

    from itsdangerous import URLSafeTimedSerializer, BadSignature
    s = URLSafeTimedSerializer(config.auth.secret_key)
    try:
        state_data = s.loads(state_cookie, max_age=600)
    except BadSignature:
        raise HTTPException(status_code=400, detail="Invalid OIDC state")

    client = _get_oidc_client()

    # Discover endpoints
    provider_url = config.oidc.provider_url.rstrip("/")
    metadata = await client.fetch_server_metadata(provider_url)

    # Exchange code for token
    callback_url = str(request.url_for("oidc_callback"))
    token = await client.fetch_token(
        metadata["token_endpoint"],
        authorization_response=str(request.url),
        redirect_uri=callback_url,
    )

    # Get user info
    userinfo_resp = await client.get(metadata["userinfo_endpoint"])
    userinfo = userinfo_resp.json()

    username = userinfo.get(config.oidc.username_claim, "")
    display_name = userinfo.get(config.oidc.display_name_claim, username)
    email = userinfo.get("email", "")

    if not username:
        raise HTTPException(status_code=400, detail="No username in OIDC claims")

    # Find or create user
    cursor = await db.execute(
        "SELECT id, username, display_name FROM users WHERE username = ?",
        (username,),
    )
    user = await cursor.fetchone()

    if not user:
        if not config.oidc.auto_create_user:
            raise HTTPException(
                status_code=403,
                detail=f"User '{username}' not found and auto-creation is disabled",
            )

        # Create user with a random password (OIDC users don't use password login)
        import secrets
        random_password = secrets.token_urlsafe(32)
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
            (username, hash_password(random_password), display_name),
        )
        user_id = cursor.lastrowid
        await db.commit()
        logger.info("Created OIDC user: %s (id=%d)", username, user_id)
    else:
        user_id = user[0]
        # Update display name if changed
        if display_name and display_name != user[2]:
            await db.execute(
                "UPDATE users SET display_name = ? WHERE id = ?",
                (display_name, user_id),
            )
            await db.commit()

    # Create session
    session_token = create_session_token(user_id)

    # Redirect to app with session cookie
    response = Response(status_code=307, headers={"Location": "/"})
    response.set_cookie(
        key=COOKIE_NAME,
        value=session_token,
        httponly=True,
        samesite="lax",
        path="/",
    )
    response.delete_cookie(key="asclepius_oidc_state", path="/")
    return response
