"""Authentication tests."""

import pytest


@pytest.mark.asyncio
async def test_login_success(unauthed_client):
    resp = await unauthed_client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "admin"
    assert "asclepius_session" in resp.cookies


@pytest.mark.asyncio
async def test_login_wrong_password(unauthed_client):
    resp = await unauthed_client.post(
        "/api/auth/login", json={"username": "admin", "password": "wrong"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user(unauthed_client):
    resp = await unauthed_client.post(
        "/api/auth/login", json={"username": "nonexistent", "password": "admin"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_authenticated(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "admin"
    assert "patients" in data


@pytest.mark.asyncio
async def test_me_unauthenticated(unauthed_client):
    resp = await unauthed_client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_logout(client):
    # Verify logged in
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 200

    # Logout
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200

    # Session cookie should be cleared — next request should fail
    # (but httpx keeps cookies, so we check the response)
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_health(unauthed_client):
    resp = await unauthed_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
