"""Async SQLite connection manager."""

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


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """FastAPI dependency that yields an async SQLite connection."""
    config = get_config()
    path = _db_path or config.database.path
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        yield db
