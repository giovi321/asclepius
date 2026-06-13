"""Claude (Anthropic) LLM provider implementation."""

import logging

from anthropic import AsyncAnthropic

from asclepius.llm.base import (
    _DEFAULT_RETRY_BACKOFF,
    LLMProvider,
)
from asclepius.llm.json_utils import get_output_token_caps

logger = logging.getLogger(__name__)

# Anthropic has no API-level JSON toggle (no ``response_format``); the
# canonical way to force a JSON-only reply is a system instruction.
_JSON_SYSTEM = "Respond with only a single JSON object. Do not include any prose, explanation, or markdown fences."


class ClaudeProvider(LLMProvider):
    def __init__(self, api_key: str, model: str, timeout: int = 120):
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model
        self.timeout = timeout
        # Retry policy (overridden by the factory from the credential).
        self._retry_max = 2
        self._retry_backoff = list(_DEFAULT_RETRY_BACKOFF)

    async def chat(
        self,
        messages: list[dict],
        system_prompt: str,
        *,
        json_mode: bool = False,
        json_schema: dict | None = None,
    ) -> str:
        # Anthropic relies on the system prompt to specify JSON shape; the
        # ``json_mode`` / ``json_schema`` flags are accepted for interface
        # parity but have no API-level toggle to set here. (Anthropic's
        # tool-use mechanism could enforce a schema, but that's a heavier
        # refactor and Claude already follows JSON instructions reliably.)
        del json_mode, json_schema
        extraction_cap, _ = get_output_token_caps()
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=extraction_cap,
            system=system_prompt,
            messages=messages,
        )
        return response.content[0].text

    async def _raw_generate(
        self,
        prompt: str,
        *,
        force_json: bool,
        timeout: float,
        max_output_tokens: int,
    ) -> str:
        """Single Anthropic call. ``force_json`` is applied via a system
        instruction (Anthropic has no ``response_format`` toggle); ``timeout``
        is forwarded as the per-request SDK timeout."""
        kwargs: dict = {
            "model": self.model,
            "max_tokens": int(max_output_tokens),
            "messages": [{"role": "user", "content": prompt}],
            "timeout": timeout,
        }
        if force_json:
            kwargs["system"] = _JSON_SYSTEM
        response = await self.client.messages.create(**kwargs)
        return response.content[0].text
