"""Claude (Anthropic) LLM provider implementation."""

import json
import logging
import re

from anthropic import AsyncAnthropic

from asclepius.llm.base import LLMProvider
from asclepius.llm.prompts import CLASSIFICATION_PROMPT, EXTRACTION_PROMPT, SQL_GENERATION_PROMPT

logger = logging.getLogger(__name__)


class ClaudeProvider(LLMProvider):
    def __init__(self, api_key: str, model: str, timeout: int = 120):
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model
        self.timeout = timeout

    async def classify(self, ocr_text: str, context: dict) -> dict:
        logger.info("Claude classify: model=%s, text_len=%d", self.model, len(ocr_text))
        prompt = CLASSIFICATION_PROMPT.format(
            patient_list=json.dumps(context.get("patient_list", []), indent=2),
            facility_list=json.dumps(context.get("facility_list", []), indent=2),
            doctor_list=json.dumps(context.get("doctor_list", []), indent=2),
            ocr_text=ocr_text,
            few_shot_examples=context.get("few_shot_examples", ""),
        )

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = response.content[0].text
        result = self._parse_json(response_text)
        logger.info("Claude classify result: doc_type=%s, patient=%s", result.get("doc_type"), result.get("patient_name"))
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

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = response.content[0].text
        return self._parse_json(response_text)

    async def chat(self, messages: list[dict], system_prompt: str) -> str:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
        )
        return response.content[0].text

    async def generate_sql(self, question: str, schema: str, context: str) -> str:
        prompt = SQL_GENERATION_PROMPT.format(
            schema=schema, context=context, question=question
        )
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = response.content[0].text

        sql_match = re.search(r"```sql\s*(.*?)\s*```", response_text, re.DOTALL)
        if sql_match:
            return sql_match.group(1).strip()
        select_match = re.search(r"(SELECT\s+.*?;)", response_text, re.DOTALL | re.IGNORECASE)
        if select_match:
            return select_match.group(1).strip()
        return response_text.strip()

    async def _generate(self, prompt: str, force_json: bool = True, timeout_override: float | None = None) -> str:
        """Generate raw text response from a prompt."""
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

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
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass
        logger.warning("Failed to parse JSON from Claude response")
        return {"error": "Failed to parse extraction", "raw_response": text[:500]}
