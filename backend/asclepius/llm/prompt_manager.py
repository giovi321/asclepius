"""Prompt manager — serves prompts from DB (custom) or defaults (hardcoded)."""

import logging

import aiosqlite

from asclepius.llm import prompts as default_prompts

logger = logging.getLogger(__name__)

# Registry of all configurable prompts with their keys and descriptions
PROMPT_REGISTRY = {
    "classification": {
        "description": "Phase 1: Document classification and basic metadata extraction",
        "default_attr": "CLASSIFICATION_PROMPT",
    },
    "extraction_bloodtest": {
        "description": "Phase 2: Extract lab results from blood test documents",
        "default_key": "bloodtest",
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
    "extraction_radiology": {
        "description": "Phase 2: Extract findings from radiology reports",
        "default_key": "radiology_report",
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
            cursor = await db.execute("SELECT prompt_key, prompt_text, updated_at FROM custom_prompts")
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
        result.append({
            "key": key,
            "description": info["description"],
            "text": custom_data["text"] if custom_data else default_text,
            "is_custom": key in custom,
            "updated_at": custom_data["updated_at"] if custom_data else None,
            "default_length": len(default_text),
        })

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
