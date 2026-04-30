"""Cookie helpers for the share-session cookie.

The share cookie is deliberately distinct from the regular auth cookie
(different name, scoped path) so the two namespaces cannot be confused
for one another by accident.
"""

from __future__ import annotations

from fastapi import Response

from asclepius.config import AppConfig
from asclepius.share.dependencies import SHARE_COOKIE_NAME

# Path scope keeps the cookie out of every endpoint that isn't part of
# the share surface — narrower attack surface than ``/`` even if the
# rest of the app stays oblivious to it.
SHARE_COOKIE_PATH = "/api/share"


def set_share_cookie(response: Response, value: str, *, config: AppConfig, max_age: int) -> None:
    response.set_cookie(
        key=SHARE_COOKIE_NAME,
        value=value,
        httponly=True,
        secure=config.auth.cookie_secure,
        # SameSite=Strict — share cookies are first-party-only and never
        # need to ride along on cross-origin navigations.
        samesite="strict",
        max_age=max_age,
        path=SHARE_COOKIE_PATH,
    )


def clear_share_cookie(response: Response, *, config: AppConfig) -> None:
    response.delete_cookie(
        key=SHARE_COOKIE_NAME,
        path=SHARE_COOKIE_PATH,
        secure=config.auth.cookie_secure,
        samesite="strict",
        httponly=True,
    )
