"""OpenAI-compatible LLM provider (works with OpenAI API and vLLM)."""

import json
import logging
import re

import httpx

from asclepius.llm.base import LLMProvider
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
        response_text = await self._generate(prompt)
        result = self._parse_json(response_text)
        logger.info("OpenAI classify result: doc_type=%s, patient=%s", result.get("doc_type"), result.get("patient_name"))
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
        all_messages = [{"role": "system", "content": system_prompt}]
        all_messages.extend(messages)
        timeout = httpx.Timeout(connect=10.0, read=float(self.timeout), write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json={"model": self.model, "messages": all_messages},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def generate_sql(self, question: str, schema: str, context: str) -> str:
        prompt = SQL_GENERATION_PROMPT.format(schema=schema, context=context, question=question)
        response_text = await self._generate(prompt)
        sql_match = re.search(r"```sql\s*(.*?)\s*```", response_text, re.DOTALL)
        if sql_match:
            return sql_match.group(1).strip()
        select_match = re.search(r"(SELECT\s+.*?;)", response_text, re.DOTALL | re.IGNORECASE)
        if select_match:
            return select_match.group(1).strip()
        return response_text.strip()

    async def _generate(self, prompt: str, force_json: bool = True, timeout_override: float | None = None) -> str:
        import asyncio

        read_timeout = timeout_override or float(self.timeout)
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        payload: dict = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
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
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
        json_match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass
        brace_match = re.search(r"\{.*\}", text, re.DOTALL)
        if brace_match:
            raw = brace_match.group(0)
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
            fixed = re.sub(r",\s*([}\]])", r"\1", raw)
            fixed = re.sub(r"'", '"', fixed)
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                pass
        logger.warning("Failed to parse JSON from OpenAI response: %s", text[:200])
        return {"error": "Failed to parse extraction", "raw_response": text[:500]}
