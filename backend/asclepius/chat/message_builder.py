"""Patient context + source resolution for chat RAG.

Pure data assembly — takes a DB connection and patient/user ids, returns
strings and dict lists that the orchestrator hands to the LLM.
"""

import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def build_patient_context(
    db: aiosqlite.Connection, patient_id: int,
) -> tuple[str, list[dict]]:
    """Build a context string with patient summary data.

    Returns ``(context_text, available_docs)`` where ``available_docs`` is
    the set of documents the LLM was shown — used to (a) hand back an
    id-keyed mapping so the LLM can emit proper ``/documents/<id>`` links
    even on the non-SQL path, and (b) seed the sources sidebar so the
    sidebar reflects what the LLM was citing from.
    """
    available_docs: list[dict] = []
    cursor = await db.execute(
        "SELECT display_name, date_of_birth, sex FROM patients WHERE id = ?",
        (patient_id,),
    )
    patient = await cursor.fetchone()
    if not patient:
        return "No patient selected.", available_docs

    parts = [f"Patient: {patient[0]}"]
    if patient[1]:
        parts.append(f"Date of birth: {patient[1]}")
    if patient[2]:
        parts.append(f"Sex: {patient[2]}")

    cursor = await db.execute(
        """SELECT d.id, d.doc_type, d.event_date, d.original_filename, d.summary_en,
                  doc.name as doctor_name, f.name as facility_name
           FROM documents d
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           WHERE d.patient_id = ? AND d.status = 'done'
           ORDER BY d.event_date DESC LIMIT 10""",
        (patient_id,),
    )
    docs = await cursor.fetchall()
    if docs:
        parts.append(f"\nRecent documents ({len(docs)}):")
        for d in docs:
            provider_info = ""
            if d[5]:
                provider_info += f" Dr. {d[5]}"
            if d[6]:
                provider_info += f" @ {d[6]}"
            summary = f" - {d[4]}" if d[4] else ""
            parts.append(f"  - {d[2] or '?'}: {d[1]} ({d[3]}){provider_info}{summary}")
            available_docs.append({
                "id": d[0],
                "filename": d[3],
                "doc_type": d[1],
                "event_date": d[2],
            })

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


# Columns unique enough to ``documents`` that their presence in a row tells
# us the row's ``id`` column is a document id, not the id of a joined table.
_DOC_ROW_MARKERS = frozenset({
    "original_filename", "doc_type", "event_date", "issued_date",
    "date_received", "summary_en", "summary_original", "ocr_text",
    "raw_extraction", "file_path", "specialty_original",
})


def extract_document_ids(rows: list[dict]) -> list[int]:
    """Find every document id referenced in a SQL result set.

    Collects explicit ``document_id`` / ``doc_id`` columns plus the ``id``
    column when the row carries any documents-only field (see
    ``_DOC_ROW_MARKERS``). Preserves the order the LLM returned rows in so
    the sidebar matches the answer's narrative flow, while de-duplicating.
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
        if _DOC_ROW_MARKERS & row.keys():
            v = row.get("id")
            if isinstance(v, int):
                candidates.append(v)
        for doc_id in candidates:
            if doc_id not in seen:
                seen.add(doc_id)
                ids.append(doc_id)
    return ids


async def match_document_rows(
    db: aiosqlite.Connection,
    rows: list[dict],
    patient_id: int | None,
) -> list[int]:
    """Resolve document ids for result rows that carry document markers but no id.

    The SQL generation prompt asks the LLM to include ``documents.id`` when
    the query touches the documents table, but the model doesn't always
    comply. When every marker-bearing row is missing an id we fall back to
    matching on ``original_filename`` / ``event_date`` / ``doc_type`` — any
    of those is usually enough to pin the row to a specific document, and we
    scope the lookup to the active patient so a leaked filename from
    another patient can't end up in the sidebar.
    """
    clauses: list[str] = []
    params: list = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if (isinstance(row.get("id"), int)
                or isinstance(row.get("document_id"), int)
                or isinstance(row.get("doc_id"), int)):
            continue
        if not (_DOC_ROW_MARKERS & row.keys()):
            continue
        parts: list[str] = []
        fn = row.get("original_filename")
        dd = row.get("event_date")
        dt = row.get("doc_type")
        if fn:
            parts.append("original_filename = ?")
            params.append(fn)
        if dd:
            parts.append("event_date = ?")
            params.append(dd)
        if dt:
            parts.append("doc_type = ?")
            params.append(dt)
        if parts:
            clauses.append("(" + " AND ".join(parts) + ")")
    if not clauses:
        return []
    sql = f"SELECT id FROM documents WHERE ({' OR '.join(clauses)})"
    if patient_id is not None:
        sql += " AND patient_id = ?"
        params.append(patient_id)
    cursor = await db.execute(sql, params)
    seen: set[int] = set()
    ids: list[int] = []
    for r in await cursor.fetchall():
        doc_id = r[0]
        if doc_id not in seen:
            seen.add(doc_id)
            ids.append(doc_id)
    return ids


async def fetch_sources(
    db: aiosqlite.Connection, doc_ids: list[int]
) -> list[dict]:
    """Look up display metadata for the doc ids referenced in a SQL result."""
    if not doc_ids:
        return []
    placeholders = ",".join("?" * len(doc_ids))
    cursor = await db.execute(
        f"""SELECT id, original_filename, doc_type, event_date
            FROM documents WHERE id IN ({placeholders})""",
        doc_ids,
    )
    by_id = {r["id"]: dict(r) for r in await cursor.fetchall()}
    sources: list[dict] = []
    for doc_id in doc_ids:
        row = by_id.get(doc_id)
        if not row:
            continue
        sources.append({
            "id": row["id"],
            "filename": row["original_filename"],
            "doc_type": row["doc_type"],
            "event_date": row["event_date"],
        })
    return sources


async def user_patient_ids(
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
