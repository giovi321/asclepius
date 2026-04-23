"""Medical events API routes."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.util.dates import BEST_DATE_SQL, best_date

logger = logging.getLogger(__name__)
router = APIRouter()


EVENT_TYPES = [
    "symptom", "diagnosis", "hospitalization", "surgery", "treatment",
    "follow_up", "emergency", "pregnancy", "chronic_condition",
    "injury", "screening", "other",
]


class EventCreate(BaseModel):
    patient_id: int
    title: str
    event_type: str = "other"
    description: str | None = None
    date_start: str | None = None
    date_end: str | None = None
    is_ongoing: bool = False
    severity: str | None = None
    diagnosis_text: str | None = None
    icd10_code: str | None = None
    specialty_text: str | None = None
    notes: str | None = None
    color: str | None = None


class EventUpdate(BaseModel):
    title: str | None = None
    event_type: str | None = None
    description: str | None = None
    date_start: str | None = None
    date_end: str | None = None
    is_ongoing: bool | None = None
    severity: str | None = None
    diagnosis_text: str | None = None
    icd10_code: str | None = None
    specialty_text: str | None = None
    notes: str | None = None
    color: str | None = None


class EventLinkRequest(BaseModel):
    document_id: int
    relevance: str = "primary"


@router.get("")
async def list_events(
    patient_id: int | None = None,
    event_type: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List medical events, optionally filtered by patient and type."""
    conditions = []
    params: list = []

    if patient_id:
        conditions.append("e.patient_id = ?")
        params.append(patient_id)
    if event_type:
        conditions.append("e.event_type = ?")
        params.append(event_type)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    cursor = await db.execute(
        f"""SELECT e.*, p.display_name as patient_name,
                   (SELECT COUNT(*) FROM document_event_links del WHERE del.event_id = e.id) as document_count
            FROM medical_events e
            LEFT JOIN patients p ON e.patient_id = p.id
            {where}
            ORDER BY e.date_start DESC NULLS LAST""",
        params,
    )
    return [dict(r) for r in await cursor.fetchall()]


@router.get("/{event_id}")
async def get_event(
    event_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get a single event with its linked documents."""
    cursor = await db.execute(
        """SELECT e.*, p.display_name as patient_name
           FROM medical_events e
           LEFT JOIN patients p ON e.patient_id = p.id
           WHERE e.id = ?""",
        (event_id,),
    )
    event = await cursor.fetchone()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    event = dict(event)

    # Get linked documents
    cursor = await db.execute(
        f"""SELECT del.id as link_id, del.relevance, del.auto_linked,
                  d.id as document_id, d.original_filename, d.doc_type,
                  {BEST_DATE_SQL} as event_date,
                  doc.name as doctor_name, f.name as facility_name, d.summary_en
           FROM document_event_links del
           JOIN documents d ON del.document_id = d.id
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           WHERE del.event_id = ?
           ORDER BY event_date DESC""",
        (event_id,),
    )
    event["documents"] = [dict(r) for r in await cursor.fetchall()]

    return event


@router.post("", status_code=201)
async def create_event(
    body: EventCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        """INSERT INTO medical_events
           (patient_id, title, event_type, description, date_start, date_end,
            is_ongoing, severity, diagnosis_text, icd10_code, specialty_text,
            notes, color)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.patient_id, body.title, body.event_type, body.description,
         body.date_start, body.date_end, body.is_ongoing, body.severity,
         body.diagnosis_text, body.icd10_code, body.specialty_text,
         body.notes, body.color),
    )
    await db.commit()
    return {"id": cursor.lastrowid, "title": body.title}


@router.patch("/{event_id}")
async def update_event(
    event_id: int,
    body: EventUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    updates = {}
    for field in body.model_fields_set:
        value = getattr(body, field)
        if value is not None:
            updates[field] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [event_id]
    await db.execute(
        f"UPDATE medical_events SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        values,
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{event_id}")
async def delete_event(
    event_id: int,
    delete_documents: bool = False,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    if delete_documents:
        # Delete all linked documents from disk and DB
        cursor = await db.execute(
            "SELECT id, file_path FROM documents WHERE event_id = ?", (event_id,)
        )
        docs = await cursor.fetchall()
        import os
        for doc in docs:
            if doc["file_path"]:
                try:
                    os.remove(doc["file_path"])
                except OSError:
                    pass
            await db.execute("DELETE FROM documents WHERE id = ?", (doc["id"],))

    # Remove links
    await db.execute("DELETE FROM document_event_links WHERE event_id = ?", (event_id,))
    # Clear event_id from remaining documents
    await db.execute("UPDATE documents SET event_id = NULL WHERE event_id = ?", (event_id,))
    await db.execute("DELETE FROM medical_events WHERE id = ?", (event_id,))
    await db.commit()
    return {"ok": True}


# --- Document-Event linking ---

@router.post("/{event_id}/link")
async def link_document_to_event(
    event_id: int,
    body: EventLinkRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Link a document to a medical event."""
    try:
        await db.execute(
            """INSERT OR IGNORE INTO document_event_links (document_id, event_id, relevance, auto_linked)
               VALUES (?, ?, ?, 0)""",
            (body.document_id, event_id, body.relevance),
        )
        # Also set as primary event on the document if not set
        await db.execute(
            "UPDATE documents SET event_id = ? WHERE id = ? AND event_id IS NULL",
            (event_id, body.document_id),
        )
        await db.commit()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{event_id}/link/{document_id}")
async def unlink_document_from_event(
    event_id: int,
    document_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute(
        "DELETE FROM document_event_links WHERE event_id = ? AND document_id = ?",
        (event_id, document_id),
    )
    # Clear primary event if it was this one
    await db.execute(
        "UPDATE documents SET event_id = NULL WHERE id = ? AND event_id = ?",
        (document_id, event_id),
    )
    await db.commit()
    return {"ok": True}


# --- LLM auto-tagging ---

@router.post("/suggest-for-document/{doc_id}")
async def suggest_events_for_document(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Use LLM to suggest which medical event a document belongs to, or suggest creating a new one."""
    from asclepius.documents.service import get_document
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if not doc.get("patient_id"):
        raise HTTPException(status_code=400, detail="Document has no patient assigned")

    # Get existing events for this patient
    cursor = await db.execute(
        """SELECT id, title, event_type, date_start, date_end, is_ongoing, diagnosis_text, description
           FROM medical_events WHERE patient_id = ? ORDER BY date_start DESC""",
        (doc["patient_id"],),
    )
    existing_events = [dict(r) for r in await cursor.fetchall()]

    config = get_config()
    from asclepius.pipeline.provider_factory import _build_general_llm_provider
    llm = _build_general_llm_provider(config)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail="General LLM is not configured. Set it under Settings → Document Analysis → General.",
        )

    events_text = "\n".join(
        f"- ID {e['id']}: \"{e['title']}\" ({e['event_type']}, {e.get('date_start', '?')} to {e.get('date_end', 'ongoing' if e.get('is_ongoing') else '?')})"
        + (f" — {e.get('diagnosis_text', '')}" if e.get("diagnosis_text") else "")
        for e in existing_events
    ) or "No events exist yet."

    prompt = f"""Given this medical document, determine which medical event it belongs to.

Document info:
- Type: {doc.get('doc_type', 'unknown')}
- Date: {best_date(doc) or 'unknown'}
- Doctor: {doc.get('doctor_name', 'unknown')}
- Facility: {doc.get('facility_name', 'unknown')}
- Summary: {doc.get('summary_en', 'N/A')}

Existing medical events for this patient:
{events_text}

Respond in JSON:
{{
  "existing_event_id": number or null (ID of matching existing event, null if none match),
  "confidence": "high" or "medium" or "low",
  "reason": "why this document matches that event",
  "new_event_suggestion": {{
    "title": "suggested title if no existing event matches",
    "event_type": "one of: symptom, diagnosis, hospitalization, surgery, treatment, follow_up, emergency, pregnancy, chronic_condition, injury, screening, other",
    "description": "brief description",
    "date_start": "YYYY-MM-DD or null"
  }} or null
}}"""

    try:
        if hasattr(llm, '_generate'):
            response = await llm._generate(prompt)
            result = llm._parse_json(response)
        else:
            result = {"existing_event_id": None, "new_event_suggestion": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

    # Enrich with event details if matching
    if result.get("existing_event_id"):
        matched = next((e for e in existing_events if e["id"] == result["existing_event_id"]), None)
        if matched:
            result["matched_event"] = matched

    return result
