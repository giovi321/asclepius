"""Cookie-writing helpers shared by the classic and OIDC login flows.

Using a single helper guarantees every auth cookie gets the same security
attributes (``HttpOnly``, ``SameSite``, ``Secure``). It also makes it trivial
to audit the codebase for cookie writes — grep for ``set_auth_cookie``.
"""

from __future__ import annotations

from fastapi import Response

from asclepius.config import AppConfig


def set_auth_cookie(
    response: Response,
    name: str,
    value: str,
    *,
    config: AppConfig,
    max_age: int | None = None,
) -> None:
    """Set an authentication-grade cookie with hardened defaults."""
    response.set_cookie(
        key=name,
        value=value,
        httponly=True,
        secure=config.auth.cookie_secure,
        samesite=config.auth.cookie_samesite,  # type: ignore[arg-type]
        max_age=max_age,
        path="/",
    )


def clear_auth_cookie(response: Response, name: str, *, config: AppConfig) -> None:
    """Delete an auth cookie with attributes matching ``set_auth_cookie``."""
    response.delete_cookie(
        key=name,
        path="/",
        secure=config.auth.cookie_secure,
        samesite=config.auth.cookie_samesite,  # type: ignore[arg-type]
        httponly=True,
    )
