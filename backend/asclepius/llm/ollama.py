"""Ollama LLM provider implementation."""

import asyncio
import json
import logging
import re

import httpx

from asclepius.llm.base import LLMProvider
from asclepius.llm.prompts import CLASSIFICATION_PROMPT, EXTRACTION_PROMPT, SQL_GENERATION_PROMPT, canonical_language_directive

logger = logging.getLogger(__name__)

# Fallback retry settings used only if config lookup fails.
_DEFAULT_MAX_RETRIES = 3
_DEFAULT_RETRY_BACKOFF = [30, 60, 120]  # seconds

# Per-loop semaphores limit concurrent Ollama requests. The pipeline worker
# thread (pipeline/watcher.py) runs its own event loop, separate from the
# FastAPI server's — a single module-level Semaphore reused across both
# would raise "bound to a different event loop" on the second loop's first
# await. Key by id(loop) so each loop gets its own instance.
_sem_by_loop: "dict[int, tuple[asyncio.Semaphore, int]]" = {}


def _get_semaphore() -> asyncio.Semaphore:
    try:
        from asclepius.config import get_config
        size = max(1, int(get_config().llm.max_concurrent_requests))
    except Exception:
        size = 2
    loop_id = id(asyncio.get_running_loop())
    entry = _sem_by_loop.get(loop_id)
    if entry is None or entry[1] != size:
        entry = (asyncio.Semaphore(size), size)
        _sem_by_loop[loop_id] = entry
    return entry[0]


def _get_retry_config() -> tuple[int, list[int]]:
    """Return (max_retries, backoff_seconds) from config, falling back safely."""
    try:
        from asclepius.config import get_config
        cfg = get_config().llm
        retries = max(0, int(cfg.max_retries))
        backoff = [int(x) for x in (cfg.retry_backoff_seconds or []) if int(x) >= 0]
        if not backoff:
            backoff = _DEFAULT_RETRY_BACKOFF
        return retries, backoff
    except Exception:
        return _DEFAULT_MAX_RETRIES, _DEFAULT_RETRY_BACKOFF


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str, timeout: int = 120):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def classify(self, ocr_text: str, context: dict) -> dict:
        logger.info("Ollama classify: model=%s, text_len=%d", self.model, len(ocr_text))
        prompt = CLASSIFICATION_PROMPT.format(
            patient_list=json.dumps(context.get("patient_list", []), indent=2),
            facility_list=json.dumps(context.get("facility_list", []), indent=2),
            doctor_list=json.dumps(context.get("doctor_list", []), indent=2),
            ocr_text=ocr_text,
            few_shot_examples=context.get("few_shot_examples", ""),
        )
        prompt = canonical_language_directive(context.get("canonical_language")) + prompt

        response_text = await self._generate(prompt)
        result = self._parse_json(response_text)
        logger.info("Ollama classify result: doc_type=%s, patient=%s", result.get("doc_type"), result.get("patient_name"))
        return result

    async def extract(self, ocr_text: str, context: dict) -> dict:
        prompt = EXTRACTION_PROMPT.format(
            patient_list=json.dumps(context.get("patient_list", []), indent=2),
            facility_list=json.dumps(context.get("facility_list", []), indent=2),
            doctor_list=json.dumps(context.get("doctor_list", []), indent=2),
            lab_test_mappings=json.dumps(context.get("lab_test_mappings", []), indent=2),
            specialty_mappings=json.dumps(context.get("specialty_mappings", []), indent=2),
            diagnosis_mappings=json.dumps(context.get("diagnosis_mappings", []), indent=2),
            medication_mappings=json.dumps(context.get("medication_mappings", []), indent=2),
            ocr_text=ocr_text,
        )
        prompt = canonical_language_directive(context.get("canonical_language")) + prompt

        response_text = await self._generate(prompt)
        return self._parse_json(response_text)

    async def chat(self, messages: list[dict], system_prompt: str) -> str:
        ollama_messages = [{"role": "system", "content": system_prompt}]
        ollama_messages.extend(messages)

        timeout = httpx.Timeout(connect=10.0, read=float(self.timeout), write=10.0, pool=10.0)
        async with _get_semaphore():
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/api/chat",
                    json={"model": self.model, "messages": ollama_messages, "stream": False},
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("message", {}).get("content", "")

    async def generate_sql(self, question: str, schema: str, context: str) -> str:
        prompt = SQL_GENERATION_PROMPT.format(
            schema=schema, context=context, question=question
        )
        # SQL output is a ```sql``` code block, not JSON — Ollama's
        # ``format=json`` mode would coerce the reply into an empty ``{}``
        # and the sanitizer would reject every chat question.
        response_text = await self._generate(prompt, force_json=False)
        # Extract SQL from response
        sql_match = re.search(r"```sql\s*(.*?)\s*```", response_text, re.DOTALL)
        if sql_match:
            return sql_match.group(1).strip()
        # Try to find a SELECT statement; ``;`` is optional because the
        # sanitizer strips it and the model sometimes omits it.
        select_match = re.search(
            r"((?:WITH|SELECT)\s+.*?)(?:;|```|$)",
            response_text, re.DOTALL | re.IGNORECASE,
        )
        if select_match:
            return select_match.group(1).strip()
        return response_text.strip()

    async def _generate(self, prompt: str, force_json: bool = True, timeout_override: float | None = None) -> str:
        read_timeout = timeout_override or float(self.timeout)
        logger.debug("Ollama _generate: model=%s, prompt_len=%d, url=%s, timeout=%.0fs",
                      self.model, len(prompt), self.base_url, read_timeout)
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        payload = {"model": self.model, "prompt": prompt, "stream": False}
        if force_json:
            payload["format"] = "json"

        max_retries, retry_backoff = _get_retry_config()
        total_attempts = max_retries + 1
        last_err = None
        for attempt in range(total_attempts):
            try:
                async with _get_semaphore():
                    async with httpx.AsyncClient(timeout=timeout) as client:
                        resp = await client.post(
                            f"{self.base_url}/api/generate",
                            json=payload,
                        )
                        resp.raise_for_status()
                        data = resp.json()
                        response = data.get("response", "")
                        logger.info("Ollama response: %d chars, model=%s", len(response), self.model)
                        return response
            except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError) as e:
                last_err = e
                if attempt < total_attempts - 1:
                    wait = retry_backoff[min(attempt, len(retry_backoff) - 1)]
                    logger.warning(
                        "Ollama %s (attempt %d/%d, prompt_len=%d), retrying in %ds...",
                        type(e).__name__, attempt + 1, total_attempts, len(prompt), wait,
                    )
                    await asyncio.sleep(wait)
                else:
                    logger.error(
                        "Ollama %s after %d attempts (prompt_len=%d)",
                        type(e).__name__, total_attempts, len(prompt),
                    )
        raise last_err  # type: ignore[misc]

    @staticmethod
    def _parse_json(text: str) -> dict:
        """Parse JSON from LLM response, handling common formatting issues."""
        # Try direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try to find JSON block
        json_match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # Try to find JSON object
        brace_match = re.search(r"\{.*\}", text, re.DOTALL)
        if brace_match:
            raw = brace_match.group(0)
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
            # Fix common LLM JSON issues: trailing commas, single quotes
            fixed = re.sub(r",\s*([}\]])", r"\1", raw)  # trailing commas
            fixed = re.sub(r"'", '"', fixed)  # single quotes to double
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                pass

        logger.warning("Failed to parse JSON from LLM response: %s", text[:200])
        return {"error": "Failed to parse extraction", "raw_response": text[:500]}
