"""Chat RAG orchestrator.

Ties together the SQL guardrail in :mod:`provider_router` and the context
helpers in :mod:`message_builder`. The private helpers that used to live
here are re-exported at module-level for backward compatibility with any
caller that was reaching into them directly.
"""

import json
import logging
import re

import aiosqlite

from asclepius.llm.base import LLMProvider
from asclepius.llm.prompts import CHAT_SYSTEM_PROMPT, DB_SCHEMA_FOR_CHAT

from .message_builder import (
    _DOC_ROW_MARKERS,
    build_patient_context,
    extract_document_ids,
    fetch_sources,
    match_document_rows,
    user_patient_ids,
)
from .provider_router import (
    ALLOWED_TABLES,
    FORBIDDEN_PATTERNS,
    MAX_RESULT_ROWS,
    execute_safe_sql,
    sanitize_sql,
)

logger = logging.getLogger(__name__)

# Backward-compatible aliases for the private spellings used in tests and
# neighbouring modules.
_sanitize_sql = sanitize_sql
_execute_safe_sql = execute_safe_sql
_extract_document_ids = extract_document_ids
_match_document_rows = match_document_rows
_fetch_sources = fetch_sources
_user_patient_ids = user_patient_ids

__all__ = [
    "ALLOWED_TABLES",
    "FORBIDDEN_PATTERNS",
    "MAX_RESULT_ROWS",
    "build_patient_context",
    "chat_with_rag",
    "sanitize_sql",
    "execute_safe_sql",
    "_sanitize_sql",
    "_execute_safe_sql",
    "_extract_document_ids",
    "_match_document_rows",
    "_fetch_sources",
    "_user_patient_ids",
    "_DOC_ROW_MARKERS",
]


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
    available_docs: list[dict] = []
    if patient_id:
        patient_context, available_docs = await build_patient_context(db, patient_id)

    cursor = await db.execute(
        """SELECT role, content FROM chat_history
           WHERE user_id = ? AND (patient_id = ? OR patient_id IS NULL)
           ORDER BY created_at DESC LIMIT 10""",
        (user_id, patient_id),
    )
    history_rows = await cursor.fetchall()
    history = [{"role": r[0], "content": r[1]} for r in reversed(history_rows)]

    sources: list[dict] = []
    sql_result = None

    try:
        # Only run the SQL path when the caller is clearly entitled: either
        # a specific patient context or an admin asking globally. A non-admin
        # without a selected patient stays on the plain-context path so row
        # filtering cannot be forgotten.
        sql_query = None
        if patient_id is not None or is_admin:
            sql_query = await llm.generate_sql(
                message,
                DB_SCHEMA_FOR_CHAT,
                patient_context,
            )

        if sql_query:
            safe_sql = sanitize_sql(sql_query, patient_id)
            if safe_sql:
                sql_result = await execute_safe_sql(db, safe_sql, patient_id)
            else:
                logger.warning("LLM-generated SQL was rejected by sanitizer")
        else:
            logger.debug("LLM returned empty SQL query or SQL path skipped")
    except Exception:
        logger.warning("SQL generation/execution failed, falling back to context-based chat")

    # Derive source documents from the SQL result. Rows from a ``documents``
    # query land as sources directly; rows from joined tables (lab_results,
    # medications, ...) carry a ``document_id`` FK we can follow. When the
    # LLM queries ``documents`` but forgets to select the id column, fall
    # back to matching by filename / event_date so the sidebar still
    # populates.
    if sql_result:
        doc_ids = extract_document_ids(sql_result)
        if not doc_ids:
            doc_ids = await match_document_rows(db, sql_result, patient_id)
        if not doc_ids:
            logger.debug(
                "Chat: SQL result had %d rows but no document ids could be resolved",
                len(sql_result),
            )
        sources = await fetch_sources(db, doc_ids)

    system = CHAT_SYSTEM_PROMPT.format(patient_context=patient_context)

    # Merge docs the LLM is about to be shown: whatever the SQL path pulled
    # plus whatever the patient-context summary already lists. We hand this
    # unified list to the LLM as an id mapping so it can always emit proper
    # ``/documents/<id>`` links, even when no SQL was generated — the old
    # flow only gave it ids when SQL ran, so filename-only fallback links
    # would point at the filename in the address bar.
    available_by_id: dict[int, dict] = {}
    for s in sources:
        if isinstance(s.get("id"), int):
            available_by_id[s["id"]] = s
    for d in available_docs:
        if isinstance(d.get("id"), int) and d["id"] not in available_by_id:
            available_by_id[d["id"]] = d
    available = list(available_by_id.values())

    messages = list(history)
    user_parts: list[str] = []
    if sql_result:
        user_parts.append(f"Database query results for the user's question:\n{sql_result}")
    if available:
        doc_lines = "\n".join(
            f"- id={s['id']} filename={s['filename']!r} "
            f"doc_type={s['doc_type']!r} event_date={s['event_date']!r}"
            for s in available
        )
        user_parts.append(
            "Available documents (use these ids for links formatted as "
            "`[filename](/documents/<id>)`):\n" + doc_lines
        )
    user_parts.append(f"User question: {message}" if user_parts else message)
    messages.append({"role": "user", "content": "\n\n".join(user_parts)})

    response = await llm.chat(messages, system)

    # Scan the LLM's reply for ``/documents/<id>`` links it actually used,
    # so the sidebar reflects the cited documents even on the non-SQL path
    # (patient_context flow). Merge in-response ids with sql-derived sources
    # and preserve the first-seen order so the sidebar matches narrative.
    cited_ids: list[int] = []
    seen_cited: set[int] = set()
    for m in re.finditer(r"/documents/(\d+)", response):
        doc_id = int(m.group(1))
        if doc_id in seen_cited:
            continue
        seen_cited.add(doc_id)
        cited_ids.append(doc_id)
    if cited_ids:
        source_by_id = {s["id"]: s for s in sources}
        # Only surface docs that were in the id set we explicitly handed the
        # LLM. If the model hallucinates an id, silently drop it rather than
        # fetching it — otherwise a bad id could leak another patient's doc
        # metadata into the sidebar.
        for doc_id in cited_ids:
            if doc_id in source_by_id:
                continue
            match = available_by_id.get(doc_id)
            if match is not None:
                sources.append(match)

    # Save to history — the user message has no sources; the assistant row
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
