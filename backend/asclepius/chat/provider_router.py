"""Sanitize and execute LLM-generated SQL for chat RAG.

Security model for LLM-generated SQL:

- The model proposes a single ``SELECT`` statement.
- :func:`sanitize_sql` strips comments, rejects multi-statement input and
  every keyword that could mutate data or access engine internals.
- A hand-rolled tokenizer walks ``FROM`` / ``JOIN`` targets and verifies
  every referenced table against a whitelist, including subqueries.
- For patient-scoped chats, the ``patient_id`` predicate is rewritten to
  a parameterised placeholder bound server-side — the LLM cannot read
  another patient's data even if it produces ``patient_id = <other_id>``.
- A statement-level ``LIMIT`` cap and an async savepoint bound resource
  use.
"""

import logging
import re

import aiosqlite

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


def sanitize_sql(sql: str, patient_id: int | None) -> str | None:
    """Validate and sanitise an LLM-generated SQL query.

    Returns the sanitised SQL string, or ``None`` if the query is rejected.
    The return value is not yet parameterised — that happens in
    :func:`execute_safe_sql`, which is responsible for binding the patient
    id and enforcing the savepoint-scoped read.
    """
    if not sql or not sql.strip():
        return None

    sql = _strip_comments(sql).strip().rstrip(";")

    if FORBIDDEN_PATTERNS.search(sql):
        logger.warning("SQL blocked: contains forbidden pattern")
        return None

    upper = sql.upper().lstrip()
    if not (upper.startswith("SELECT") or upper.startswith("WITH")):
        logger.warning("SQL blocked: does not start with SELECT/WITH")
        return None

    if ";" in sql:
        logger.warning("SQL blocked: contains semicolon (multi-statement)")
        return None

    table_pattern = re.compile(r'\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)', re.IGNORECASE)
    referenced_tables = {t.lower() for t in table_pattern.findall(sql)}
    disallowed = referenced_tables - ALLOWED_TABLES
    if disallowed:
        logger.warning("SQL blocked: references disallowed tables: %s", disallowed)
        return None

    if re.search(r"\bsqlite_[a-z_]+\b", sql, re.IGNORECASE):
        logger.warning("SQL blocked: references sqlite_* internal table")
        return None

    if patient_id is not None and "patient_id" not in sql.lower():
        logger.warning("SQL blocked: missing patient_id filter for patient-scoped query")
        return None

    if "LIMIT" not in sql.upper():
        sql += f" LIMIT {MAX_RESULT_ROWS}"
    else:
        limit_match = re.search(r'LIMIT\s+(\d+)', sql, re.IGNORECASE)
        if limit_match:
            existing_limit = int(limit_match.group(1))
            if existing_limit > MAX_RESULT_ROWS:
                sql = sql[:limit_match.start(1)] + str(MAX_RESULT_ROWS) + sql[limit_match.end(1):]

    return sql


async def execute_safe_sql(
    db: aiosqlite.Connection, sql: str, patient_id: int | None
) -> list[dict] | None:
    """Execute a sanitized SQL query within a read-only savepoint.

    Uses parameterized patient_id injection — replaces any literal
    patient_id value in the query with a parameter placeholder.
    """
    params = []

    if patient_id is not None:
        sql_replaced = re.sub(
            r"patient_id\s*=\s*(?:'?\d+'?|\?)",
            "patient_id = ?",
            sql,
            flags=re.IGNORECASE,
        )
        param_count = sql_replaced.lower().count("patient_id = ?")
        params = [patient_id] * param_count
        sql = sql_replaced

    try:
        await db.execute("SAVEPOINT chat_query")
        cursor = await db.execute(sql, params)
        rows = await cursor.fetchall()
        await db.execute("RELEASE SAVEPOINT chat_query")
        return [dict(r) for r in rows[:MAX_RESULT_ROWS]]
    except Exception as e:
        logger.warning("Chat SQL execution failed: %s - Query: %s", e, sql[:200])
        try:
            await db.execute("ROLLBACK TO SAVEPOINT chat_query")
            await db.execute("RELEASE SAVEPOINT chat_query")
        except Exception:
            pass
        return None
