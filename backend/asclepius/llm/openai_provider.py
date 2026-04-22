"""OpenAI-compatible LLM provider (works with OpenAI API and vLLM)."""

import json
import logging
import re

import httpx

from asclepius.llm.base import LLMProvider
from asclepius.llm.json_utils import get_output_token_caps, parse_llm_json
from asclepius.llm.prompts import CLASSIFICATION_PROMPT, EXTRACTION_PROMPT, SQL_GENERATION_PROMPT, canonical_language_directive

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BACKOFF = [30, 60, 120]


class OpenAIProvider(LLMProvider):
    """OpenAI-compatible provider — works with OpenAI, vLLM, and any
    server that implements the OpenAI chat completions API."""

    def __init__(self, api_key: str, model: str, base_url: str = "https://api.openai.com/v1", timeout: int = 120):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def classify(self, ocr_text: str, context: dict) -> dict:
        logger.info("OpenAI classify: model=%s, text_len=%d", self.model, len(ocr_text))
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
        logger.info("OpenAI classify result: doc_type=%s, patient=%s", result.get("doc_type"), result.get("patient_name"))
        return result

    async def extract(self, ocr_text: str, context: dict) -> dict:
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

    async def chat(
        self,
        messages: list[dict],
        system_prompt: str,
        *,
        json_mode: bool = False,
    ) -> str:
        all_messages = [{"role": "system", "content": system_prompt}]
        all_messages.extend(messages)
        extraction_cap, _ = get_output_token_caps()
        timeout = httpx.Timeout(connect=10.0, read=float(self.timeout), write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        body: dict = {"model": self.model, "messages": all_messages, "max_tokens": extraction_cap}
        if json_mode:
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

    async def generate_sql(self, question: str, schema: str, context: str) -> str:
        prompt = SQL_GENERATION_PROMPT.format(schema=schema, context=context, question=question)
        # SQL output is a ```sql``` code block — don't ask the provider to
        # coerce it into JSON (vLLM and compatible backends honour the flag).
        response_text = await self._generate(prompt, force_json=False, max_output_tokens=1024)
        sql_match = re.search(r"```sql\s*(.*?)\s*```", response_text, re.DOTALL)
        if sql_match:
            return sql_match.group(1).strip()
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
        import asyncio

        read_timeout = timeout_override or float(self.timeout)
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        if max_output_tokens is None:
            max_output_tokens, _ = get_output_token_caps()

        payload: dict = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": int(max_output_tokens),
        }
        if force_json:
            payload["response_format"] = {"type": "json_object"}

        last_err = None
        for attempt in range(MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
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
            except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError) as e:
                last_err = e
                if attempt < MAX_RETRIES - 1:
                    wait = RETRY_BACKOFF[attempt]
                    logger.warning("OpenAI %s (attempt %d/%d), retrying in %ds...",
                                   type(e).__name__, attempt + 1, MAX_RETRIES, wait)
                    await asyncio.sleep(wait)
                else:
                    logger.error("OpenAI %s after %d attempts", type(e).__name__, MAX_RETRIES)
        raise last_err  # type: ignore[misc]

    @staticmethod
    def _parse_json(text: str) -> dict:
        """Kept for backward compatibility; delegates to the shared parser."""
        return parse_llm_json(text)
