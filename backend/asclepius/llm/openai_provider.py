"""OpenAI-compatible LLM provider (works with OpenAI API and vLLM)."""

import logging

import httpx

from asclepius.llm.base import _DEFAULT_RETRY_BACKOFF, LLMProvider
from asclepius.llm.json_utils import get_output_token_caps

logger = logging.getLogger(__name__)


class OpenAIProvider(LLMProvider):
    """OpenAI-compatible provider — works with OpenAI, vLLM, and any
    server that implements the OpenAI chat completions API."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://api.openai.com/v1",
        timeout: int = 120,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        # Retry policy (overridden by the factory from the credential).
        # ``_retry_max=2`` -> 3 total attempts, matching the previous
        # module-level ``MAX_RETRIES == 3``.
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
        all_messages = [{"role": "system", "content": system_prompt}]
        all_messages.extend(messages)
        extraction_cap, _ = get_output_token_caps()
        timeout = httpx.Timeout(connect=10.0, read=float(self.timeout), write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        body: dict = {"model": self.model, "messages": all_messages, "max_tokens": extraction_cap}
        if json_schema is not None:
            # OpenAI's structured-outputs mode (gpt-4o-2024-08-06+ and
            # vLLM/llama.cpp servers that implement it) — guarantees the
            # returned JSON validates against the schema.
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "response", "schema": json_schema, "strict": True},
            }
        elif json_mode:
            body["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def _raw_generate(
        self,
        prompt: str,
        *,
        force_json: bool,
        timeout: float,
        max_output_tokens: int,
    ) -> str:
        """Single OpenAI ``/chat/completions`` call (no retry — the base owns
        that). ``force_json`` sets ``response_format={"type": "json_object"}``."""
        client_timeout = httpx.Timeout(connect=10.0, read=float(timeout), write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        payload: dict = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": int(max_output_tokens),
        }
        if force_json:
            payload["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=client_timeout) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            response = data["choices"][0]["message"]["content"]
            logger.info("OpenAI response: %d chars, model=%s", len(response), self.model)
            return response
