"""Audit log, on-demand backup download, and scheduled-backup endpoints."""

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request

import aiosqlite
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.auth.session import require_role
from asclepius.config import get_config
from asclepius.db.connection import get_db

router = APIRouter()


def _backup_state_block(config):
    """Flat backup state block returned by GET /settings."""
    from datetime import datetime as _dt

    from asclepius.backup.scheduler import last_backup_time

    last = last_backup_time(config)
    return {
        "directory": config.backup.directory,
        "enabled": config.backup.enabled,
        "include_database": config.backup.include_database,
        "include_vault": config.backup.include_vault,
        "schedule": config.backup.schedule,
        "retention_mode": config.backup.retention_mode,
        "retention_value": config.backup.retention_value,
        "last_backup_at": _dt.fromtimestamp(last).isoformat(timespec="seconds") if last else None,
    }


@router.get("/audit-log")
async def get_audit_log(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
    user_id: int | None = Query(default=None),
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get audit log entries (admin only)."""
    conditions = []
    params: list = []
    if action:
        conditions.append("a.action LIKE ?")
        params.append(f"%{action}%")
    if user_id is not None:
        conditions.append("a.user_id = ?")
        params.append(user_id)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    cursor = await db.execute(
        f"""SELECT a.*, u.username
            FROM audit_log a
            LEFT JOIN users u ON a.user_id = u.id
            {where}
            ORDER BY a.created_at DESC
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    )
    items = [dict(r) for r in await cursor.fetchall()]

    count_cursor = await db.execute(f"SELECT COUNT(*) FROM audit_log a {where}", params)
    total = (await count_cursor.fetchone())[0]

    return {"items": items, "total": total}


@router.get("/backup")
async def download_backup(
    current_user: dict = Depends(require_role("admin")),
):
    """Download a SQLite backup of the database (admin only)."""
    import tempfile
    from datetime import datetime

    from fastapi.responses import FileResponse

    from asclepius.backup.db import snapshot_db

    config = get_config()
    db_path = config.database.path

    backup_name = f"asclepius_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sqlite"
    backup_path = os.path.join(tempfile.gettempdir(), backup_name)

    try:
        snapshot_db(db_path, backup_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

    return FileResponse(
        path=backup_path,
        filename=backup_name,
        media_type="application/x-sqlite3",
        background=None,
    )


@router.get("/backup/files")
async def list_scheduled_backups(
    current_user: dict = Depends(require_role("admin")),
):
    """List files in the scheduled-backup directory, newest-first (admin only)."""
    from asclepius.backup.scheduler import list_backup_files

    config = get_config()
    return {"files": list_backup_files(config), "directory": config.backup.directory}


@router.get("/backup/files/{name}")
async def download_scheduled_backup(
    name: str,
    current_user: dict = Depends(require_role("admin")),
):
    """Download a single scheduled-backup file (admin only)."""
    from fastapi.responses import FileResponse

    from asclepius.util.paths import is_within, safe_filename

    config = get_config()
    safe = safe_filename(name)
    target = Path(config.backup.directory) / safe
    if not is_within(config.backup.directory, target) or not target.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found")

    media = "application/gzip" if safe.endswith(".tar.gz") else "application/x-sqlite3"
    return FileResponse(path=str(target), filename=safe, media_type=media)


@router.delete("/backup/files/{name}")
async def delete_scheduled_backup(
    name: str,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a scheduled-backup file (admin only)."""
    from asclepius.util.paths import is_within, safe_filename

    config = get_config()
    safe = safe_filename(name)
    target = Path(config.backup.directory) / safe
    if not is_within(config.backup.directory, target) or not target.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found")

    try:
        target.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")

    await audit_log(
        db,
        current_user["id"],
        "backup.delete",
        "backup",
        None,
        {"name": safe},
        get_client_ip(request),
    )
    return {"ok": True}


@router.post("/backup/run")
async def run_scheduled_backup(
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Trigger a backup immediately using the configured scope. Returns the
    written filename."""
    from asclepius.backup.scheduler import compute_kind, run_current_job

    config = get_config()
    kind = compute_kind(config)
    if kind is None:
        raise HTTPException(status_code=400, detail="Select at least one of: database, vault")

    try:
        path = await run_current_job(config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {type(e).__name__}: {e}")

    await audit_log(
        db,
        current_user["id"],
        "backup.run",
        "backup",
        None,
        {"kind": kind, "file": path.name},
        get_client_ip(request),
    )
    return {"ok": True, "file": path.name, "kind": kind}
