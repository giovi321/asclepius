"""Characterization tests for the settings GET/PATCH round-trip.

Pins the CURRENT behavior of ``GET /api/settings`` and ``PATCH /api/settings``
as admin: the response shape of the ``llm`` and ``ocr`` blocks, and the fact
that a PATCH of a representative scalar in each section is reflected by the
next GET (round-trip).

The PATCH field NAMES differ from the GET field names (the API flattens via
``_SETTINGS_MAP``), so these tests also pin that mapping for the fields they
touch:

    PATCH ``extraction_timeout``      -> GET llm.extraction_timeout
    PATCH ``ocr_language``            -> GET ocr.language
    PATCH ``translation_target_language`` -> GET llm.translation_target_language

These exercise the real FastAPI app (config + YAML persistence), so the PATCH
also writes a settings YAML to ``ASCLEPIUS_CONFIG_PATH`` — which the conftest
points at a nonexistent path; the handler creates it. We do not assert on the
YAML file, only the GET/PATCH round-trip and response shapes.
"""

from __future__ import annotations

import pytest


# Keys the GET llm/ocr blocks currently expose. Pinning the SET of keys catches
# accidental additions/removals during the refactor.
_EXPECTED_LLM_KEYS = {
    "extraction_timeout",
    "max_concurrent_requests",
    "max_retries",
    "retry_backoff_seconds",
    "provider_count",
    "canonical_language",
    "translation_target_language",
    "translation_allowed_languages",
}

_EXPECTED_OCR_KEYS = {
    "engine",
    "language",
    "confidence_threshold",
    "cloud_ocr_enabled",
    "remote_url",
    "has_remote_api_key",
    "llm_vision_provider",
    "llm_vision_model",
    "llm_vision_ollama_url",
    "has_google_vision_key",
    "provider_count",
}


@pytest.mark.asyncio
async def test_get_settings_llm_block_shape(client):
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    llm = resp.json()["llm"]
    assert set(llm.keys()) == _EXPECTED_LLM_KEYS
    # Types currently produced.
    assert isinstance(llm["extraction_timeout"], int)
    assert isinstance(llm["max_concurrent_requests"], int)
    assert isinstance(llm["max_retries"], int)
    assert isinstance(llm["retry_backoff_seconds"], list)
    assert isinstance(llm["provider_count"], int)
    assert isinstance(llm["translation_allowed_languages"], list)


@pytest.mark.asyncio
async def test_get_settings_ocr_block_shape(client):
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    ocr = resp.json()["ocr"]
    assert set(ocr.keys()) == _EXPECTED_OCR_KEYS
    # Secrets are never echoed; only presence flags.
    assert isinstance(ocr["has_remote_api_key"], bool)
    assert isinstance(ocr["has_google_vision_key"], bool)
    assert isinstance(ocr["language"], str)
    assert isinstance(ocr["confidence_threshold"], (int, float))


@pytest.mark.asyncio
async def test_patch_then_get_extraction_timeout_roundtrips(client):
    # Read current, pick a distinct new value.
    before = (await client.get("/api/settings")).json()["llm"]["extraction_timeout"]
    new_value = before + 17

    patch_resp = await client.patch(
        "/api/settings", json={"extraction_timeout": new_value}
    )
    assert patch_resp.status_code == 200, patch_resp.text
    body = patch_resp.json()
    assert body["status"] == "saved"
    assert body["changes"] == {"extraction_timeout": new_value}

    after = (await client.get("/api/settings")).json()["llm"]["extraction_timeout"]
    assert after == new_value


@pytest.mark.asyncio
async def test_patch_then_get_ocr_language_roundtrips(client):
    patch_resp = await client.patch("/api/settings", json={"ocr_language": "deu"})
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["changes"] == {"ocr_language": "deu"}

    after = (await client.get("/api/settings")).json()["ocr"]["language"]
    assert after == "deu"


@pytest.mark.asyncio
async def test_patch_then_get_translation_target_language_roundtrips(client):
    # Move the default to a language guaranteed to be in the allow-list.
    allowed = (await client.get("/api/settings")).json()["llm"][
        "translation_allowed_languages"
    ]
    assert allowed, "expected a non-empty default allow-list"
    target = allowed[0]

    patch_resp = await client.patch(
        "/api/settings", json={"translation_target_language": target}
    )
    assert patch_resp.status_code == 200, patch_resp.text

    after = (await client.get("/api/settings")).json()["llm"][
        "translation_target_language"
    ]
    assert after == target


@pytest.mark.asyncio
async def test_patch_empty_body_returns_400(client):
    """A PATCH with no settable fields is rejected (current behavior)."""
    resp = await client.patch("/api/settings", json={})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "No settings to update"


@pytest.mark.asyncio
async def test_patch_translation_target_outside_allowlist_rejected(client):
    """The cross-field validation rejects a default that is not in the
    allow-list (current behavior)."""
    resp = await client.patch(
        "/api/settings",
        json={
            "translation_allowed_languages": ["English", "Italian"],
            "translation_target_language": "German",
        },
    )
    assert resp.status_code == 400
    assert "translation_target_language" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_patch_unknown_translation_language_rejected(client):
    resp = await client.patch(
        "/api/settings",
        json={"translation_allowed_languages": ["Klingon"]},
    )
    assert resp.status_code == 400
    assert "Unknown translation language" in resp.json()["detail"]
