"""ASGI middleware: security headers, CSRF protection, request size limits.

These are intentionally lightweight — every incoming request passes through
them, so correctness and performance matter more than flexibility.
"""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from asclepius.auth.session import COOKIE_NAME
from asclepius.config import AppConfig
from asclepius.share.dependencies import SHARE_COOKIE_NAME, SHARE_QUEUE_COOKIE_NAME

logger = logging.getLogger(__name__)

# Methods that mutate server state and therefore require CSRF protection.
_STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Header that browsers cannot set cross-origin without CORS preflight, making
# it a reliable CSRF marker for cookie-authenticated APIs. The frontend axios
# instance sets this automatically.
_CSRF_HEADER = "x-requested-with"
_CSRF_HEADER_VALUE = "XMLHttpRequest"

# Paths exempt from CSRF — OIDC callback is initiated by the provider and
# has no access to our frontend's headers; it is protected by a signed state
# cookie instead (see ``auth/oidc.py``).
_CSRF_EXEMPT_PREFIXES = (
    "/api/auth/oidc/",  # OIDC redirect/callback
    "/api/setup/",  # pre-auth first-run wizard
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add conservative security headers to every response.

    CSP is intentionally simple; tighten once the frontend build pipeline
    stops emitting inline styles (React + Tailwind is CSP-friendly).
    """

    def __init__(self, app: ASGIApp, *, config: AppConfig) -> None:
        super().__init__(app)
        self._is_prod = config.server.environment.lower() == "production"

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault(
            "Permissions-Policy",
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
            "microphone=(), payment=(), usb=()",
        )
        # Only send HSTS when we can assume HTTPS (production). Browsers
        # that see it over HTTP ignore it but it is good hygiene to gate.
        if self._is_prod:
            headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        # CSP: self-only, allow inline styles (Tailwind/shadcn need them) but
        # no inline scripts. Blob/data URLs are needed by the DICOM viewer.
        headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "font-src 'self' data:; "
            "connect-src 'self'; "
            "worker-src 'self' blob:; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'",
        )
        return response


class CsrfMiddleware(BaseHTTPMiddleware):
    """Require a custom header on cookie-authenticated mutations.

    This is the "custom request header" pattern documented in the OWASP CSRF
    cheat sheet. Browsers will not send ``X-Requested-With`` on a cross-site
    form submission, and adding it via fetch/XHR triggers a CORS preflight,
    which our restrictive CORS policy will reject.
    """

    async def dispatch(self, request: Request, call_next):
        if request.method in _STATE_CHANGING_METHODS:
            path = request.url.path
            # Only enforce when the request carries our session cookie;
            # endpoints that bootstrap a session (login, setup) set the
            # cookie on their response and therefore have no cookie on the
            # request.
            has_session_cookie = (
                COOKIE_NAME in request.cookies
                or SHARE_COOKIE_NAME in request.cookies
                or SHARE_QUEUE_COOKIE_NAME in request.cookies
            )
            exempt = any(path.startswith(p) for p in _CSRF_EXEMPT_PREFIXES) or path in (
                "/api/auth/login",
                # Logout is intentionally CSRF-exempt so the doctor's
                # ``pagehide`` beacon (sendBeacon cannot set custom
                # headers) can free the share's single-session slot
                # the moment the tab closes. The worst a CSRF attacker
                # could do here is log a user out — annoying, not
                # a security boundary.
                "/api/share/logout",
            )
            if has_session_cookie and not exempt:
                header_val = request.headers.get(_CSRF_HEADER, "").strip()
                if header_val.lower() != _CSRF_HEADER_VALUE.lower():
                    logger.warning(
                        "CSRF block: %s %s (missing %s header)",
                        request.method,
                        path,
                        _CSRF_HEADER,
                    )
                    return JSONResponse(
                        {"detail": "CSRF protection: missing X-Requested-With header"},
                        status_code=403,
                    )
        return await call_next(request)


class ErrorAuditMiddleware(BaseHTTPMiddleware):
    """Record 4xx/5xx API responses to the audit_log table.

    Feeds the existing audit trail with the same data we used to only see
    in the application log: path, method, status, user id, and client IP.
    Keeps the write non-fatal — an audit failure must never propagate back
    to the response.
    """

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        status = response.status_code
        # Only care about API error responses; 2xx/3xx and static-asset
        # routes stay out of the audit log.
        if status < 400 or not request.url.path.startswith("/api/"):
            return response
        try:
            from asclepius.audit.service import audit_log as _audit_log, get_client_ip
            from asclepius.db.connection import open_db

            user_id: int | None = None
            try:
                user = getattr(request.state, "user", None)
                if isinstance(user, dict):
                    user_id = user.get("id")
            except Exception:
                user_id = None

            details = {
                "method": request.method,
                "path": request.url.path,
                "status": status,
            }
            async with open_db() as db:
                await _audit_log(
                    db,
                    user_id=user_id,
                    action="http.error",
                    resource_type="http",
                    resource_id=None,
                    details=details,
                    ip_address=get_client_ip(request),
                )
        except Exception:
            logger.debug("ErrorAuditMiddleware: non-fatal failure", exc_info=True)
        return response


class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length exceeds the configured limit.

    We only check the header here — the actual streamed size is bounded by
    the upload handler, which reads in capped chunks. This middleware catches
    the easy case early and lets us return a clean 413 instead of OOMing.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        super().__init__(app)
        self._max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > self._max_bytes:
            return JSONResponse(
                {"detail": f"Request body exceeds {self._max_bytes} bytes"},
                status_code=413,
            )
        return await call_next(request)
