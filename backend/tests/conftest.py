"""Shared test fixtures.

The fixtures here intentionally:
- Force ``ASCLEPIUS_ENV=development`` so the strict secret / cookie
  validation does not fire during tests.
- Use a random-but-valid-length secret key so ``get_config`` accepts it.
- Disable ``cookie_secure`` so httpx's AsyncClient (which speaks plain
  HTTP to the ASGI app) receives the cookie back.
- Send ``X-Requested-With: XMLHttpRequest`` by default so requests pass
  the CSRF middleware.
"""

import asyncio
import os
from pathlib import Path

import pytest
import pytest_asyncio
import aiosqlite
from httpx import ASGITransport, AsyncClient

# Must be set before any ``asclepius`` import — ``get_config`` runs at
# module load via the middleware stack.
os.environ["ASCLEPIUS_CONFIG_PATH"] = "nonexistent.yaml"
os.environ["ASCLEPIUS_ENV"] = "development"
os.environ["ASCLEPIUS_COOKIE_SECURE"] = "0"
os.environ["ASCLEPIUS_SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long"


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


# Shared headers for every authenticated request — mirrors the frontend
# axios defaults so CSRF middleware accepts the request.
_AUTH_HEADERS = {"X-Requested-With": "XMLHttpRequest"}


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    """Clear the in-process login rate limiter between tests."""
    from asclepius.auth import rate_limit
    rate_limit._attempts.clear()
    yield
    rate_limit._attempts.clear()


@pytest_asyncio.fixture
async def app(db_path, tmp_vault):
    """Create a test FastAPI application."""
    os.environ["ASCLEPIUS_VAULT_PATH"] = str(tmp_vault)

    # Override config
    from asclepius.config import get_config
    get_config.cache_clear()
    config = get_config()
    config.database.path = db_path
    config.vault.root_path = str(tmp_vault)
    config.vault.inbox_path = str(tmp_vault / "inbox")
    config.vault.patients_path = str(tmp_vault / "patients")
    config.vault.unclassified_path = str(tmp_vault / "unclassified")
    config.pipeline.watch_enabled = False

    # Override DB path in connection module
    from asclepius.db.connection import set_db_path
    set_db_path(db_path)

    # Initialize DB
    from asclepius.db.init import initialize_database
    await initialize_database(db_path)

    # Seed a deterministic admin user. We create it directly rather than
    # going through the setup wizard so individual tests can still exercise
    # the wizard when needed.
    from asclepius.auth.session import hash_password
    async with aiosqlite.connect(db_path) as conn:
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) "
            "VALUES (?, ?, ?, 'admin')",
            ("admin", hash_password("admin-password"), "Administrator"),
        )
        await conn.commit()

    from asclepius.main import create_app
    application = create_app()
    return application


@pytest_asyncio.fixture
async def client(app):
    """Authenticated test client with the CSRF header pre-set."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", headers=_AUTH_HEADERS,
    ) as ac:
        resp = await ac.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin-password"},
        )
        assert resp.status_code == 200, resp.text
        yield ac


@pytest_asyncio.fixture
async def unauthed_client(app):
    """Unauthenticated test client (no session cookie)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", headers=_AUTH_HEADERS,
    ) as ac:
        yield ac
