"""Scheduled backup runner.

One configurable job. The user picks scope (database, vault, or both),
schedule (hourly / daily / weekly), and a single retention policy (last N
files OR everything newer than N days).

The scheduler is started from ``main.lifespan`` as an ``asyncio.Task`` and
is cancelled + recreated when settings change at runtime.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

from asclepius.backup.db import snapshot_db
from asclepius.config import AppConfig

logger = logging.getLogger(__name__)

# filename prefix -> extension. ``kind`` is computed from the current scope.
_PREFIX: dict[str, tuple[str, str]] = {
    "db": ("asclepius_db_", ".sqlite"),
    "vault": ("asclepius_vault_", ".tar.gz"),
    "full": ("asclepius_full_", ".tar.gz"),
}

_SCHEDULE_SECONDS = {
    "hourly": 3600,
    "daily": 86400,
    "weekly": 7 * 86400,
}


def _interval_seconds(schedule: str) -> int:
    return _SCHEDULE_SECONDS.get(schedule, _SCHEDULE_SECONDS["daily"])


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _backup_dir(config: AppConfig) -> Path:
    """Return the configured directory without touching the filesystem."""
    return Path(config.backup.directory)


def _ensure_backup_dir(config: AppConfig) -> Path:
    directory = _backup_dir(config)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def compute_kind(config: AppConfig) -> str | None:
    """Map the (include_database, include_vault) flags to a file kind."""
    inc_db = bool(config.backup.include_database)
    inc_vault = bool(config.backup.include_vault)
    if inc_db and inc_vault:
        return "full"
    if inc_db:
        return "db"
    if inc_vault:
        return "vault"
    return None


def _kind_from_name(name: str) -> str | None:
    for kind, (prefix, _ext) in _PREFIX.items():
        if name.startswith(prefix):
            return kind
    return None


def list_backup_files(config: AppConfig) -> list[dict]:
    """Return metadata for every backup file, newest-first.
    Returns an empty list if the directory does not exist yet."""
    directory = _backup_dir(config)
    if not directory.exists():
        return []
    out: list[dict] = []
    for entry in directory.iterdir():
        if not entry.is_file():
            continue
        kind = _kind_from_name(entry.name)
        if kind is None:
            continue
        stat = entry.stat()
        out.append(
            {
                "name": entry.name,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                "mtime": stat.st_mtime,
                "type": kind,
            }
        )
    out.sort(key=lambda e: e["mtime"], reverse=True)
    for e in out:
        e.pop("mtime", None)
    return out


def _all_backup_paths(config: AppConfig) -> list[Path]:
    """All backup files sorted newest-first."""
    directory = _backup_dir(config)
    if not directory.exists():
        return []
    return sorted(
        (p for p in directory.iterdir() if p.is_file() and _kind_from_name(p.name)),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )


def last_backup_time(config: AppConfig) -> float | None:
    files = _all_backup_paths(config)
    if not files:
        return None
    return files[0].stat().st_mtime


def prune(config: AppConfig) -> int:
    """Apply the configured retention policy across all backup files.
    Returns the number of files deleted."""
    mode = config.backup.retention_mode
    value = max(1, int(config.backup.retention_value or 1))
    files = _all_backup_paths(config)
    removed = 0
    if mode == "days":
        cutoff = time.time() - value * 86400
        to_remove = [p for p in files if p.stat().st_mtime < cutoff]
    else:  # "count" (default)
        to_remove = files[value:]

    for path in to_remove:
        try:
            path.unlink()
            removed += 1
            logger.info("Pruned backup %s (mode=%s value=%s)", path.name, mode, value)
        except OSError:
            logger.exception("Failed to prune backup %s", path.name)
    return removed


# --- Job runners -------------------------------------------------------------


def _run_db_sync(config: AppConfig) -> Path:
    directory = _ensure_backup_dir(config)
    dest = directory / f"{_PREFIX['db'][0]}{_timestamp()}{_PREFIX['db'][1]}"
    snapshot_db(config.database.path, str(dest))
    return dest


def _should_skip(backup_dir: Path, db_path: Path, path: Path) -> bool:
    """Skip the backups subdirectory (recursion) and the live DB family
    (copied separately via ``snapshot_db``)."""
    try:
        resolved = path.resolve()
    except OSError:
        return True
    try:
        resolved.relative_to(backup_dir.resolve())
        return True
    except ValueError:
        pass
    if resolved == db_path.resolve():
        return True
    name = resolved.name
    if name in {db_path.name + "-wal", db_path.name + "-shm", db_path.name + "-journal"}:
        return True
    return False


def _add_tree(tar: tarfile.TarFile, vault_root: Path, backup_dir: Path, db_path: Path) -> None:
    for dirpath, dirnames, filenames in os.walk(vault_root, followlinks=False):
        dir_p = Path(dirpath)
        try:
            rel_to_root = dir_p.resolve().relative_to(vault_root.resolve())
        except ValueError:
            rel_to_root = None
        if rel_to_root is not None:
            pruned: list[str] = []
            for d in dirnames:
                child = (dir_p / d).resolve()
                if _should_skip(backup_dir, db_path, child):
                    continue
                pruned.append(d)
            dirnames[:] = pruned
        for fname in filenames:
            src = dir_p / fname
            if _should_skip(backup_dir, db_path, src):
                continue
            arcname = str(Path("vault") / src.relative_to(vault_root))
            try:
                tar.add(str(src), arcname=arcname, recursive=False)
            except (OSError, FileNotFoundError):
                logger.exception("Failed to add %s to vault archive; continuing", src)


def _run_vault_sync(config: AppConfig, *, include_db: bool) -> Path:
    directory = _ensure_backup_dir(config)
    kind = "full" if include_db else "vault"
    prefix, ext = _PREFIX[kind]
    dest = directory / f"{prefix}{_timestamp()}{ext}"
    vault_root = Path(config.vault.root_path)
    db_path = Path(config.database.path)

    snapshot_tmp: Path | None = None
    try:
        if include_db:
            fd, snap_name = tempfile.mkstemp(prefix="asclepius_snap_", suffix=".sqlite")
            os.close(fd)
            snapshot_tmp = Path(snap_name)
            snapshot_db(config.database.path, str(snapshot_tmp))

        part = dest.with_suffix(dest.suffix + ".part")
        with tarfile.open(str(part), "w:gz") as tar:
            if include_db and snapshot_tmp is not None:
                tar.add(str(snapshot_tmp), arcname="asclepius.sqlite")
            if vault_root.exists():
                _add_tree(tar, vault_root, directory, db_path)
        part.rename(dest)
    finally:
        if snapshot_tmp is not None and snapshot_tmp.exists():
            try:
                snapshot_tmp.unlink()
            except OSError:
                pass

    return dest


async def run_current_job(config: AppConfig) -> Path:
    """Run the backup whose scope matches the current configuration.
    Raises ``ValueError`` if neither database nor vault is selected."""
    kind = compute_kind(config)
    if kind is None:
        raise ValueError("Select at least one of: database, vault")

    if kind == "db":
        path = await asyncio.to_thread(_run_db_sync, config)
    elif kind == "vault":
        path = await asyncio.to_thread(_run_vault_sync, config, include_db=False)
    else:  # full
        path = await asyncio.to_thread(_run_vault_sync, config, include_db=True)

    try:
        await asyncio.to_thread(prune, config)
    except Exception:
        logger.exception("Retention prune failed")

    logger.info("Backup wrote %s", path.name)
    return path


# --- Scheduler loop ----------------------------------------------------------


def _next_due(config: AppConfig) -> float:
    last = last_backup_time(config)
    if last is None:
        return 0.0
    return last + _interval_seconds(config.backup.schedule)


async def start_backup_scheduler(config: AppConfig, app_state) -> None:
    """Long-running scheduler. Cancel the task to stop; re-create it with a
    fresh config to restart after settings changes."""
    kind = compute_kind(config)
    logger.info(
        "Backup scheduler started (enabled=%s scope=%s schedule=%s retention=%s %s)",
        config.backup.enabled,
        kind,
        config.backup.schedule,
        config.backup.retention_mode,
        config.backup.retention_value,
    )
    try:
        while True:
            try:
                if not config.backup.enabled or compute_kind(config) is None:
                    await asyncio.sleep(3600)
                    continue

                now = time.time()
                due = _next_due(config)
                if due <= now:
                    try:
                        await run_current_job(config)
                    except Exception:
                        logger.exception("Backup job failed")
                    due = time.time() + _interval_seconds(config.backup.schedule)

                sleep_for = max(5.0, min(3600.0, due - time.time()))
                await asyncio.sleep(sleep_for)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Backup scheduler iteration failed; retrying in 60s")
                await asyncio.sleep(60)
    except asyncio.CancelledError:
        logger.info("Backup scheduler stopped")
        raise
