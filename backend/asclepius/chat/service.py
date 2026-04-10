"""Chat RAG service — query generation, execution, and response."""

import logging
import re

import aiosqlite

from asclepius.llm.base import LLMProvider
from asclepius.llm.prompts import CHAT_SYSTEM_PROMPT, DB_SCHEMA_FOR_CHAT

logger = logging.getLogger(__name__)

# Dangerous SQL patterns
FORBIDDEN_PATTERNS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH)\b",
    re.IGNORECASE,
)


async def build_patient_context(db: aiosqlite.Connection, patient_id: int) -> str:
    """Build a context string with patient summary data."""
    # Patient info
    cursor = await db.execute(
        "SELECT display_name, date_of_birth FROM patients WHERE id = ?",
        (patient_id,),
    )
    patient = await cursor.fetchone()
    if not patient:
        return "No patient selected."

    parts = [f"Patient: {patient[0]}"]
    if patient[1]:
        parts.append(f"Date of birth: {patient[1]}")

    # Recent documents
    cursor = await db.execute(
        """SELECT doc_type, doc_date, original_filename FROM documents
           WHERE patient_id = ? AND status = 'done'
           ORDER BY doc_date DESC LIMIT 10""",
        (patient_id,),
    )
    docs = await cursor.fetchall()
    if docs:
        parts.append(f"\nRecent documents ({len(docs)}):")
        for d in docs:
            parts.append(f"  - {d[1] or '?'}: {d[0]} ({d[2]})")

    # Recent lab results
    cursor = await db.execute(
        """SELECT lr.test_name_original, lr.value, lr.unit, lr.test_date, lr.is_abnormal,
                  nlt.canonical_display
           FROM lab_results lr
           LEFT JOIN norm_lab_tests nlt ON lr.norm_lab_test_id = nlt.id
           WHERE lr.patient_id = ?
           ORDER BY lr.test_date DESC LIMIT 20""",
        (patient_id,),
    )
    labs = await cursor.fetchall()
    if labs:
        parts.append(f"\nRecent lab results ({len(labs)}):")
        for l in labs:
            name = l[5] or l[0]
            flag = " [ABNORMAL]" if l[4] else ""
            parts.append(f"  - {l[3] or '?'}: {name} = {l[1]} {l[2] or ''}{flag}")

    # Current medications
    cursor = await db.execute(
        """SELECT active_ingredient_original, dosage, frequency, prescribed_date,
                  nm.canonical_display
           FROM medications m
           LEFT JOIN norm_medications nm ON m.norm_medication_id = nm.id
           WHERE m.patient_id = ?
           ORDER BY m.prescribed_date DESC LIMIT 10""",
        (patient_id,),
    )
    meds = await cursor.fetchall()
    if meds:
        parts.append(f"\nMedications ({len(meds)}):")
        for m in meds:
            name = m[4] or m[0]
            parts.append(f"  - {name} {m[1] or ''} {m[2] or ''} (from {m[3] or '?'})")

    return "\n".join(parts)


async def chat_with_rag(
    db: aiosqlite.Connection,
    llm: LLMProvider,
    user_id: int,
    patient_id: int | None,
    message: str,
) -> dict:
    """Process a chat message using RAG over the medical database.

    Returns: {"response": str, "sources": list[dict]}
    """
    patient_context = ""
    if patient_id:
        patient_context = await build_patient_context(db, patient_id)

    # Load recent chat history
    cursor = await db.execute(
        """SELECT role, content FROM chat_history
           WHERE user_id = ? AND (patient_id = ? OR patient_id IS NULL)
           ORDER BY created_at DESC LIMIT 10""",
        (user_id, patient_id),
    )
    history_rows = await cursor.fetchall()
    history = [{"role": r[0], "content": r[1]} for r in reversed(history_rows)]

    # Try SQL-based approach first
    sources = []
    sql_result = None

    try:
        sql_query = await llm.generate_sql(message, DB_SCHEMA_FOR_CHAT, patient_context)

        if sql_query and not FORBIDDEN_PATTERNS.search(sql_query):
            # Add patient filter if not present
            if patient_id and "patient_id" not in sql_query.lower():
                logger.warning("SQL query missing patient_id filter, skipping")
            else:
                cursor = await db.execute(sql_query)
                sql_rows = await cursor.fetchall()
                if sql_rows:
                    sql_result = [dict(r) for r in sql_rows[:50]]
        else:
            logger.warning("SQL query contains forbidden patterns or is empty")
    except Exception:
        logger.warning("SQL generation/execution failed, falling back to context-based chat")

    # Build system prompt
    system = CHAT_SYSTEM_PROMPT.format(patient_context=patient_context)

    # Add SQL results as context if available
    messages = list(history)
    if sql_result:
        context_msg = f"Database query results for the user's question:\n{sql_result}\n\nUser question: {message}"
        messages.append({"role": "user", "content": context_msg})
    else:
        messages.append({"role": "user", "content": message})

    # Get LLM response
    response = await llm.chat(messages, system)

    # Save to history
    await db.execute(
        "INSERT INTO chat_history (user_id, patient_id, role, content) VALUES (?, ?, 'user', ?)",
        (user_id, patient_id, message),
    )
    await db.execute(
        "INSERT INTO chat_history (user_id, patient_id, role, content) VALUES (?, ?, 'assistant', ?)",
        (user_id, patient_id, response),
    )
    await db.commit()

    return {"response": response, "sources": sources}
