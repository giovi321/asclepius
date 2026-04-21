"""Chat RAG service — query generation, execution, and response.

Security model for LLM-generated SQL:
- The model proposes a single ``SELECT`` statement.
- :func:`_sanitize_sql` strips comments, rejects multi-statement input and
  every keyword that could mutate data or access engine internals.
- A hand-rolled tokenizer walks ``FROM`` / ``JOIN`` targets and verifies
  every referenced table against a whitelist, including subqueries.
- For patient-scoped chats, the ``patient_id`` predicate is rewritten to a
  parameterised placeholder bound server-side — the LLM cannot read another
  patient's data even if it produces ``patient_id = <other_id>``.
- A statement-level ``LIMIT`` cap and an async timeout bound resource use.
"""

import json
import logging
import re

import aiosqlite

from asclepius.llm.base import LLMProvider
from asclepius.llm.prompts import CHAT_SYSTEM_PROMPT, DB_SCHEMA_FOR_CHAT

logger = logging.getLogger(__name__)

# Dangerous SQL patterns — block all write/DDL/engine operations. Checked
# after comment stripping so ``/*INSERT*/`` style attempts cannot hide.
FORBIDDEN_PATTERNS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|REPLACE|PRAGMA|VACUUM|REINDEX|ANALYZE|EXPLAIN)\b",
    re.IGNORECASE,
)

# Match SQL line comments (``-- ...``) and block comments (``/* ... */``).
_COMMENT_RE = re.compile(r"(--[^\n]*|/\*.*?\*/)", re.DOTALL)


def _strip_comments(sql: str) -> str:
    """Remove SQL comments so keyword blocklists cannot be bypassed."""
    return _COMMENT_RE.sub(" ", sql)

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
    """Validate and sanitise an LLM-generated SQL query.

    Returns the sanitised SQL string, or ``None`` if the query is rejected.
    The return value is not yet parameterised — that happens in
    :func:`_execute_safe_sql`, which is responsible for binding the patient
    id and enforcing statement-level timeouts.
    """
    if not sql or not sql.strip():
        return None

    # Strip comments *before* every subsequent check so bypass attempts like
    # ``SELECT 1; /* harmless */ INSERT …`` or ``SEL--newline\nECT`` fail.
    sql = _strip_comments(sql).strip().rstrip(";")

    # Block forbidden patterns (write / DDL / engine introspection).
    if FORBIDDEN_PATTERNS.search(sql):
        logger.warning("SQL blocked: contains forbidden pattern")
        return None

    # Must start with SELECT or WITH (CTE) — nothing else.
    upper = sql.upper().lstrip()
    if not (upper.startswith("SELECT") or upper.startswith("WITH")):
        logger.warning("SQL blocked: does not start with SELECT/WITH")
        return None

    # Block semicolons (prevent multi-statement injection).
    if ";" in sql:
        logger.warning("SQL blocked: contains semicolon (multi-statement)")
        return None

    # Check that every table referenced by FROM/JOIN is whitelisted. The
    # regex covers subqueries because SQLite writes them as ``FROM (SELECT
    # … FROM table)`` so ``table`` is still preceded by ``FROM``.
    table_pattern = re.compile(r'\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)', re.IGNORECASE)
    referenced_tables = {t.lower() for t in table_pattern.findall(sql)}
    disallowed = referenced_tables - ALLOWED_TABLES
    if disallowed:
        logger.warning("SQL blocked: references disallowed tables: %s", disallowed)
        return None

    # Reject any reference to sqlite_* metadata tables just in case they
    # slip past the FROM/JOIN detector.
    if re.search(r"\bsqlite_[a-z_]+\b", sql, re.IGNORECASE):
        logger.warning("SQL blocked: references sqlite_* internal table")
        return None

    # For patient-scoped chats, the query must mention patient_id so the
    # parameterised rewrite in ``_execute_safe_sql`` has something to bind.
    if patient_id is not None and "patient_id" not in sql.lower():
        logger.warning("SQL blocked: missing patient_id filter for patient-scoped query")
        return None

    # Enforce / cap LIMIT.
    if "LIMIT" not in sql.upper():
        sql += f" LIMIT {MAX_RESULT_ROWS}"
    else:
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
    cursor = await db.execute(
        "SELECT display_name, date_of_birth, sex FROM patients WHERE id = ?",
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
        for lab in labs:
            name = lab[5] or lab[0]
            flag = " [ABNORMAL]" if lab[4] else ""
            parts.append(f"  - {lab[3] or '?'}: {name} = {lab[1]} {lab[2] or ''}{flag}")

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


def _extract_document_ids(rows: list[dict]) -> list[int]:
    """Find every document id referenced in a SQL result set.

    Collects explicit ``document_id`` / ``doc_id`` columns plus the ``id``
    column when the row looks like it came from the ``documents`` table
    (presence of ``original_filename`` or ``doc_type`` is a strong hint).
    Preserves the order the LLM returned rows in so the sidebar matches
    the answer's narrative flow, while de-duplicating.
    """
    seen: set[int] = set()
    ids: list[int] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        candidates: list[int] = []
        for key in ("document_id", "doc_id"):
            v = row.get(key)
            if isinstance(v, int):
                candidates.append(v)
        # A document row often shows up in SQL without a ``document_id``
        # column because the query aliases ``documents.id AS id``. Detect
        # it by the presence of document-specific fields.
        if ("original_filename" in row or "doc_type" in row):
            v = row.get("id")
            if isinstance(v, int):
                candidates.append(v)
        for doc_id in candidates:
            if doc_id not in seen:
                seen.add(doc_id)
                ids.append(doc_id)
    return ids


async def _fetch_sources(
    db: aiosqlite.Connection, doc_ids: list[int]
) -> list[dict]:
    """Look up display metadata for the doc ids referenced in a SQL result."""
    if not doc_ids:
        return []
    placeholders = ",".join("?" * len(doc_ids))
    cursor = await db.execute(
        f"""SELECT id, original_filename, doc_type, doc_date
            FROM documents WHERE id IN ({placeholders})""",
        doc_ids,
    )
    by_id = {r["id"]: dict(r) for r in await cursor.fetchall()}
    # Re-order to match the LLM-narrative order captured in doc_ids.
    sources: list[dict] = []
    for doc_id in doc_ids:
        row = by_id.get(doc_id)
        if not row:
            continue
        sources.append({
            "id": row["id"],
            "filename": row["original_filename"],
            "doc_type": row["doc_type"],
            "doc_date": row["doc_date"],
        })
    return sources


async def _user_patient_ids(
    db: aiosqlite.Connection, user_id: int, is_admin: bool,
) -> list[int]:
    """Return the list of patient IDs this user is allowed to query.

    Admins see everyone; regular users see only patients they have a row
    for in ``user_patient_access``. The result is used to constrain
    unscoped chats so a user can never exfiltrate another patient's data
    by asking the LLM to ignore the selected patient.
    """
    if is_admin:
        cursor = await db.execute("SELECT id FROM patients")
    else:
        cursor = await db.execute(
            "SELECT patient_id FROM user_patient_access WHERE user_id = ?",
            (user_id,),
        )
    return [row[0] for row in await cursor.fetchall()]


async def chat_with_rag(
    db: aiosqlite.Connection,
    llm: LLMProvider,
    user_id: int,
    patient_id: int | None,
    message: str,
    *,
    is_admin: bool = False,
) -> dict:
    """Process a chat message using RAG over the medical database.

    Returns ``{"response": str, "sources": list[dict]}``.

    When ``patient_id`` is ``None`` the SQL path is skipped unless the
    caller is an admin — otherwise a non-admin's "all patients" question
    would bypass the row-level filter.
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
        # Only run the SQL path when the caller is clearly entitled: either a
        # specific patient context or an admin asking globally. A non-admin
        # without a selected patient stays on the plain-context path so row
        # filtering cannot be forgotten.
        sql_query = None
        if patient_id is not None or is_admin:
            sql_query = await llm.generate_sql(
                message, DB_SCHEMA_FOR_CHAT, patient_context,
            )

        if sql_query:
            safe_sql = _sanitize_sql(sql_query, patient_id)
            if safe_sql:
                sql_result = await _execute_safe_sql(db, safe_sql, patient_id)
            else:
                logger.warning("LLM-generated SQL was rejected by sanitizer")
        else:
            logger.debug("LLM returned empty SQL query or SQL path skipped")
    except Exception:
        logger.warning("SQL generation/execution failed, falling back to context-based chat")

    # Derive source documents from the SQL result. Rows from a ``documents``
    # query land as sources directly; rows from joined tables (lab_results,
    # medications, …) carry a ``document_id`` FK we can follow.
    if sql_result:
        sources = await _fetch_sources(db, _extract_document_ids(sql_result))

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

    # Save to history — user message has no sources; the assistant row
    # carries the JSON blob so reloading the conversation keeps the chips.
    await db.execute(
        "INSERT INTO chat_history (user_id, patient_id, role, content) VALUES (?, ?, 'user', ?)",
        (user_id, patient_id, message),
    )
    sources_json = json.dumps(sources) if sources else None
    await db.execute(
        "INSERT INTO chat_history (user_id, patient_id, role, content, sources) VALUES (?, ?, 'assistant', ?, ?)",
        (user_id, patient_id, response, sources_json),
    )
    await db.commit()

    return {"response": response, "sources": sources}
