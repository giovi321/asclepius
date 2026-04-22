"""Claude (Anthropic) LLM provider implementation."""

import json
import logging
import re

from anthropic import AsyncAnthropic

from asclepius.llm.base import LLMProvider
from asclepius.llm.json_utils import get_output_token_caps, parse_llm_json
from asclepius.llm.prompts import CLASSIFICATION_PROMPT, EXTRACTION_PROMPT, SQL_GENERATION_PROMPT, canonical_language_directive

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
        prompt = canonical_language_directive(context.get("canonical_language")) + prompt

        _, classification_cap = get_output_token_caps()
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=classification_cap,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = response.content[0].text
        result = parse_llm_json(response_text, max_output_tokens=classification_cap)
        logger.info("Claude classify result: doc_type=%s, patient=%s", result.get("doc_type"), result.get("patient_name"))
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
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=extraction_cap,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = response.content[0].text
        return parse_llm_json(response_text, max_output_tokens=extraction_cap)

    async def chat(
        self,
        messages: list[dict],
        system_prompt: str,
        *,
        json_mode: bool = False,
    ) -> str:
        # Anthropic relies on the system prompt to specify JSON shape; the
        # ``json_mode`` flag is accepted for interface parity but has no
        # API-level toggle to set here.
        del json_mode
        extraction_cap, _ = get_output_token_caps()
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=extraction_cap,
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
        select_match = re.search(
            r"((?:WITH|SELECT)\s+.*?)(?:;|```|$)",
            response_text, re.DOTALL | re.IGNORECASE,
        )
        if select_match:
            return select_match.group(1).strip()
        return response_text.strip()

    async def _generate(self, prompt: str, force_json: bool = True, timeout_override: float | None = None) -> str:
        """Generate raw text response from a prompt."""
        extraction_cap, _ = get_output_token_caps()
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=extraction_cap,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    @staticmethod
    def _parse_json(text: str) -> dict:
        """Kept for backward compatibility; delegates to the shared parser."""
        return parse_llm_json(text)
