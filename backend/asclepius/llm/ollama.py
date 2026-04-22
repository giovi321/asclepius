"""Ollama LLM provider implementation."""

import asyncio
import contextlib
import json
import logging
import re

import httpx

from asclepius.llm.base import LLMProvider
from asclepius.llm.json_utils import get_output_token_caps, parse_llm_json
from asclepius.llm.prompts import CLASSIFICATION_PROMPT, EXTRACTION_PROMPT, SQL_GENERATION_PROMPT, canonical_language_directive

logger = logging.getLogger(__name__)

# Fallback retry settings used only if config lookup fails.
_DEFAULT_MAX_RETRIES = 3
_DEFAULT_RETRY_BACKOFF = [30, 60, 120]  # seconds

# Concurrency is now handled by the per-model gate in asclepius.llm.gate
# (wrapped at provider-build time in pipeline.provider_factory). This module
# no longer needs its own semaphore.


@contextlib.asynccontextmanager
async def _noop_lock():
    yield


def _get_semaphore():
    # Kept for source compatibility with callers that may still import it —
    # the real gating happens at the provider-wrapper level.
    return _noop_lock()


def _get_retry_config(provider=None) -> tuple[int, list[int]]:
    """Return (max_retries, backoff_seconds) for this request.

    Prefer the per-provider policy set at build time in
    ``pipeline.provider_factory._build_llm_provider``; fall back to the
    legacy global LLM config; fall back again to the hard-coded defaults.
    """
    if provider is not None:
        retries = getattr(provider, "_retry_max", None)
        backoff = getattr(provider, "_retry_backoff", None)
        if retries is not None and backoff:
            return max(0, int(retries)), [int(x) for x in backoff if int(x) >= 0] or _DEFAULT_RETRY_BACKOFF
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

        _, classification_cap = get_output_token_caps()
        response_text = await self._generate(prompt, max_output_tokens=classification_cap)
        result = parse_llm_json(response_text, max_output_tokens=classification_cap)
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

        extraction_cap, _ = get_output_token_caps()
        response_text = await self._generate(prompt, max_output_tokens=extraction_cap)
        return parse_llm_json(response_text, max_output_tokens=extraction_cap)

    async def chat(self, messages: list[dict], system_prompt: str) -> str:
        ollama_messages = [{"role": "system", "content": system_prompt}]
        ollama_messages.extend(messages)

        extraction_cap, _ = get_output_token_caps()
        timeout = httpx.Timeout(connect=10.0, read=float(self.timeout), write=10.0, pool=10.0)
        total_budget = float(self.timeout) + 30.0
        async with _get_semaphore():
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await asyncio.wait_for(
                    client.post(
                        f"{self.base_url}/api/chat",
                        json={
                            "model": self.model,
                            "messages": ollama_messages,
                            "stream": False,
                            "options": {"num_predict": extraction_cap},
                        },
                    ),
                    timeout=total_budget,
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
        response_text = await self._generate(prompt, force_json=False, max_output_tokens=1024)
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

    async def _generate(
        self,
        prompt: str,
        force_json: bool = True,
        timeout_override: float | None = None,
        max_output_tokens: int | None = None,
    ) -> str:
        read_timeout = timeout_override or float(self.timeout)
        logger.debug("Ollama _generate: model=%s, prompt_len=%d, url=%s, timeout=%.0fs",
                      self.model, len(prompt), self.base_url, read_timeout)
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        payload = {"model": self.model, "prompt": prompt, "stream": False}
        if force_json:
            payload["format"] = "json"
        if max_output_tokens is None:
            max_output_tokens, _ = get_output_token_caps()
        payload["options"] = {"num_predict": int(max_output_tokens)}

        # Total-elapsed budget wrapping the POST. httpx's read-timeout is
        # per-chunk, so a server that trickles data (or a wedged socket
        # where the response never starts arriving) can hang a request
        # indefinitely. asyncio.wait_for enforces a real wall-clock cap.
        # Budget = configured read timeout + 30s slack for connect/write.
        total_budget = read_timeout + 30.0

        max_retries, retry_backoff = _get_retry_config(self)
        total_attempts = max_retries + 1
        last_err = None
        for attempt in range(total_attempts):
            try:
                async with _get_semaphore():
                    async with httpx.AsyncClient(timeout=timeout) as client:
                        resp = await asyncio.wait_for(
                            client.post(
                                f"{self.base_url}/api/generate",
                                json=payload,
                            ),
                            timeout=total_budget,
                        )
                        resp.raise_for_status()
                        data = resp.json()
                        response = data.get("response", "")
                        logger.info("Ollama response: %d chars, model=%s", len(response), self.model)
                        return response
            except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError,
                    asyncio.TimeoutError) as e:
                last_err = e
                if attempt < total_attempts - 1:
                    wait = retry_backoff[min(attempt, len(retry_backoff) - 1)]
                    logger.warning(
                        "Ollama %s (attempt %d/%d, prompt_len=%d, budget=%.0fs), retrying in %ds...",
                        type(e).__name__, attempt + 1, total_attempts, len(prompt),
                        total_budget, wait,
                    )
                    await asyncio.sleep(wait)
                else:
                    logger.error(
                        "Ollama %s after %d attempts (prompt_len=%d, budget=%.0fs)",
                        type(e).__name__, total_attempts, len(prompt), total_budget,
                    )
        raise last_err  # type: ignore[misc]

    @staticmethod
    def _parse_json(text: str) -> dict:
        """Kept for backward compatibility; delegates to the shared parser."""
        return parse_llm_json(text)
