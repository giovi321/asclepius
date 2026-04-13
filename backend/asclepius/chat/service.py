"""Chat RAG service — query generation, execution, and response."""

import logging
import re

import aiosqlite

from asclepius.llm.base import LLMProvider
from asclepius.llm.prompts import CHAT_SYSTEM_PROMPT, DB_SCHEMA_FOR_CHAT

logger = logging.getLogger(__name__)

# Dangerous SQL patterns — block all write operations
FORBIDDEN_PATTERNS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|REPLACE|PRAGMA)\b",
    re.IGNORECASE,
)

# Whitelist of tables the LLM is allowed to query
ALLOWED_TABLES = {
    "documents", "patients", "facilities", "doctors",
    "document_links", "lab_results", "encounters",
    "medications", "vaccinations", "imaging_studies",
    "norm_lab_tests", "norm_lab_test_aliases",
    "norm_diagnoses", "norm_diagnosis_aliases",
    "norm_medications", "norm_medication_aliases",
    "norm_specialties", "norm_specialty_aliases",
    "medical_events", "document_event_links",
    "document_sections", "invoice_items",
}

# Maximum rows the LLM query can return
MAX_RESULT_ROWS = 100


def _sanitize_sql(sql: str, patient_id: int | None) -> str | None:
    """Validate and sanitize an LLM-generated SQL query.

    Returns the sanitized SQL string, or None if the query is rejected.
    """
    if not sql or not sql.strip():
        return None

    sql = sql.strip().rstrip(";")

    # Block forbidden patterns (write operations)
    if FORBIDDEN_PATTERNS.search(sql):
        logger.warning("SQL blocked: contains forbidden pattern")
        return None

    # Must start with SELECT
    if not sql.upper().lstrip().startswith("SELECT"):
        logger.warning("SQL blocked: does not start with SELECT")
        return None

    # Block semicolons (prevent multi-statement injection)
    if ";" in sql:
        logger.warning("SQL blocked: contains semicolon (multi-statement)")
        return None

    # Check that all referenced tables are in the whitelist
    # Extract table names from FROM and JOIN clauses
    table_pattern = re.compile(
        r'\b(?:FROM|JOIN)\s+(\w+)', re.IGNORECASE
    )
    referenced_tables = set(table_pattern.findall(sql))
    disallowed = referenced_tables - ALLOWED_TABLES
    if disallowed:
        logger.warning("SQL blocked: references disallowed tables: %s", disallowed)
        return None

    # Enforce patient_id filter via parameterized injection
    # The LLM may write `patient_id = 5` but we replace it with a parameter
    if patient_id is not None:
        # Check that patient_id is referenced somewhere
        if "patient_id" not in sql.lower():
            logger.warning("SQL blocked: missing patient_id filter for patient-scoped query")
            return None

    # Enforce LIMIT
    if "LIMIT" not in sql.upper():
        sql += f" LIMIT {MAX_RESULT_ROWS}"
    else:
        # Parse existing LIMIT and cap it
        limit_match = re.search(r'LIMIT\s+(\d+)', sql, re.IGNORECASE)
        if limit_match:
            existing_limit = int(limit_match.group(1))
            if existing_limit > MAX_RESULT_ROWS:
                sql = sql[:limit_match.start(1)] + str(MAX_RESULT_ROWS) + sql[limit_match.end(1):]

    return sql


async def _execute_safe_sql(
    db: aiosqlite.Connection, sql: str, patient_id: int | None
) -> list[dict] | None:
    """Execute a sanitized SQL query within a read-only savepoint.

    Uses parameterized patient_id injection — replaces any literal patient_id
    value in the query with a parameter placeholder.
    """
    params = []

    if patient_id is not None:
        # Replace literal patient_id values with parameterized placeholder
        # Handles: patient_id = 5, patient_id=5, patient_id = '5'
        sql_replaced = re.sub(
            r"patient_id\s*=\s*(?:'?\d+'?|\?)",
            "patient_id = ?",
            sql,
            flags=re.IGNORECASE,
        )
        # Count how many patient_id placeholders we created
        param_count = sql_replaced.lower().count("patient_id = ?")
        params = [patient_id] * param_count
        sql = sql_replaced

    try:
        # Use a savepoint so we can rollback if anything goes wrong
        await db.execute("SAVEPOINT chat_query")
        cursor = await db.execute(sql, params)
        rows = await cursor.fetchall()
        await db.execute("RELEASE SAVEPOINT chat_query")
        return [dict(r) for r in rows[:MAX_RESULT_ROWS]]
    except Exception as e:
        logger.warning("Chat SQL execution failed: %s — Query: %s", e, sql[:200])
        try:
            await db.execute("ROLLBACK TO SAVEPOINT chat_query")
            await db.execute("RELEASE SAVEPOINT chat_query")
        except Exception:
            pass
        return None


async def build_patient_context(db: aiosqlite.Connection, patient_id: int) -> str:
    """Build a context string with patient summary data."""
    # Patient info
    cursor = await db.execute(
        """SELECT display_name, date_of_birth, sex, blood_type, allergies,
                  insurance_company, insurance_number
           FROM patients WHERE id = ?""",
        (patient_id,),
    )
    patient = await cursor.fetchone()
    if not patient:
        return "No patient selected."

    parts = [f"Patient: {patient[0]}"]
    if patient[1]:
        parts.append(f"Date of birth: {patient[1]}")
    if patient[2]:
        parts.append(f"Sex: {patient[2]}")
    if patient[3]:
        parts.append(f"Blood type: {patient[3]}")
    if patient[4]:
        parts.append(f"Allergies: {patient[4]}")
    if patient[5]:
        parts.append(f"Insurance: {patient[5]} ({patient[6] or 'N/A'})")

    # Recent documents
    cursor = await db.execute(
        """SELECT d.doc_type, d.doc_date, d.original_filename, d.summary_en,
                  doc.name as doctor_name, f.name as facility_name
           FROM documents d
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           WHERE d.patient_id = ? AND d.status = 'done'
           ORDER BY d.doc_date DESC LIMIT 10""",
        (patient_id,),
    )
    docs = await cursor.fetchall()
    if docs:
        parts.append(f"\nRecent documents ({len(docs)}):")
        for d in docs:
            provider_info = ""
            if d[4]:
                provider_info += f" Dr. {d[4]}"
            if d[5]:
                provider_info += f" @ {d[5]}"
            summary = f" - {d[3]}" if d[3] else ""
            parts.append(f"  - {d[1] or '?'}: {d[0]} ({d[2]}){provider_info}{summary}")

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

        if sql_query:
            # Sanitize and validate the LLM-generated SQL
            safe_sql = _sanitize_sql(sql_query, patient_id)
            if safe_sql:
                sql_result = await _execute_safe_sql(db, safe_sql, patient_id)
            else:
                logger.warning("LLM-generated SQL was rejected by sanitizer")
        else:
            logger.debug("LLM returned empty SQL query")
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
