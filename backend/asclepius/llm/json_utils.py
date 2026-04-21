"""Shared JSON parsing helpers for LLM providers.

Providers return text that is *usually* JSON but may have:
- Markdown fences (```json ... ```)
- Preamble / epilogue prose
- Trailing commas or single quotes
- **Truncation** — the LLM hit its output-token ceiling mid-structure.

``parse_llm_json`` handles all four cases. When the response is truncated
mid-structure it attempts a balanced-brace repair so callers still get a
partial extraction (e.g. the first 18 of 25 lab results).
"""

import json
import logging
import re

logger = logging.getLogger(__name__)

# Fallback caps used if config lookup fails (e.g. in unit tests that stub
# out the config module).
_DEFAULT_EXTRACTION_CAP = 16384
_DEFAULT_CLASSIFICATION_CAP = 4096


def get_output_token_caps() -> tuple[int, int]:
    """Return ``(extraction_cap, classification_cap)`` from config.

    Reads lazily so tests / admin tools that import providers without a
    fully-built AppConfig still work.
    """
    try:
        from asclepius.config import get_config
        cfg = get_config().llm
        return (
            max(1024, int(cfg.extraction_max_output_tokens)),
            max(512, int(cfg.classification_max_output_tokens)),
        )
    except Exception:
        return _DEFAULT_EXTRACTION_CAP, _DEFAULT_CLASSIFICATION_CAP


def parse_llm_json(text: str, max_output_tokens: int = 0) -> dict:
    """Parse JSON from an LLM response, tolerating common issues and truncation.

    Returns the parsed dict on success. On failure returns
    ``{"error": "Failed to parse extraction", "raw_response": <first 500 chars>}``
    plus ``_truncation_suspected=True`` when the response length is close
    to ``max_output_tokens * 3`` chars (rough char/token heuristic).

    When truncation is recoverable, the returned dict carries
    ``_truncated=True`` so callers can log the degradation.
    """
    if not text:
        return {"error": "Failed to parse extraction", "raw_response": ""}

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass

    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        candidate = brace.group(0)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            fixed = re.sub(r",\s*([}\]])", r"\1", candidate)
            fixed = re.sub(r"'", '"', fixed)
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                pass

    repaired = _try_truncation_repair(text)
    if repaired is not None:
        repaired["_truncated"] = True
        logger.warning(
            "LLM response truncated mid-structure; recovered partial extraction (response_len=%d).",
            len(text),
        )
        return repaired

    truncation_suspected = False
    if max_output_tokens > 0:
        approx_chars = max_output_tokens * 3
        if len(text) >= approx_chars - 400:
            truncation_suspected = True

    logger.warning(
        "Failed to parse JSON from LLM response (len=%d, truncation_suspected=%s): %s",
        len(text), truncation_suspected, text[:200],
    )
    out = {"error": "Failed to parse extraction", "raw_response": text[:500]}
    if truncation_suspected:
        out["_truncation_suspected"] = True
        out["_response_length"] = len(text)
    return out


def _try_truncation_repair(text: str) -> dict | None:
    """Attempt balanced-brace repair on a truncated JSON response.

    Walks the body tracking brace/bracket depth and string state. Records
    every "safe" offset — a point where the content so far forms a valid
    prefix that can be closed with synthetic ``}``/``]`` characters.
    Returns the longest such prefix that parses, or None.
    """
    start = text.find("{")
    if start < 0:
        return None
    body = text[start:]

    safe_points: list[tuple[int, str]] = []
    stack: list[str] = []
    in_string = False
    escape = False

    for i, ch in enumerate(body):
        if escape:
            escape = False
            continue
        if in_string:
            if ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                return None
            stack.pop()
            if stack:
                closing = "".join("}" if b == "{" else "]" for b in reversed(stack))
                safe_points.append((i + 1, closing))
        elif ch == "," and stack:
            closing = "".join("}" if b == "{" else "]" for b in reversed(stack))
            safe_points.append((i, closing))

    for offset, closing in reversed(safe_points):
        candidate = body[:offset] + closing
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None
