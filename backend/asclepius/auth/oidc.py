"""OIDC authentication flow for SSO (Authentik, Keycloak, etc.)."""

import logging
from typing import Any

from authlib.integrations.httpx_client import AsyncOAuth2Client
from fastapi import APIRouter, Depends, HTTPException, Request, Response

import aiosqlite
from asclepius.auth.cookies import clear_auth_cookie, set_auth_cookie
from asclepius.auth.session import COOKIE_NAME, create_session, hash_password
from asclepius.config import get_config
from asclepius.config.models import OidcConfig
from asclepius.db.connection import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

# Well-known OIDC discovery suffix
DISCOVERY_PATH = "/.well-known/openid-configuration"


def _read_claim_path(payload: dict, dotted_path: str) -> Any:
    """Descend ``dotted_path`` through a userinfo payload.

    Works for simple claims (``"groups"``) and nested ones
    (``"realm_access.roles"`` on Keycloak). Returns ``None`` if any segment
    is missing or a non-mapping appears partway down.
    """
    cur: Any = payload
    for seg in dotted_path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(seg)
        if cur is None:
            return None
    return cur


def _normalise_roles(raw: Any) -> list[str]:
    """Coerce a roles claim to a list of stripped string values.

    Providers may emit a JSON array (``["admin", "editor"]``), a single
    space-separated string, or a single role. Anything unrecognised yields
    an empty list.
    """
    if raw is None:
        return []
    if isinstance(raw, str):
        return [r.strip() for r in raw.split() if r.strip()]
    if isinstance(raw, list):
        out: list[str] = []
        for r in raw:
            if r is None or not isinstance(r, (str, int)):
                continue
            s = str(r).strip()
            if s:
                out.append(s)
        return out
    return []


def _map_oidc_role(claims: dict, cfg: OidcConfig) -> str | None:
    """Resolve an OIDC userinfo payload to a local users.role value.

    Returns ``None`` when ``sync_roles`` is off, so callers can tell "do
    nothing" apart from "map to default_role / viewer". Precedence is
    admin → editor → viewer; first mapping hit wins. When sync is on but no
    configured group matches, falls back to ``default_role``.
    """
    if not cfg.sync_roles:
        return None
    roles = set(_normalise_roles(_read_claim_path(claims, cfg.roles_claim)))
    for candidate, local in (
        (cfg.admin_roles, "admin"),
        (cfg.editor_roles, "editor"),
        (cfg.viewer_roles, "viewer"),
    ):
        if any(name in roles for name in candidate):
            return local
    return cfg.default_role or "viewer"


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
    # Reuse the central cookie helper so Secure/SameSite match the session
    # cookie exactly (browsers otherwise silently treat mismatched cookies
    # as separate).
    set_auth_cookie(
        response,
        "asclepius_oidc_state",
        state_token,
        config=config,
        max_age=600,
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
        # We only care about the signature being valid; the provider is the
        # authoritative source of ``state`` in the callback URL.
        s.loads(state_cookie, max_age=600)
    except BadSignature:
        raise HTTPException(status_code=400, detail="Invalid OIDC state")

    client = _get_oidc_client()

    # Discover endpoints
    provider_url = config.oidc.provider_url.rstrip("/")
    metadata = await client.fetch_server_metadata(provider_url)

    # Exchange code for token — authlib populates the client credentials
    # into its session, so we do not need to retain the token ourselves.
    callback_url = str(request.url_for("oidc_callback"))
    await client.fetch_token(
        metadata["token_endpoint"],
        authorization_response=str(request.url),
        redirect_uri=callback_url,
    )

    # Get user info
    userinfo_resp = await client.get(metadata["userinfo_endpoint"])
    userinfo = userinfo_resp.json()

    username = userinfo.get(config.oidc.username_claim, "")
    display_name = userinfo.get(config.oidc.display_name_claim, username)
    mapped_role = _map_oidc_role(userinfo, config.oidc)

    if not username:
        raise HTTPException(status_code=400, detail="No username in OIDC claims")

    # Find or create user
    cursor = await db.execute(
        "SELECT id, username, display_name, role FROM users WHERE username = ?",
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
        # When role sync is off, fall through to the schema default (editor).
        # When it's on, use the mapped role even on create so a newly
        # auto-provisioned user lands in the right tier on first login.
        if mapped_role is not None:
            cursor = await db.execute(
                "INSERT INTO users (username, password_hash, display_name, role) "
                "VALUES (?, ?, ?, ?)",
                (username, hash_password(random_password), display_name, mapped_role),
            )
        else:
            cursor = await db.execute(
                "INSERT INTO users (username, password_hash, display_name) " "VALUES (?, ?, ?)",
                (username, hash_password(random_password), display_name),
            )
        user_id = cursor.lastrowid
        await db.commit()
        logger.info(
            "Created OIDC user: %s (id=%d, role=%s)",
            username,
            user_id,
            mapped_role or "default",
        )
    else:
        user_id = user[0]
        current_role = user[3]
        # Update display name if changed
        if display_name and display_name != user[2]:
            await db.execute(
                "UPDATE users SET display_name = ? WHERE id = ?",
                (display_name, user_id),
            )
        # Re-sync the local role on every login when enabled so central IAM
        # changes (add/remove from the admins group) propagate without an
        # admin having to edit the DB by hand. Only write when it actually
        # changed to keep the log quiet.
        if mapped_role is not None and mapped_role != current_role:
            await db.execute(
                "UPDATE users SET role = ? WHERE id = ?",
                (mapped_role, user_id),
            )
            logger.info(
                "OIDC role sync: user=%s id=%d %s → %s",
                username,
                user_id,
                current_role,
                mapped_role,
            )
        await db.commit()

    # Create session
    session_token = await create_session(db, user_id, request)

    # Redirect to app with session cookie
    response = Response(status_code=307, headers={"Location": "/"})
    set_auth_cookie(
        response,
        COOKIE_NAME,
        session_token,
        config=config,
        max_age=config.auth.session_ttl_hours * 3600,
    )
    clear_auth_cookie(response, "asclepius_oidc_state", config=config)
    return response
