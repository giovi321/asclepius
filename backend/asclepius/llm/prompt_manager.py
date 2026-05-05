"""Prompt manager — serves prompts from DB (custom) or defaults (hardcoded)."""

import logging

import aiosqlite

from asclepius.llm import prompts as default_prompts

logger = logging.getLogger(__name__)

# Registry of all configurable prompts with their keys and descriptions
# Master reference — every placeholder that can appear in any prompt template.
# Used by the UI and docs to describe what each {variable} gets substituted with.
PROMPT_VARIABLES: dict[str, str] = {
    "ocr_text": "Full OCR-extracted text of the document.",
    "pages_text": "Multi-page OCR text, formatted as `--- PAGE N ---\\n<text>`.",
    "patient_list": "JSON list of known patients (id, slug, name, DOB, sex).",
    "facility_list": "JSON list of known facilities (id, slug, name).",
    "doctor_list": "JSON list of known doctors (id, slug, name).",
    "few_shot_examples": "1–2 similar prior documents with their extractions, used as in-context examples.",
    "lab_test_mappings": "JSON list of canonical lab-test aliases. Substituted only if the placeholder appears in the template.",
    "specialty_mappings": "JSON list of canonical specialty aliases. Substituted only if the placeholder appears in the template.",
    "diagnosis_mappings": "JSON list of canonical diagnosis/ICD-10 aliases. Substituted only if the placeholder appears in the template.",
    "medication_mappings": "JSON list of canonical medication aliases. Substituted only if the placeholder appears in the template.",
    "doc_id": "ID of the current document.",
    "doc_type": "Classified document type (bloodtest, invoice, discharge, …).",
    "doc_date": "Canonical event date (YYYY-MM-DD or 'unknown'). Placeholder name kept for template compat; value comes from documents.event_date.",
    "doctor_name": "Treating/signing doctor's name from the extraction.",
    "facility_name": "Facility/hospital/clinic name from the extraction.",
    "summary": "English summary of the document.",
    "other_documents": "Text list of other documents belonging to the same patient.",
    "schema": "SQLite schema (tables + columns) for SQL generation.",
    "context": "Patient context snippet used by chat and SQL generation.",
    "question": "User's natural-language question (chat).",
    "patient_context": "Formatted patient demographics + recent history (chat system prompt).",
    "current_data": "Current document extraction rendered as JSON (document_edit).",
    "user_instruction": "User's correction/edit instruction (document_edit).",
    "json_schema": "Expected JSON-schema response shape (document_edit).",
}

# Per-prompt placeholder lists. Suffix "?" marks an optional placeholder —
# it is substituted only if it actually appears in the (custom) template.
PROMPT_VARIABLE_KEYS: dict[str, list[str]] = {
    "classification": [
        "patient_list",
        "facility_list",
        "doctor_list",
        "ocr_text",
        "few_shot_examples",
    ],
    "vision_extraction": [],
    "extraction_lab_test": ["ocr_text", "lab_test_mappings?"],
    "extraction_specialist_report": [
        "ocr_text",
        "specialty_mappings?",
        "diagnosis_mappings?",
        "medication_mappings?",
    ],
    "extraction_prescription": ["ocr_text", "medication_mappings?"],
    "extraction_invoice": ["ocr_text"],
    "extraction_discharge": ["ocr_text", "diagnosis_mappings?", "medication_mappings?"],
    "extraction_imaging_report": ["ocr_text"],
    "extraction_surgical_report": ["ocr_text"],
    "extraction_vaccination": ["ocr_text"],
    "document_edit": [
        "current_data",
        "patient_list",
        "facility_list",
        "doctor_list",
        "user_instruction",
        "json_schema",
    ],
    "sql_generation": ["schema", "context", "question"],
    "chat_system": ["patient_context"],
    "link_suggestion": [
        "doc_id",
        "doc_type",
        "doc_date",
        "doctor_name",
        "facility_name",
        "summary",
        "other_documents",
    ],
    "page_classification": ["pages_text"],
    "translation": ["ocr_text", "target_language"],
}


def _variables_for(key: str) -> list[dict]:
    out = []
    for raw in PROMPT_VARIABLE_KEYS.get(key, []):
        optional = raw.endswith("?")
        name = raw.rstrip("?")
        out.append(
            {
                "name": name,
                "description": PROMPT_VARIABLES.get(name, ""),
                "optional": optional,
            }
        )
    return out


PROMPT_REGISTRY = {
    "classification": {
        "description": "Phase 1: Document classification and basic metadata extraction",
        "default_attr": "CLASSIFICATION_PROMPT",
    },
    "vision_extraction": {
        "description": "Vision-LLM flow: single-step image → OCR + classification + metadata",
        "default_attr": "VISION_EXTRACTION_PROMPT",
    },
    "extraction_lab_test": {
        "description": "Phase 2: Extract lab results from lab test documents",
        "default_key": "lab_test",
    },
    "extraction_specialist_report": {
        "description": "Phase 2: Extract diagnoses, encounters, medications from specialist reports",
        "default_key": "specialist_report",
    },
    "extraction_prescription": {
        "description": "Phase 2: Extract medications from prescriptions",
        "default_key": "prescription",
    },
    "extraction_invoice": {
        "description": "Phase 2: Extract cost and line items from invoices",
        "default_key": "invoice",
    },
    "extraction_discharge": {
        "description": "Phase 2: Extract data from discharge letters",
        "default_key": "discharge",
    },
    "extraction_imaging_report": {
        "description": "Phase 2: Extract findings from imaging/radiology reports",
        "default_key": "imaging_report",
    },
    "extraction_surgical_report": {
        "description": "Phase 2: Extract operative details from surgical reports",
        "default_key": "surgical_report",
    },
    "extraction_vaccination": {
        "description": "Phase 2: Extract vaccination records",
        "default_key": "vaccination",
    },
    "document_edit": {
        "description": "AI-powered document metadata editing",
        "default_attr": "DOCUMENT_EDIT_PROMPT",
    },
    "sql_generation": {
        "description": "Chat: Generate SQL queries from natural language",
        "default_attr": "SQL_GENERATION_PROMPT",
    },
    "chat_system": {
        "description": "Chat: System prompt for the medical records assistant",
        "default_attr": "CHAT_SYSTEM_PROMPT",
    },
    "link_suggestion": {
        "description": "Suggest related documents for linking",
        "default_attr": "LINK_SUGGESTION_PROMPT",
    },
    "page_classification": {
        "description": "Classify pages of multi-page documents into content types",
        "default_attr": "PAGE_CLASSIFICATION_PROMPT",
    },
    "translation": {
        "description": "On-demand translation of a document body into a configurable target language",
        "default_attr": "TRANSLATION_PROMPT",
    },
}


def get_default_prompt(key: str) -> str:
    """Get the hardcoded default prompt for a key."""
    info = PROMPT_REGISTRY.get(key, {})

    if "default_attr" in info:
        return getattr(default_prompts, info["default_attr"], "")

    if "default_key" in info:
        return default_prompts.TYPE_EXTRACTION_PROMPTS.get(info["default_key"], "")

    return ""


async def get_prompt(db_path: str, key: str) -> str:
    """Get a prompt — custom from DB if exists, otherwise default."""
    try:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT prompt_text FROM custom_prompts WHERE prompt_key = ?", (key,)
            )
            row = await cursor.fetchone()
            if row and row["prompt_text"]:
                return row["prompt_text"]
    except Exception:
        pass

    return get_default_prompt(key)


async def get_all_prompts(db_path: str) -> list[dict]:
    """Get all prompts with their current values (custom or default)."""
    result = []
    custom = {}

    try:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT prompt_key, prompt_text, updated_at FROM custom_prompts"
            )
            for row in await cursor.fetchall():
                custom[row["prompt_key"]] = {
                    "text": row["prompt_text"],
                    "updated_at": row["updated_at"],
                }
    except Exception:
        pass

    for key, info in PROMPT_REGISTRY.items():
        default_text = get_default_prompt(key)
        custom_data = custom.get(key)
        result.append(
            {
                "key": key,
                "description": info["description"],
                "text": custom_data["text"] if custom_data else default_text,
                "is_custom": key in custom,
                "updated_at": custom_data["updated_at"] if custom_data else None,
                "default_length": len(default_text),
                "variables": _variables_for(key),
            }
        )

    return result


async def set_prompt(db_path: str, key: str, text: str) -> None:
    """Save a custom prompt to the DB."""
    if key not in PROMPT_REGISTRY:
        raise ValueError(f"Unknown prompt key: {key}")

    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute(
            """INSERT INTO custom_prompts (prompt_key, prompt_text, description, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(prompt_key) DO UPDATE SET
               prompt_text = excluded.prompt_text,
               updated_at = CURRENT_TIMESTAMP""",
            (key, text, PROMPT_REGISTRY[key]["description"]),
        )
        await db.commit()


async def reset_prompt(db_path: str, key: str) -> None:
    """Delete custom prompt, reverting to default."""
    async with aiosqlite.connect(db_path) as db:
        await db.execute("DELETE FROM custom_prompts WHERE prompt_key = ?", (key,))
        await db.commit()
