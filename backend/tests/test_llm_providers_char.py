"""Characterization tests for the LLM provider layer.

These pin the *current* behavior of the Ollama / OpenAI / Claude providers
(``asclepius/llm/{base,claude,ollama,openai_provider}.py``) and the shared
JSON parser (``asclepius/llm/json_utils.py``) so an upcoming refactor can be
proven behavior-preserving. They capture what the code does TODAY, including
quirks — NOT what it "should" do.

The single most important pin here is the **retry + force_json divergence**:

    * Ollama / OpenAI honor a retry config (N attempts on transient network
      errors) and a ``force_json`` flag (sets ``format=json`` /
      ``response_format``).
    * Claude's ``_generate`` makes exactly ONE call (no retry) and silently
      ignores ``force_json`` and ``timeout_override``.

The refactor will deliberately unify this. These tests document the
before-state so that change shows up as an intentional, visible diff.

Network/SDK boundary is mocked:
    * httpx ``AsyncClient.post`` for Ollama/OpenAI;
    * the AsyncAnthropic ``client.messages.create`` coroutine for Claude.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

import httpx
import pytest

from asclepius.llm.claude import ClaudeProvider
from asclepius.llm.json_utils import parse_llm_json
from asclepius.llm.ollama import OllamaProvider
from asclepius.llm.openai_provider import OpenAIProvider


# --------------------------------------------------------------------------
# Test doubles for the network seam.
# --------------------------------------------------------------------------


class _FakeResponse:
    """Minimal stand-in for an ``httpx.Response``."""

    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "error", request=None, response=None  # type: ignore[arg-type]
            )


def _ollama_post_returning(text: str):
    """Build an async ``httpx.AsyncClient.post`` replacement that records the
    JSON body it was called with and returns an Ollama-shaped response."""
    captured: dict = {}

    async def _post(self, url, json=None, **kwargs):  # noqa: A002
        captured["url"] = url
        captured["body"] = json
        return _FakeResponse({"response": text})

    return _post, captured


def _ollama_chat_post_returning(content: str):
    captured: dict = {}

    async def _post(self, url, json=None, **kwargs):  # noqa: A002
        captured["url"] = url
        captured["body"] = json
        return _FakeResponse({"message": {"content": content}})

    return _post, captured


def _openai_post_returning(content: str):
    captured: dict = {}

    async def _post(self, url, headers=None, json=None, **kwargs):  # noqa: A002
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = json
        return _FakeResponse({"choices": [{"message": {"content": content}}]})

    return _post, captured


class _FakeMessage:
    """Mimics an Anthropic ``Message`` with ``.content[0].text``."""

    class _Block:
        def __init__(self, text: str):
            self.text = text

    def __init__(self, text: str):
        self.content = [self._Block(text)]


def _claude_create_returning(text: str, *, on_call=None):
    """Build an async replacement for ``client.messages.create`` that records
    its kwargs and returns a fake Anthropic message."""
    captured: dict = {"calls": 0, "kwargs": []}

    async def _create(**kwargs):
        captured["calls"] += 1
        captured["kwargs"].append(kwargs)
        if on_call is not None:
            on_call(captured["calls"])
        return _FakeMessage(text)

    return _create, captured


# A representative classification / extraction JSON payload.
_CLASSIFY_JSON = json.dumps(
    {
        "doc_type": "lab_report",
        "patient_name": "Jane Doe",
        "document_date": "2024-01-02",
        "summary": "Routine bloodwork.",
    }
)
_EXTRACT_JSON = json.dumps(
    {
        "doc_type": "lab_report",
        "lab_results": [
            {"test_name_original": "WBC", "value": "5.0", "unit": "10^9/L"},
            {"test_name_original": "RBC", "value": "4.7", "unit": "10^12/L"},
        ],
    }
)


# ==========================================================================
# 1. classify() / extract() / generate_sql() parsed shape
# ==========================================================================


@pytest.mark.asyncio
async def test_ollama_classify_returns_parsed_dict():
    post, captured = _ollama_post_returning(_CLASSIFY_JSON)
    provider = OllamaProvider(base_url="http://ollama", model="qwen", timeout=5)
    with patch.object(httpx.AsyncClient, "post", post):
        result = await provider.classify("OCR TEXT", {})
    assert result == {
        "doc_type": "lab_report",
        "patient_name": "Jane Doe",
        "document_date": "2024-01-02",
        "summary": "Routine bloodwork.",
    }
    # classify routes through /api/generate with force_json default True.
    assert captured["url"].endswith("/api/generate")
    assert captured["body"]["format"] == "json"
    assert captured["body"]["stream"] is False


@pytest.mark.asyncio
async def test_ollama_extract_returns_parsed_dict():
    post, captured = _ollama_post_returning(_EXTRACT_JSON)
    provider = OllamaProvider(base_url="http://ollama", model="qwen", timeout=5)
    with patch.object(httpx.AsyncClient, "post", post):
        result = await provider.extract("OCR TEXT", {})
    assert result["doc_type"] == "lab_report"
    assert [r["test_name_original"] for r in result["lab_results"]] == ["WBC", "RBC"]


@pytest.mark.asyncio
async def test_ollama_generate_sql_extracts_from_fenced_block():
    # generate_sql passes force_json=False; the fenced ```sql``` block wins.
    post, captured = _ollama_post_returning(
        "Here is the query:\n```sql\nSELECT * FROM patients\n```"
    )
    provider = OllamaProvider(base_url="http://ollama", model="qwen", timeout=5)
    with patch.object(httpx.AsyncClient, "post", post):
        sql = await provider.generate_sql("who?", "schema", "ctx")
    assert sql == "SELECT * FROM patients"
    # SQL generation must NOT set format=json (would coerce reply to {}).
    assert "format" not in captured["body"]


@pytest.mark.asyncio
async def test_ollama_generate_sql_bare_select_without_fence():
    post, _ = _ollama_post_returning("SELECT id FROM documents WHERE patient_id = 1")
    provider = OllamaProvider(base_url="http://ollama", model="qwen", timeout=5)
    with patch.object(httpx.AsyncClient, "post", post):
        sql = await provider.generate_sql("q", "s", "c")
    assert sql == "SELECT id FROM documents WHERE patient_id = 1"


@pytest.mark.asyncio
async def test_openai_classify_returns_parsed_dict():
    post, captured = _openai_post_returning(_CLASSIFY_JSON)
    provider = OpenAIProvider(api_key="k", model="gpt", base_url="http://oai/v1", timeout=5)
    with patch.object(httpx.AsyncClient, "post", post):
        result = await provider.classify("OCR", {})
    assert result["doc_type"] == "lab_report"
    assert result["patient_name"] == "Jane Doe"
    # _generate defaults force_json=True -> json_object response_format.
    assert captured["body"]["response_format"] == {"type": "json_object"}
    assert captured["url"].endswith("/chat/completions")


@pytest.mark.asyncio
async def test_openai_generate_sql_strips_fence_and_skips_json_mode():
    post, captured = _openai_post_returning("```sql\nSELECT 1\n```")
    provider = OpenAIProvider(api_key="k", model="gpt", base_url="http://oai/v1", timeout=5)
    with patch.object(httpx.AsyncClient, "post", post):
        sql = await provider.generate_sql("q", "s", "c")
    assert sql == "SELECT 1"
    assert "response_format" not in captured["body"]


@pytest.mark.asyncio
async def test_claude_classify_returns_parsed_dict():
    create, captured = _claude_create_returning(_CLASSIFY_JSON)
    provider = ClaudeProvider(api_key="k", model="claude-x", timeout=5)
    with patch.object(provider.client.messages, "create", create):
        result = await provider.classify("OCR", {})
    assert result["doc_type"] == "lab_report"
    assert result["patient_name"] == "Jane Doe"
    assert captured["calls"] == 1
    # No format/response_format toggle exists on the Anthropic call.
    kw = captured["kwargs"][0]
    assert kw["model"] == "claude-x"
    assert "messages" in kw and kw["messages"][0]["role"] == "user"


@pytest.mark.asyncio
async def test_claude_extract_returns_parsed_dict():
    create, captured = _claude_create_returning(_EXTRACT_JSON)
    provider = ClaudeProvider(api_key="k", model="claude-x", timeout=5)
    with patch.object(provider.client.messages, "create", create):
        result = await provider.extract("OCR", {})
    assert [r["test_name_original"] for r in result["lab_results"]] == ["WBC", "RBC"]


@pytest.mark.asyncio
async def test_claude_generate_sql_extracts_select():
    create, captured = _claude_create_returning("```sql\nSELECT * FROM labs\n```")
    provider = ClaudeProvider(api_key="k", model="claude-x", timeout=5)
    with patch.object(provider.client.messages, "create", create):
        sql = await provider.generate_sql("q", "s", "c")
    assert sql == "SELECT * FROM labs"
    # generate_sql caps Claude at max_tokens=1024 (vs extraction cap elsewhere).
    assert captured["kwargs"][0]["max_tokens"] == 1024


# ==========================================================================
# 2. RETRY + force_json divergence — the central pin.
# ==========================================================================


@pytest.mark.asyncio
async def test_ollama_retries_n_times_then_raises():
    """Ollama honors the per-provider retry config: with _retry_max=2 it makes
    exactly 3 attempts (max_retries + 1) on a transient ConnectError, then
    re-raises the last error."""
    provider = OllamaProvider(base_url="http://ollama", model="qwen", timeout=1)
    provider._retry_max = 2
    provider._retry_backoff = [0, 0]  # no real backoff sleep
    calls = {"n": 0}

    async def boom(self, *a, **k):
        calls["n"] += 1
        raise httpx.ConnectError("ollama down")

    with patch.object(httpx.AsyncClient, "post", boom):
        with pytest.raises(httpx.ConnectError):
            await provider._generate("prompt", max_output_tokens=128)

    assert calls["n"] == 3  # 2 retries + 1 initial = 3 calls


@pytest.mark.asyncio
async def test_ollama_succeeds_on_second_attempt():
    """A transient failure followed by success returns the good response and
    stops retrying."""
    provider = OllamaProvider(base_url="http://ollama", model="qwen", timeout=1)
    provider._retry_max = 3
    provider._retry_backoff = [0, 0, 0]
    calls = {"n": 0}

    async def flaky(self, url, json=None, **k):  # noqa: A002
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ReadTimeout("slow")
        return _FakeResponse({"response": _EXTRACT_JSON})

    with patch.object(httpx.AsyncClient, "post", flaky):
        result = await provider._generate("prompt", max_output_tokens=128)

    assert calls["n"] == 2
    assert "lab_results" in json.loads(result)


@pytest.mark.asyncio
async def test_ollama_generate_force_json_toggles_format_field():
    """force_json=True sets ``format=json``; force_json=False omits it."""
    provider = OllamaProvider(base_url="http://ollama", model="qwen", timeout=5)

    post_on, cap_on = _ollama_post_returning("{}")
    with patch.object(httpx.AsyncClient, "post", post_on):
        await provider._generate("p", force_json=True, max_output_tokens=64)
    assert cap_on["body"]["format"] == "json"

    post_off, cap_off = _ollama_post_returning("{}")
    with patch.object(httpx.AsyncClient, "post", post_off):
        await provider._generate("p", force_json=False, max_output_tokens=64)
    assert "format" not in cap_off["body"]


@pytest.mark.asyncio
async def test_openai_retries_three_times_then_raises():
    """OpenAI uses a module-level MAX_RETRIES=3 (total 3 attempts) and re-raises
    the last transient error."""
    provider = OpenAIProvider(api_key="k", model="gpt", base_url="http://oai/v1", timeout=1)
    calls = {"n": 0}

    async def boom(self, *a, **k):
        calls["n"] += 1
        raise httpx.ConnectError("oai down")

    # Patch sleep so the backoff doesn't actually wait 30/60s.
    async def _no_sleep(_):
        return None

    with patch.object(httpx.AsyncClient, "post", boom), patch.object(
        asyncio, "sleep", _no_sleep
    ):
        with pytest.raises(httpx.ConnectError):
            await provider._generate("prompt", max_output_tokens=128)

    assert calls["n"] == 3  # MAX_RETRIES == 3 total attempts


@pytest.mark.asyncio
async def test_openai_generate_force_json_toggles_response_format():
    provider = OpenAIProvider(api_key="k", model="gpt", base_url="http://oai/v1", timeout=5)

    post_on, cap_on = _openai_post_returning("{}")
    with patch.object(httpx.AsyncClient, "post", post_on):
        await provider._generate("p", force_json=True, max_output_tokens=64)
    assert cap_on["body"]["response_format"] == {"type": "json_object"}

    post_off, cap_off = _openai_post_returning("{}")
    with patch.object(httpx.AsyncClient, "post", post_off):
        await provider._generate("p", force_json=False, max_output_tokens=64)
    assert "response_format" not in cap_off["body"]


@pytest.mark.asyncio
async def test_claude_generate_retries_then_raises():
    # Phase 3: Claude now uses the shared _generate retry/force_json policy
    # (was: no retry, ignored flags). With _retry_max=2 it makes exactly 3
    # attempts (max_retries + 1) on a transient ConnectError, then re-raises —
    # identical to Ollama/OpenAI.
    provider = ClaudeProvider(api_key="k", model="claude-x", timeout=5)
    provider._retry_max = 2
    provider._retry_backoff = [0, 0]  # no real backoff sleep
    calls = {"n": 0}

    async def boom(**kwargs):
        calls["n"] += 1
        raise httpx.ConnectError("anthropic down")

    with patch.object(provider.client.messages, "create", boom):
        with pytest.raises(httpx.ConnectError):
            await provider._generate("prompt")

    assert calls["n"] == 3  # 2 retries + 1 initial = 3 calls (shared policy)


@pytest.mark.asyncio
async def test_claude_generate_honors_force_json_and_timeout_override():
    # Phase 3: Claude now uses the shared _generate retry/force_json policy
    # (was: no retry, ignored flags). Anthropic has no ``response_format``
    # toggle, so ``force_json`` is applied as a JSON-only ``system``
    # instruction that reaches the SDK; ``timeout_override`` is forwarded as
    # the per-request ``timeout`` kwarg.
    provider = ClaudeProvider(api_key="k", model="claude-x", timeout=5)

    create_a, cap_a = _claude_create_returning("{}")
    with patch.object(provider.client.messages, "create", create_a):
        await provider._generate("p", force_json=True, timeout_override=999.0)
    kw_a = cap_a["kwargs"][0]

    create_b, cap_b = _claude_create_returning("{}")
    with patch.object(provider.client.messages, "create", create_b):
        await provider._generate("p", force_json=False, timeout_override=None)
    kw_b = cap_b["kwargs"][0]

    # force_json=True reaches the SDK as a JSON-only system instruction;
    # force_json=False omits it. The flag now changes the emitted kwargs.
    assert "system" in kw_a
    assert "json" in kw_a["system"].lower()
    assert "system" not in kw_b

    # timeout_override is forwarded as the SDK ``timeout`` kwarg.
    assert kw_a["timeout"] == 999.0
    assert kw_b["timeout"] == float(provider.timeout)  # falls back to self.timeout


@pytest.mark.asyncio
async def test_claude_chat_discards_json_flags():
    """``ClaudeProvider.chat`` deletes ``json_mode``/``json_schema`` and never
    forwards them to the SDK; the system prompt + messages pass straight
    through."""
    create, captured = _claude_create_returning("plain answer")
    provider = ClaudeProvider(api_key="k", model="claude-x", timeout=5)
    with patch.object(provider.client.messages, "create", create):
        out = await provider.chat(
            [{"role": "user", "content": "hi"}],
            "SYSTEM",
            json_mode=True,
            json_schema={"type": "object"},
        )
    assert out == "plain answer"
    kw = captured["kwargs"][0]
    assert kw["system"] == "SYSTEM"
    assert kw["messages"] == [{"role": "user", "content": "hi"}]
    assert "response_format" not in kw and "format" not in kw


@pytest.mark.asyncio
async def test_ollama_chat_sets_format_from_json_mode_and_schema():
    """Ollama ``chat`` honors json_mode (format='json') and prefers an explicit
    json_schema when both are present."""
    # json_mode only
    post1, cap1 = _ollama_chat_post_returning("{}")
    provider = OllamaProvider(base_url="http://ollama", model="qwen", timeout=5)
    with patch.object(httpx.AsyncClient, "post", post1):
        await provider.chat([{"role": "user", "content": "x"}], "SYS", json_mode=True)
    assert cap1["body"]["format"] == "json"

    # json_schema wins over json_mode
    schema = {"type": "object", "properties": {"a": {"type": "string"}}}
    post2, cap2 = _ollama_chat_post_returning("{}")
    with patch.object(httpx.AsyncClient, "post", post2):
        await provider.chat(
            [{"role": "user", "content": "x"}], "SYS", json_mode=True, json_schema=schema
        )
    assert cap2["body"]["format"] == schema


@pytest.mark.asyncio
async def test_openai_chat_sets_response_format_from_schema():
    """OpenAI ``chat`` emits a structured-outputs json_schema response_format
    when a schema is supplied."""
    schema = {"type": "object", "properties": {"a": {"type": "string"}}}
    post, captured = _openai_post_returning("{}")
    provider = OpenAIProvider(api_key="k", model="gpt", base_url="http://oai/v1", timeout=5)
    with patch.object(httpx.AsyncClient, "post", post):
        await provider.chat(
            [{"role": "user", "content": "x"}], "SYS", json_schema=schema
        )
    rf = captured["body"]["response_format"]
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["schema"] == schema
    assert rf["json_schema"]["strict"] is True


# ==========================================================================
# 3. _parse_json truncation / repair behavior.
# ==========================================================================


def test_parse_json_repairs_trailing_comma_and_single_quotes():
    text = "Here is the result: {'doc_type': 'lab_report', 'patient_name': 'Jane',}"
    result = parse_llm_json(text)
    assert result == {"doc_type": "lab_report", "patient_name": "Jane"}
    assert "_truncated" not in result


def test_parse_json_strips_markdown_fence():
    text = '```json\n{"a": 1, "b": [1, 2, 3]}\n```'
    assert parse_llm_json(text) == {"a": 1, "b": [1, 2, 3]}


def test_parse_json_recovers_truncated_array_drops_partial_element():
    """A response cut off mid-value keeps every COMPLETE element and drops the
    half-written one, flagging ``_truncated=True``. Here the second lab result's
    ``value`` field was being written when the stream stopped, so only its
    completed ``test_name_original`` survives."""
    text = (
        '{"lab_results": [{"test_name_original": "WBC", "value": "5.0"}, '
        '{"test_name_original": "RBC", "value": "4.'
    )
    result = parse_llm_json(text)
    assert result["_truncated"] is True
    labs = result["lab_results"]
    assert labs[0] == {"test_name_original": "WBC", "value": "5.0"}
    # The partial second element keeps only the fully-written field.
    assert labs[1] == {"test_name_original": "RBC"}


def test_parse_json_recovers_truncated_object_missing_close_brace():
    text = (
        '{"doc_type": "lab_report", "lab_results": '
        '[{"test_name_original": "WBC"}, {"test_name_original": "RBC"}'
    )
    result = parse_llm_json(text)
    assert result["_truncated"] is True
    assert result["doc_type"] == "lab_report"
    assert [r["test_name_original"] for r in result["lab_results"]] == ["WBC", "RBC"]


def test_parse_json_empty_string_returns_error_shape():
    assert parse_llm_json("") == {
        "error": "Failed to parse extraction",
        "raw_response": "",
    }


def test_parse_json_unrecoverable_returns_error_shape():
    result = parse_llm_json("not json at all")
    assert result["error"] == "Failed to parse extraction"
    assert result["raw_response"] == "not json at all"
    assert "_truncated" not in result


def test_parse_json_flags_truncation_suspected_near_token_cap():
    """When the response length is within ~400 chars of ``max_output_tokens*3``
    AND it is unrecoverable, the parser flags ``_truncation_suspected`` and
    records the length."""
    # Unrecoverable (no closing brace anywhere, opens a string that never
    # closes) but long enough to trip the heuristic at a small cap.
    cap = 40  # approx_chars = 120, threshold = len >= 120 - 400 -> always here
    text = "x" * 200  # no brace, unrecoverable
    result = parse_llm_json(text, max_output_tokens=cap)
    assert result["error"] == "Failed to parse extraction"
    assert result.get("_truncation_suspected") is True
    assert result.get("_response_length") == 200
