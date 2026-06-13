"""Prove that UI-customized prompts now reach the provider methods.

Before this change, ``classify`` / ``generate_sql`` used frozen import-time
prompt constants, so a custom "classification" / "sql_generation" prompt saved
in Settings was honored only by the one main-extraction call site that wired it
up by hand — the chunked-document and chat paths silently ignored it. The
provider now resolves the DB override itself, so every call site honors it.
"""

import pytest

from asclepius.db.init import initialize_database
from asclepius.llm.ollama import OllamaProvider


def _capture_raw():
    captured: dict = {}

    async def fake_raw(prompt, *, force_json, timeout, max_output_tokens):
        captured["prompt"] = prompt
        return '{"doc_type": "other"}'

    return captured, fake_raw


@pytest.mark.asyncio
async def test_classify_honors_db_prompt_override(tmp_path):
    from asclepius.llm.prompt_manager import set_prompt

    db_path = str(tmp_path / "p.sqlite")
    await initialize_database(db_path)
    await set_prompt(db_path, "classification", "CUSTOM-CLASSIFY {ocr_text}")

    captured, fake_raw = _capture_raw()
    provider = OllamaProvider(base_url="http://x", model="m", timeout=5)
    provider._db_path = db_path
    provider._raw_generate = fake_raw  # bypass the network

    await provider.classify(
        "hello world", {"patient_list": [], "facility_list": [], "doctor_list": []}
    )
    assert "CUSTOM-CLASSIFY" in captured["prompt"]
    assert "hello world" in captured["prompt"]


@pytest.mark.asyncio
async def test_classify_without_db_path_uses_default(tmp_path):
    # A provider with no _db_path (e.g. constructed directly) keeps using the
    # built-in default — no DB lookup, no behavior change.
    captured, fake_raw = _capture_raw()
    provider = OllamaProvider(base_url="http://x", model="m", timeout=5)
    provider._raw_generate = fake_raw
    await provider.classify(
        "hi", {"patient_list": [], "facility_list": [], "doctor_list": []}
    )
    assert "CUSTOM-CLASSIFY" not in captured["prompt"]


@pytest.mark.asyncio
async def test_generate_sql_honors_db_prompt_override(tmp_path):
    from asclepius.llm.prompt_manager import set_prompt

    db_path = str(tmp_path / "q.sqlite")
    await initialize_database(db_path)
    await set_prompt(
        db_path, "sql_generation", "CUSTOM-SQL {schema} {context} {question}"
    )

    captured, fake_raw = _capture_raw()
    provider = OllamaProvider(base_url="http://x", model="m", timeout=5)
    provider._db_path = db_path
    provider._raw_generate = fake_raw

    await provider.generate_sql("how many docs?", "schema-here", "ctx")
    assert "CUSTOM-SQL" in captured["prompt"]
    assert "how many docs?" in captured["prompt"]
