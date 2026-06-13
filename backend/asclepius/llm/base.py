"""Abstract LLM provider interface.

The base class is *concrete* for everything that used to be triplicated
across the Ollama / Claude / OpenAI providers:

    * ``classify`` / ``extract`` / ``generate_sql`` — prompt assembly + JSON
      (or SQL-fence) parsing. These are identical across providers and live
      here once.
    * ``_parse_json`` — kept as a method for the ``llm._parse_json(...)``
      call sites; delegates to :func:`asclepius.llm.json_utils.parse_llm_json`.
    * ``_generate`` — owns the retry/backoff loop, the ``force_json`` default
      and the timeout policy. It delegates the single network/SDK round-trip
      to the provider-specific :meth:`_raw_generate`.

A subclass therefore only implements ``__init__`` (setting ``_retry_max`` /
``_retry_backoff``), ``_raw_generate`` (the one API call), ``chat`` and any
provider-specific helpers (e.g. vision).
"""

import asyncio
import json
import logging
import re
from abc import ABC, abstractmethod

import httpx

from asclepius.llm.json_utils import get_output_token_caps, parse_llm_json
from asclepius.llm.prompts import (
    CLASSIFICATION_PROMPT,
    EXTRACTION_PROMPT,
    SQL_GENERATION_PROMPT,
    canonical_language_directive,
)

logger = logging.getLogger(__name__)

# Fallback retry settings used only if a provider somehow has no
# ``_retry_max`` / ``_retry_backoff`` set and the config lookup fails.
_DEFAULT_MAX_RETRIES = 3
_DEFAULT_RETRY_BACKOFF = [30, 60, 120]  # seconds

# Transient network/SDK errors that warrant a retry. Union of what Ollama
# and OpenAI caught before this refactor: ``asyncio.TimeoutError`` only ever
# arises from Ollama's total-budget ``asyncio.wait_for`` wrapper, so catching
# it for the other providers is harmless (they never raise it).
_TRANSIENT_ERRORS = (
    httpx.ReadTimeout,
    httpx.ConnectTimeout,
    httpx.ConnectError,
    asyncio.TimeoutError,
)

# SQL responses come back fenced (```sql ... ```) or as a bare SELECT/WITH.
_SQL_FENCE_RE = re.compile(r"```sql\s*(.*?)\s*```", re.DOTALL)
_SQL_SELECT_RE = re.compile(r"((?:WITH|SELECT)\s+.*?)(?:;|```|$)", re.DOTALL | re.IGNORECASE)


class LLMProvider(ABC):
    """Base class for LLM providers (Ollama, Claude, OpenAI)."""

    # Human-readable label set by the factory (e.g. "My Claude / claude-sonnet-4-20250514")
    provider_label: str = ""

    # Per-provider retry policy. Subclasses set these in ``__init__`` and the
    # factory overrides them from the resolved credential. Defaults give
    # ``_retry_max + 1`` = 3 total attempts, matching the pre-refactor
    # OpenAI ``MAX_RETRIES == 3`` and the Ollama config default.
    _retry_max: int = 2
    _retry_backoff: list[int] = _DEFAULT_RETRY_BACKOFF

    async def classify(self, ocr_text: str, context: dict) -> dict:
        """Classify document and extract basic metadata.

        Args:
            ocr_text: The OCR text from the document.
            context: Dict with keys: patient_list, facility_list, doctor_list.

        Returns:
            Classification dict with doc_type, patient_name, dates, doctor,
            facility, summary, etc.
        """
        logger.info(
            "%s classify: model=%s, text_len=%d",
            type(self).__name__,
            getattr(self, "model", "?"),
            len(ocr_text),
        )
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
        logger.info(
            "%s classify result: doc_type=%s, patient=%s",
            type(self).__name__,
            result.get("doc_type"),
            result.get("patient_name"),
        )
        return result

    async def extract(self, ocr_text: str, context: dict) -> dict:
        """Extract structured data from OCR text.

        Args:
            ocr_text: The OCR text from the document.
            context: Dict with keys: patient_list, facility_list, doctor_list,
                     lab_test_mappings, specialty_mappings,
                     diagnosis_mappings, medication_mappings.

        Returns:
            Structured JSON dict matching the extraction schema.
        """
        prompt = EXTRACTION_PROMPT.format(
            patient_list=json.dumps(context.get("patient_list", []), indent=2),
            facility_list=json.dumps(context.get("facility_list", []), indent=2),
            doctor_list=json.dumps(context.get("doctor_list", []), indent=2),
            ocr_text=ocr_text,
        )
        prompt = canonical_language_directive(context.get("canonical_language")) + prompt

        extraction_cap, _ = get_output_token_caps()
        response_text = await self._generate(prompt, max_output_tokens=extraction_cap)
        return parse_llm_json(response_text, max_output_tokens=extraction_cap)

    async def generate_sql(self, question: str, schema: str, context: str) -> str:
        """Generate a SQL query from a natural language question.

        Args:
            question: User's question.
            schema: Database schema description.
            context: Additional context (patient info, etc.)

        Returns:
            SQL SELECT query string.
        """
        prompt = SQL_GENERATION_PROMPT.format(schema=schema, context=context, question=question)
        # SQL output is a ```sql``` code block, not JSON — force_json=False so
        # JSON-mode backends don't coerce the reply into an empty ``{}`` and
        # make the sanitizer reject every chat question.
        response_text = await self._generate(prompt, force_json=False, max_output_tokens=1024)

        sql_match = _SQL_FENCE_RE.search(response_text)
        if sql_match:
            return sql_match.group(1).strip()
        # Try to find a SELECT statement; ``;`` is optional because the
        # sanitizer strips it and the model sometimes omits it.
        select_match = _SQL_SELECT_RE.search(response_text)
        if select_match:
            return select_match.group(1).strip()
        return response_text.strip()

    @abstractmethod
    async def chat(
        self,
        messages: list[dict],
        system_prompt: str,
        *,
        json_mode: bool = False,
        json_schema: dict | None = None,
    ) -> str:
        """Send a chat message and get a response.

        Args:
            messages: List of {"role": "user"|"assistant", "content": str}.
            system_prompt: System prompt with context.
            json_mode: When True, instruct the provider to constrain output
                to a JSON object (Ollama ``format=json``, OpenAI
                ``response_format={"type": "json_object"}``). For Anthropic
                this is a no-op since the prompt already specifies the
                schema. Ignored when ``json_schema`` is provided.
            json_schema: Optional JSON Schema (as a dict) to constrain the
                output structure. Passed to Ollama's ``format`` field
                (Ollama ≥ 0.5 enforces it during decoding). Other providers
                fall back to ``json_mode`` semantics.

        Returns:
            Assistant response text.
        """
        ...

    def _get_retry_config(self) -> tuple[int, list[int]]:
        """Return ``(max_retries, backoff_seconds)`` for this provider.

        Prefer the per-provider policy set in ``__init__`` / overridden by the
        factory (``_retry_max`` / ``_retry_backoff``); fall back to the global
        LLM config; fall back again to the hard-coded defaults.
        """
        retries = getattr(self, "_retry_max", None)
        backoff = getattr(self, "_retry_backoff", None)
        if retries is not None and backoff:
            return max(0, int(retries)), [
                int(x) for x in backoff if int(x) >= 0
            ] or _DEFAULT_RETRY_BACKOFF
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

    async def _generate(
        self,
        prompt: str,
        force_json: bool = True,
        timeout_override: float | None = None,
        max_output_tokens: int | None = None,
    ) -> str:
        """Generate raw text from a prompt with retry + force_json + timeout.

        Owns the shared retry/backoff loop, the ``force_json`` default and the
        timeout policy; delegates the single network/SDK round-trip to the
        provider-specific :meth:`_raw_generate`.
        """
        read_timeout = timeout_override or float(getattr(self, "timeout", 120))
        if max_output_tokens is None:
            max_output_tokens, _ = get_output_token_caps()
        max_output_tokens = int(max_output_tokens)

        max_retries, retry_backoff = self._get_retry_config()
        total_attempts = max_retries + 1
        last_err: BaseException | None = None
        for attempt in range(total_attempts):
            try:
                return await self._raw_generate(
                    prompt,
                    force_json=force_json,
                    timeout=read_timeout,
                    max_output_tokens=max_output_tokens,
                )
            except _TRANSIENT_ERRORS as e:
                last_err = e
                if attempt < total_attempts - 1:
                    wait = retry_backoff[min(attempt, len(retry_backoff) - 1)]
                    logger.warning(
                        "%s %s (attempt %d/%d, prompt_len=%d), retrying in %ds...",
                        type(self).__name__,
                        type(e).__name__,
                        attempt + 1,
                        total_attempts,
                        len(prompt),
                        wait,
                    )
                    await asyncio.sleep(wait)
                else:
                    logger.error(
                        "%s %s after %d attempts (prompt_len=%d)",
                        type(self).__name__,
                        type(e).__name__,
                        total_attempts,
                        len(prompt),
                    )
        raise last_err  # type: ignore[misc]

    @abstractmethod
    async def _raw_generate(
        self,
        prompt: str,
        *,
        force_json: bool,
        timeout: float,
        max_output_tokens: int,
    ) -> str:
        """Issue the single network/SDK call and return the response text.

        Implementations must NOT retry — :meth:`_generate` owns the retry
        loop. They apply ``force_json`` in their API-specific way (Ollama
        ``format``, OpenAI ``response_format``, Claude its system/JSON
        approach), honor ``timeout`` for the request, and request at most
        ``max_output_tokens`` of output. Transient network errors should
        propagate so :meth:`_generate` can retry them.
        """
        ...

    @staticmethod
    def _parse_json(text: str) -> dict:
        """Kept for backward compatibility; delegates to the shared parser."""
        return parse_llm_json(text)
