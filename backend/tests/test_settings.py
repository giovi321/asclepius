"""Settings API tests."""

import pytest


@pytest.mark.asyncio
async def test_get_settings(client):
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "llm" in data
    assert "ocr" in data
    assert "pipeline" in data
    assert "vault" in data
    assert "provider_count" in data["llm"]
    assert isinstance(data["llm"]["extraction_timeout"], int)


@pytest.mark.asyncio
async def test_settings_require_auth(unauthed_client):
    resp = await unauthed_client.get("/api/settings")
    assert resp.status_code == 401
