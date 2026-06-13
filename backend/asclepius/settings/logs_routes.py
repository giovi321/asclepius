"""In-memory application log endpoints."""

from fastapi import APIRouter, Depends, Query

from asclepius.auth.session import require_role

router = APIRouter()


@router.get("/logs")
async def get_logs(
    level: str | None = Query(default=None),
    module: str | None = Query(default=None),
    limit: int = Query(default=200),
    current_user: dict = Depends(require_role("admin")),
):
    """Get recent application logs from the in-memory buffer (admin only).

    Logs can contain PHI-adjacent content (file paths, patient slugs in error
    messages), so this is restricted to admins.
    """
    from asclepius.main import LOG_BUFFER

    logs = list(LOG_BUFFER)

    if level:
        levels = level.upper().split(",")
        logs = [entry for entry in logs if entry["level"] in levels]

    if module:
        logs = [entry for entry in logs if module in entry["module"]]

    logs = logs[-limit:]

    return {"logs": logs, "total": len(LOG_BUFFER)}
