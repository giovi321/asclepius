"""Ollama LLM provider implementation."""

import asyncio
import logging

import httpx

from asclepius.llm.base import _DEFAULT_RETRY_BACKOFF, LLMProvider
from asclepius.llm.json_utils import get_output_token_caps

logger = logging.getLogger(__name__)

# Concurrency is handled by the per-model gate in asclepius.llm.gate
# (wrapped at provider-build time in pipeline.provider_factory). This module
# does not need its own semaphore.


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str, timeout: int = 120):
        self.base_url = base_url.rstrip("/")
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
        ollama_messages = [{"role": "system", "content": system_prompt}]
        ollama_messages.extend(messages)

        extraction_cap, _ = get_output_token_caps()
        timeout = httpx.Timeout(connect=10.0, read=float(self.timeout), write=10.0, pool=10.0)
        total_budget = float(self.timeout) + 30.0
        body: dict = {
            "model": self.model,
            "messages": ollama_messages,
            "stream": False,
            "options": {"num_predict": extraction_cap},
        }
        # Schema-constrained output (Ollama ≥ 0.5) wins over the looser
        # ``format=json`` when the caller provides one.
        if json_schema is not None:
            body["format"] = json_schema
        elif json_mode:
            body["format"] = "json"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await asyncio.wait_for(
                client.post(
                    f"{self.base_url}/api/chat",
                    json=body,
                ),
                timeout=total_budget,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "")

    async def _raw_generate(
        self,
        prompt: str,
        *,
        force_json: bool,
        timeout: float,
        max_output_tokens: int,
    ) -> str:
        """Single Ollama ``/api/generate`` call (no retry — the base owns
        that). ``force_json`` sets ``format=json``; the POST is wrapped in a
        total-elapsed budget."""
        read_timeout = float(timeout)
        logger.debug(
            "Ollama _raw_generate: model=%s, prompt_len=%d, url=%s, timeout=%.0fs",
            self.model,
            len(prompt),
            self.base_url,
            read_timeout,
        )
        client_timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        payload = {"model": self.model, "prompt": prompt, "stream": False}
        if force_json:
            payload["format"] = "json"
        payload["options"] = {"num_predict": int(max_output_tokens)}

        # Total-elapsed budget wrapping the POST. httpx's read-timeout is
        # per-chunk, so a server that trickles data (or a wedged socket
        # where the response never starts arriving) can hang a request
        # indefinitely. asyncio.wait_for enforces a real wall-clock cap.
        # Budget = configured read timeout + 30s slack for connect/write.
        total_budget = read_timeout + 30.0

        async with httpx.AsyncClient(timeout=client_timeout) as client:
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
