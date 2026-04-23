"""Correction-driven learning — capture user edits to LLM-extracted fields.

When users manually correct document metadata (doc_type, dates, doctor, etc.),
the before/after values are logged. These corrections are later used as
high-quality few-shot examples for retrieval-augmented extraction.
"""

import json
import logging

import aiosqlite

logger = logging.getLogger(__name__)

# Fields we track corrections for, mapped to their path in raw_extraction JSON.
# Tuple means nested: ("doctor", "name") → raw_extraction["doctor"]["name"]
CORRECTABLE_FIELDS = {
    "doc_type": ("doc_type",),
    "event_date": ("event_date",),
    "issued_date": ("issued_date",),
    "doctor_name": ("doctor", "name"),
    "facility_name": ("facility", "name"),
    "specialty_original": ("specialty", "original"),
    "summary_en": ("summary_en",),
}


def _get_nested(d: dict, path: tuple) -> str | None:
    """Get a nested value from a dict using a path tuple."""
    val = d
    for key in path:
        if not isinstance(val, dict):
            return None
        val = val.get(key)
    return str(val) if val is not None else None


async def log_corrections(db: aiosqlite.Connection, doc_id: int, updates: dict) -> None:
    """Compare user updates against raw LLM extraction and log differences.

    Only logs corrections for fields that differ from what the LLM originally extracted.
    Silently skips if no raw_extraction exists (e.g. manually created documents).
    """
    # Only check fields that are being updated and are correctable
    fields_to_check = {k: v for k, v in updates.items() if k in CORRECTABLE_FIELDS and v is not None}
    if not fields_to_check:
        return

    try:
        cursor = await db.execute(
            "SELECT raw_extraction, facility_id, doc_type FROM documents WHERE id = ?",
            (doc_id,),
        )
        row = await cursor.fetchone()
        if not row or not row[0]:
            return  # No raw extraction to compare against

        raw = json.loads(row[0]) if isinstance(row[0], str) else row[0]
        facility_id = row[1]
        doc_type = row[2]

        for field_name, corrected_value in fields_to_check.items():
            path = CORRECTABLE_FIELDS[field_name]
            llm_value = _get_nested(raw, path)
            corrected_str = str(corrected_value)

            # Only log if the values actually differ
            if llm_value == corrected_str:
                continue

            await db.execute(
                """INSERT INTO extraction_corrections
                   (document_id, field_name, llm_value, corrected_value, facility_id, doc_type)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (doc_id, field_name, llm_value, corrected_str, facility_id, doc_type),
            )
            logger.info("Correction logged for doc %d: %s = %s → %s",
                        doc_id, field_name, repr(llm_value)[:40], repr(corrected_str)[:40])

    except Exception:
        # Never let correction logging break the actual edit operation
        logger.warning("Failed to log corrections for doc %d (non-fatal)", doc_id, exc_info=True)
