"""Abstract LLM provider interface."""

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Base class for LLM providers (Ollama, Claude)."""

    # Human-readable label set by the factory (e.g. "My Claude / claude-sonnet-4-20250514")
    provider_label: str = ""

    @abstractmethod
    async def classify(self, ocr_text: str, context: dict) -> dict:
        """Classify document and extract basic metadata.

        Args:
            ocr_text: The OCR text from the document.
            context: Dict with keys: patient_list, facility_list, doctor_list.

        Returns:
            Classification dict with doc_type, patient_name, dates, doctor,
            facility, summary, etc.
        """
        ...

    @abstractmethod
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
        ...

    @abstractmethod
    async def chat(self, messages: list[dict], system_prompt: str) -> str:
        """Send a chat message and get a response.

        Args:
            messages: List of {"role": "user"|"assistant", "content": str}.
            system_prompt: System prompt with context.

        Returns:
            Assistant response text.
        """
        ...

    @abstractmethod
    async def generate_sql(self, question: str, schema: str, context: str) -> str:
        """Generate a SQL query from a natural language question.

        Args:
            question: User's question.
            schema: Database schema description.
            context: Additional context (patient info, etc.)

        Returns:
            SQL SELECT query string.
        """
        ...
