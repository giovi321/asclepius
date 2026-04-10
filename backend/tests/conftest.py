"""Shared test fixtures."""

import asyncio
import os
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio
import aiosqlite
from httpx import ASGITransport, AsyncClient

# Set config before importing app
os.environ["ASCLEPIUS_CONFIG_PATH"] = "nonexistent.yaml"


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def tmp_vault(tmp_path):
    """Create a temporary vault directory structure."""
    vault = tmp_path / "vault"
    (vault / "inbox").mkdir(parents=True)
    (vault / "patients").mkdir(parents=True)
    (vault / "unclassified").mkdir(parents=True)
    return vault


@pytest_asyncio.fixture
async def db_path(tmp_path):
    """Create a temporary database path."""
    return str(tmp_path / "test.sqlite")


@pytest_asyncio.fixture
async def db(db_path):
    """Initialize a test database and return a connection."""
    from asclepius.db.init import initialize_database
    await initialize_database(db_path)

    async with aiosqlite.connect(db_path) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA foreign_keys=ON")
        yield conn


@pytest_asyncio.fixture
async def app(db_path, tmp_vault):
    """Create a test FastAPI application."""
    os.environ["ASCLEPIUS_VAULT_PATH"] = str(tmp_vault)
    os.environ["ASCLEPIUS_SECRET_KEY"] = "test-secret-key"

    # Override config
    from asclepius.config import get_config, load_config
    get_config.cache_clear()
    config = get_config()
    config.database.path = db_path
    config.vault.root_path = str(tmp_vault)
    config.vault.inbox_path = str(tmp_vault / "inbox")
    config.vault.patients_path = str(tmp_vault / "patients")
    config.vault.unclassified_path = str(tmp_vault / "unclassified")
    config.pipeline.watch_enabled = False  # Don't start watcher in tests
    config.auth.secret_key = "test-secret-key"

    # Override DB path in connection module
    from asclepius.db.connection import set_db_path
    set_db_path(db_path)

    # Initialize DB
    from asclepius.db.init import initialize_database
    await initialize_database(db_path)

    # Create admin user
    async with aiosqlite.connect(db_path) as conn:
        await conn.execute("PRAGMA foreign_keys=ON")
        from asclepius.auth.session import ensure_admin_exists
        await ensure_admin_exists(conn)

    from asclepius.main import create_app
    application = create_app()
    return application


@pytest_asyncio.fixture
async def client(app):
    """Create an authenticated test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Login as admin
        resp = await ac.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        assert resp.status_code == 200
        yield ac


@pytest_asyncio.fixture
async def unauthed_client(app):
    """Create an unauthenticated test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
