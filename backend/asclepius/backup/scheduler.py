"""Scheduled backup runner.

Starts from ``main.lifespan`` as an ``asyncio.Task``. Mirrors the pipeline
watcher pattern: cancel and recreate the task when settings change at
runtime so the running server picks up new schedules without a restart.

Three independent jobs share this loop — ``db``, ``vault``, ``full``.
Each job's next-due time is derived from the newest existing file matching
its filename prefix, so restarts don't double-run jobs.
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
from asclepius.config import AppConfig, BackupJobConfig

logger = logging.getLogger(__name__)

JOB_KINDS = ("db", "vault", "full")

# filename prefix → (extension, kind)
_PREFIX = {
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
    """Return the configured directory without touching the filesystem.
    Use :func:`_ensure_backup_dir` when a writable directory is required."""
    return Path(config.backup.directory)


def _ensure_backup_dir(config: AppConfig) -> Path:
    directory = _backup_dir(config)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def list_backup_files(config: AppConfig) -> list[dict]:
    """Return metadata for every file in the backup directory, newest-first.
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
        out.append({
            "name": entry.name,
            "size": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "mtime": stat.st_mtime,
            "type": kind,
        })
    out.sort(key=lambda e: e["mtime"], reverse=True)
    for e in out:
        e.pop("mtime", None)
    return out


def _kind_from_name(name: str) -> str | None:
    for kind, (prefix, _ext) in _PREFIX.items():
        if name.startswith(prefix):
            return kind
    return None


def _files_for(config: AppConfig, kind: str) -> list[Path]:
    directory = _backup_dir(config)
    if not directory.exists():
        return []
    prefix, _ext = _PREFIX[kind]
    return sorted(
        (p for p in directory.iterdir() if p.is_file() and p.name.startswith(prefix)),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )


def last_backup_time(config: AppConfig, kind: str) -> float | None:
    files = _files_for(config, kind)
    if not files:
        return None
    return files[0].stat().st_mtime


def prune(config: AppConfig, kind: str, keep_count: int, keep_days: int) -> int:
    """Delete backups that exceed either the count or the age limit. Returns
    the number of files removed."""
    files = _files_for(config, kind)  # newest first
    now = time.time()
    # Defensive: never accept <1 for count (would delete everything immediately)
    keep_count = max(1, int(keep_count))
    keep_days = max(0, int(keep_days))
    removed = 0
    for idx, path in enumerate(files):
        age_days = (now - path.stat().st_mtime) / 86400
        too_many = idx >= keep_count
        too_old = keep_days > 0 and age_days > keep_days
        if too_many or too_old:
            try:
                path.unlink()
                removed += 1
                logger.info("Pruned backup %s (too_many=%s too_old=%s)", path.name, too_many, too_old)
            except OSError:
                logger.exception("Failed to prune backup %s", path.name)
    return removed


# --- Job runners -------------------------------------------------------------

def _run_db_sync(config: AppConfig) -> Path:
    directory = _ensure_backup_dir(config)
    dest = directory / f"{_PREFIX['db'][0]}{_timestamp()}{_PREFIX['db'][1]}"
    snapshot_db(config.database.path, str(dest))
    return dest


def _should_skip(vault_root: Path, backup_dir: Path, db_path: Path, path: Path) -> bool:
    """Skip the backups subdirectory (recursion) and the live DB family
    (copied separately via ``snapshot_db``). Also skip sqlite WAL/SHM
    sidecars so the archive doesn't contain mid-write state."""
    try:
        resolved = path.resolve()
    except OSError:
        return True
    try:
        resolved.relative_to(backup_dir.resolve())
        return True  # anything inside backup_dir
    except ValueError:
        pass
    if resolved == db_path.resolve():
        return True
    # Sidecars written by SQLite in WAL mode.
    name = resolved.name
    if name in {db_path.name + "-wal", db_path.name + "-shm", db_path.name + "-journal"}:
        return True
    return False


def _add_tree(tar: tarfile.TarFile, vault_root: Path, backup_dir: Path, db_path: Path) -> None:
    """Add every file under ``vault_root`` to ``tar``, skipping the backup
    directory and the live sqlite family."""
    for dirpath, dirnames, filenames in os.walk(vault_root, followlinks=False):
        dir_p = Path(dirpath)
        # Prune the backups subdir so os.walk doesn't even descend into it.
        try:
            rel_to_root = dir_p.resolve().relative_to(vault_root.resolve())
        except ValueError:
            rel_to_root = None
        if rel_to_root is not None:
            # Filter child directories in-place
            pruned: list[str] = []
            for d in dirnames:
                child = (dir_p / d).resolve()
                if _should_skip(vault_root, backup_dir, db_path, child):
                    continue
                pruned.append(d)
            dirnames[:] = pruned
        for fname in filenames:
            src = dir_p / fname
            if _should_skip(vault_root, backup_dir, db_path, src):
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
            # Write DB snapshot to a temp file so the tarball contains a
            # transactionally consistent copy (not the live file which may
            # have WAL writes in flight).
            fd, snap_name = tempfile.mkstemp(prefix="asclepius_snap_", suffix=".sqlite")
            os.close(fd)
            snapshot_tmp = Path(snap_name)
            snapshot_db(config.database.path, str(snapshot_tmp))

        # Open tar; writing to a .part suffix first so a crash mid-write
        # doesn't leave a half-baked file that looks like a real backup.
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


async def run_job(config: AppConfig, kind: str) -> Path:
    """Execute one job in a worker thread and return the written path."""
    if kind == "db":
        path = await asyncio.to_thread(_run_db_sync, config)
    elif kind == "vault":
        path = await asyncio.to_thread(_run_vault_sync, config, include_db=False)
    elif kind == "full":
        path = await asyncio.to_thread(_run_vault_sync, config, include_db=True)
    else:
        raise ValueError(f"Unknown backup kind: {kind!r}")

    job_cfg = getattr(config.backup, kind, None)
    if isinstance(job_cfg, BackupJobConfig):
        try:
            await asyncio.to_thread(
                prune, config, kind, job_cfg.retention_count, job_cfg.retention_days,
            )
        except Exception:
            logger.exception("Retention prune failed for %s", kind)

    logger.info("Backup job %s wrote %s", kind, path.name)
    return path


# --- Scheduler loop ----------------------------------------------------------

def _enabled_jobs(config: AppConfig) -> list[tuple[str, BackupJobConfig]]:
    return [
        (kind, getattr(config.backup, kind))
        for kind in JOB_KINDS
        if getattr(config.backup, kind).enabled
    ]


def _next_due(config: AppConfig, kind: str, job: BackupJobConfig) -> float:
    """Epoch timestamp when this job should next run."""
    interval = _interval_seconds(job.schedule)
    last = last_backup_time(config, kind)
    if last is None:
        # No prior file — run immediately.
        return time.time()
    return last + interval


async def start_backup_scheduler(config: AppConfig, app_state) -> None:
    """Long-running scheduler. Cancel the task to stop; re-create it with a
    fresh config to restart."""
    logger.info(
        "Backup scheduler started (db=%s vault=%s full=%s)",
        config.backup.db.enabled, config.backup.vault.enabled, config.backup.full.enabled,
    )
    try:
        while True:
            jobs = _enabled_jobs(config)
            if not jobs:
                # Nothing to do — long sleep, but still cancellable.
                await asyncio.sleep(3600)
                continue

            now = time.time()
            next_due_ts: float | None = None
            for kind, job in jobs:
                due = _next_due(config, kind, job)
                if due <= now:
                    try:
                        await run_job(config, kind)
                    except Exception:
                        logger.exception("Backup job %s failed", kind)
                    now = time.time()
                    due = now + _interval_seconds(job.schedule)
                if next_due_ts is None or due < next_due_ts:
                    next_due_ts = due

            # Sleep until the nearest next-due, but wake at least hourly so
            # we re-evaluate in case the clock jumps or files get deleted.
            sleep_for = 3600.0
            if next_due_ts is not None:
                sleep_for = min(sleep_for, max(5.0, next_due_ts - time.time()))
            await asyncio.sleep(sleep_for)
    except asyncio.CancelledError:
        logger.info("Backup scheduler stopped")
        raise
