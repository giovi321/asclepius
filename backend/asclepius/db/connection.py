"""Async SQLite connection manager."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

import aiosqlite

from asclepius.config import get_config

_db_path: str | None = None


def set_db_path(path: str) -> None:
    global _db_path
    _db_path = path


def get_db_path() -> str:
    """Return the active database path without opening a connection."""
    config = get_config()
    return _db_path or config.database.path


async def _apply_pragmas(db: aiosqlite.Connection) -> None:
    """Apply the PRAGMAs every Asclepius connection needs.

    ``foreign_keys`` is a *per-connection* setting in SQLite, so any connection
    that skips it silently disables ``ON DELETE CASCADE`` and orphans child
    rows. ``busy_timeout`` lets writers wait for the lock instead of failing
    immediately under the documented two-container (core + share) deployment.
    """
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    await db.execute("PRAGMA busy_timeout=5000")


@asynccontextmanager
async def open_db(path: str | None = None) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Open a PRAGMA-correct aiosqlite connection.

    The single entry point for opening a connection *outside* the request
    lifecycle — background workers, the pipeline, the file watcher, one-off
    scripts. Use this instead of a bare ``aiosqlite.connect`` so foreign-key
    cascades fire and writers respect the busy timeout. Within a request,
    depend on :func:`get_db` instead.
    """
    if path is None:
        path = _db_path or get_config().database.path
    async with aiosqlite.connect(path) as db:
        await _apply_pragmas(db)
        yield db


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """FastAPI dependency that yields a PRAGMA-correct async SQLite connection."""
    async with open_db() as db:
        yield db
