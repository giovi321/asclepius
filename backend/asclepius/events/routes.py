"""Medical events API routes."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.authz import require_patient_access
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access
from asclepius.util.dates import BEST_DATE_SQL, best_date

logger = logging.getLogger(__name__)
router = APIRouter()


async def _event_with_access(
    db: aiosqlite.Connection,
    event_id: int,
    current_user: dict,
    *,
    require_delete: bool = False,
) -> dict:
    """Load an event and enforce access, or raise 404/403.

    Admins see everything. Non-admins need an explicit ``user_patient_access``
    grant on the event's patient. ``require_delete`` additionally rejects the
    viewer role, mirroring the ``/api/documents`` DELETE rule.
    """
    cursor = await db.execute("SELECT * FROM medical_events WHERE id = ?", (event_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    event = dict(row)
    # Access goes through the canonical authz helper. ``require_delete`` maps
    # to write access (viewers are rejected); ordinary access allows any grant.
    await require_patient_access(
        db, event["patient_id"], current_user, write=require_delete
    )
    return event


async def _require_patient_access(
    db: aiosqlite.Connection, patient_id: int, current_user: dict
) -> None:
    """Enforce that the caller may act on ``patient_id`` (admin or any grant)."""
    await require_patient_access(db, patient_id, current_user)


async def _require_document_in_event_patient(
    db: aiosqlite.Connection, document_id: int, event: dict
) -> None:
    """Ensure ``document_id`` belongs to the same patient as ``event``.

    Linking/unlinking is already gated on access to the event; this stops a
    user from attaching (or clearing the primary-event pointer on) a document
    that lives on a different patient's chart — without it, a linked document's
    metadata leaks back through ``GET /events/{id}`` and a cascade delete could
    remove another patient's file.
    """
    cursor = await db.execute("SELECT patient_id FROM documents WHERE id = ?", (document_id,))
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if row["patient_id"] != event["patient_id"]:
        raise HTTPException(status_code=403, detail="Document belongs to a different patient")


EVENT_TYPES = [
    "symptom",
    "diagnosis",
    "hospitalization",
    "surgery",
    "treatment",
    "follow_up",
    "emergency",
    "pregnancy",
    "chronic_condition",
    "injury",
    "screening",
    "other",
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


class MedicalEvent(BaseModel):
    id: int
    patient_id: int
    title: str
    event_type: str
    description: str | None = None
    date_start: str | None = None
    date_end: str | None = None
    is_ongoing: bool = False
    severity: str | None = None
    norm_diagnosis_id: int | None = None
    diagnosis_text: str | None = None
    icd10_code: str | None = None
    norm_specialty_id: int | None = None
    specialty_text: str | None = None
    notes: str | None = None
    color: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    patient_name: str | None = None
    document_count: int = 0


class LinkedDocument(BaseModel):
    link_id: int
    relevance: str | None = None
    auto_linked: bool = False
    document_id: int
    original_filename: str | None = None
    doc_type: str | None = None
    event_date: str | None = None
    doctor_name: str | None = None
    facility_name: str | None = None
    summary_en: str | None = None


class MedicalEventDetail(MedicalEvent):
    documents: list[LinkedDocument] = []


class EventCreateResponse(BaseModel):
    id: int
    title: str


class EventOkResponse(BaseModel):
    ok: bool


class NewEventSuggestion(BaseModel):
    title: str | None = None
    event_type: str | None = None
    description: str | None = None
    date_start: str | None = None


class EventSuggestion(BaseModel):
    existing_event_id: int | None = None
    confidence: str | None = None
    reason: str | None = None
    new_event_suggestion: NewEventSuggestion | None = None
    matched_event: MedicalEvent | None = None


@router.get("", response_model=list[MedicalEvent])
async def list_events(
    patient_id: int | None = None,
    event_type: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List medical events, optionally filtered by patient and type.

    Results are scoped to the caller's accessible patients: admins see all,
    non-admins see only patients they hold a ``user_patient_access`` grant for.
    """
    conditions = []
    params: list = []

    if patient_id:
        if current_user.get("role") != "admin":
            role = await check_patient_access(db, current_user["id"], patient_id)
            if not role:
                raise HTTPException(status_code=403, detail="No access")
        conditions.append("e.patient_id = ?")
        params.append(patient_id)
    elif current_user.get("role") != "admin":
        conditions.append(
            "e.patient_id IN (SELECT patient_id FROM user_patient_access WHERE user_id = ?)"
        )
        params.append(current_user["id"])

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


@router.get("/{event_id}", response_model=MedicalEventDetail)
async def get_event(
    event_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get a single event with its linked documents."""
    await _event_with_access(db, event_id, current_user)

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


@router.post("", status_code=201, response_model=EventCreateResponse)
async def create_event(
    body: EventCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    await _require_patient_access(db, body.patient_id, current_user)
    cursor = await db.execute(
        """INSERT INTO medical_events
           (patient_id, title, event_type, description, date_start, date_end,
            is_ongoing, severity, diagnosis_text, icd10_code, specialty_text,
            notes, color)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            body.patient_id,
            body.title,
            body.event_type,
            body.description,
            body.date_start,
            body.date_end,
            body.is_ongoing,
            body.severity,
            body.diagnosis_text,
            body.icd10_code,
            body.specialty_text,
            body.notes,
            body.color,
        ),
    )
    await db.commit()
    return {"id": cursor.lastrowid, "title": body.title}


@router.patch("/{event_id}", response_model=EventOkResponse)
async def update_event(
    event_id: int,
    body: EventUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    await _event_with_access(db, event_id, current_user)
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


@router.delete("/{event_id}", response_model=EventOkResponse)
async def delete_event(
    event_id: int,
    delete_documents: bool = False,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    await _event_with_access(db, event_id, current_user, require_delete=True)
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


@router.post("/{event_id}/link", response_model=EventOkResponse)
async def link_document_to_event(
    event_id: int,
    body: EventLinkRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Link a document to a medical event."""
    event = await _event_with_access(db, event_id, current_user)
    await _require_document_in_event_patient(db, body.document_id, event)
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


@router.delete("/{event_id}/link/{document_id}", response_model=EventOkResponse)
async def unlink_document_from_event(
    event_id: int,
    document_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    event = await _event_with_access(db, event_id, current_user)
    await _require_document_in_event_patient(db, document_id, event)
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


@router.post("/suggest-for-document/{doc_id}", response_model=EventSuggestion)
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

    await _require_patient_access(db, doc["patient_id"], current_user)

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

    events_text = (
        "\n".join(
            f"- ID {e['id']}: \"{e['title']}\" ({e['event_type']}, {e.get('date_start', '?')} to {e.get('date_end', 'ongoing' if e.get('is_ongoing') else '?')})"
            + (f" — {e.get('diagnosis_text', '')}" if e.get("diagnosis_text") else "")
            for e in existing_events
        )
        or "No events exist yet."
    )

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
        if hasattr(llm, "_generate"):
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
