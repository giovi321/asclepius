"""Audit logging service — records user actions for compliance and debugging."""

import json
import logging

import aiosqlite
from fastapi import Request

logger = logging.getLogger(__name__)


async def audit_log(
    db: aiosqlite.Connection,
    user_id: int | None,
    action: str,
    resource_type: str | None = None,
    resource_id: int | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
) -> None:
    """Record an audit log entry."""
    try:
        details_json = json.dumps(details) if details else None
        await db.execute(
            """INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, action, resource_type, resource_id, details_json, ip_address),
        )
        await db.commit()
    except Exception:
        logger.warning("Failed to write audit log entry: %s", action, exc_info=True)


def get_client_ip(request: Request) -> str:
    """Extract the client IP from a request, considering X-Forwarded-For."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
