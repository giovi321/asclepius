"""Document API routes — CRUD, move, reprocess, and failed-queue management.

Sub-routers handle upload, file ops, linking, and AI features.
"""

import logging
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import (
    get_document, list_documents, get_failed_documents,
    get_related_records, get_document_sections, get_document_links,
    update_document_status, update_document_fields,
    delete_document_record, move_child_records,
)
from asclepius.patients.service import check_patient_access

# Sub-routers
from asclepius.documents.upload_routes import router as upload_router
from asclepius.documents.file_routes import router as file_router
from asclepius.documents.link_routes import router as link_router
from asclepius.documents.ai_routes import router as ai_router

logger = logging.getLogger(__name__)

router = APIRouter()

# Include sub-routers (they share the same prefix)
router.include_router(upload_router)
router.include_router(file_router)
router.include_router(link_router)
router.include_router(ai_router)


# ── Pydantic models ──────────────────────────────────────────────

class DocumentUpdate(BaseModel):
    patient_id: int | None = None
    doc_type: str | None = None
    doc_date: str | None = None
    date_issued: str | None = None
    date_visit: str | None = None
    doctor_id: int | None = None
    doctor_name: str | None = None
    facility_id: int | None = None
    facility_name: str | None = None
    specialty_original: str | None = None
    summary_en: str | None = None
    event_id: int | None = None
    notes: str | None = None
    tags: str | None = None
    original_filename: str | None = None
    user_notes: str | None = None


class DocumentMoveRequest(BaseModel):
    patient_id: int


class ReprocessRequest(BaseModel):
    mode: str = "both"  # "ocr", "llm", or "both"
    llm_provider_id: str | None = None  # optional override
    ocr_provider_id: str | None = None  # optional override


# ── Failed documents ─────────────────────────────────────────────

@router.get("/failed")
async def list_failed_docs(
    limit: int = Query(default=50),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List failed documents with error messages for the review queue."""
    return await get_failed_documents(db, limit)


@router.post("/retry-all-failed")
async def retry_all_failed(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Retry all failed documents."""
    import asyncio
    from asclepius.pipeline.processor import reprocess_document

    config = get_config()
    cursor = await db.execute(
        "SELECT id FROM documents WHERE status = 'failed'"
    )
    doc_ids = [row[0] for row in await cursor.fetchall()]

    for doc_id in doc_ids:
        asyncio.create_task(reprocess_document(doc_id, config))

    return {"status": "retrying", "count": len(doc_ids)}


# ── List & Get ───────────────────────────────────────────────────

@router.get("")
async def list_docs(
    patient_id: int | None = None,
    type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    q: str | None = None,
    specialty: str | None = None,
    doctor_id: str | None = Query(default=None, alias="doctor_id"),
    facility_id: str | None = Query(default=None, alias="facility_id"),
    # Legacy parameter aliases (frontend may send "doctor" or "facility")
    doctor: str | None = None,
    facility: str | None = None,
    limit: int = Query(default=50),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Validate patient access
    if patient_id is not None:
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access to this patient")

    # Accept both "doctor_id" and "doctor" parameter names
    effective_doctor = doctor_id or doctor
    effective_facility = facility_id or facility

    return await list_documents(
        db, current_user["id"], patient_id, type, date_from, date_to, status, q, limit, offset,
        specialty=specialty, doctor_id=effective_doctor, facility_id=effective_facility,
    )


@router.get("/{doc_id}")
async def get_doc(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check access
    if doc["patient_id"]:
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
        if not role:
            raise HTTPException(status_code=403, detail="No access")

    # Get related data
    lab_results = await get_related_records(db, "lab_results", doc_id)
    encounters = await get_related_records(db, "encounters", doc_id)
    medications = await get_related_records(db, "medications", doc_id)
    vaccinations = await get_related_records(db, "vaccinations", doc_id)

    # Get linked documents
    links = await get_document_links(db, doc_id)

    # Get document sections (page-level sectioning)
    sections = await get_document_sections(db, doc_id)

    return {
        **doc,
        "lab_results": lab_results,
        "encounters": encounters,
        "medications": medications,
        "vaccinations": vaccinations,
        "links": links,
        "sections": sections,
    }


# ── Update & Delete ──────────────────────────────────────────────

@router.patch("/{doc_id}")
async def update_doc(
    doc_id: int,
    body: DocumentUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    updates = {}
    # Iterate over all fields in the model
    for field_name in body.model_fields_set:
        value = getattr(body, field_name)
        if value is None:
            continue
        if field_name == "patient_id":
            role = await check_patient_access(db, current_user["id"], value)
            if not role:
                raise HTTPException(status_code=403, detail="No access to target patient")
        updates[field_name] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Log corrections before applying updates (compares against raw_extraction)
    from asclepius.documents.corrections import log_corrections
    await log_corrections(db, doc_id, updates)

    await update_document_fields(db, doc_id, updates)
    return await get_document(db, doc_id)


@router.post("/{doc_id}/cancel")
async def cancel_processing(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Cancel processing of a document."""
    from asclepius.pipeline.processor import cancelled_docs

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Add to cancelled set — the pipeline checks this between steps
    cancelled_docs.add(doc_id)

    # Update status in DB
    await update_document_status(db, doc_id, "cancelled")

    return {"status": "cancelled", "document_id": doc_id}


@router.delete("/{doc_id}")
async def delete_doc(
    doc_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a document and its file from disk. Gracefully handles in-progress processing."""
    import asyncio
    from asclepius.pipeline.processor import cancelled_docs

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check access — admins can always delete, others need patient access
    if doc["patient_id"] and current_user.get("role") != "admin":
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
        if not role or role == "viewer":
            raise HTTPException(status_code=403, detail="Insufficient permissions to delete this document")

    # If document is being processed, cancel it first
    if doc["status"] in ("processing", "pending"):
        cancelled_docs.add(doc_id)
        # Give the pipeline a moment to notice the cancellation
        await asyncio.sleep(0.5)

    # Delete file from disk — handle case where file may have already been moved
    config = get_config()
    file_path = Path(config.vault.root_path) / doc["file_path"]
    if file_path.exists():
        file_path.unlink()
    else:
        # Try inbox with original filename
        inbox_path = Path(config.vault.inbox_path) / doc["original_filename"]
        if inbox_path.exists():
            inbox_path.unlink()

    # Clean up cancellation set
    cancelled_docs.discard(doc_id)

    # Delete from DB (CASCADE will handle child tables)
    await delete_document_record(db, doc_id)

    await audit_log(db, current_user["id"], "document.delete", "document", doc_id,
                    {"filename": doc["original_filename"]}, get_client_ip(request))

    return {"status": "deleted", "document_id": doc_id}


# ── Move ─────────────────────────────────────────────────────────

@router.post("/{doc_id}/move")
async def move_doc(
    doc_id: int,
    body: DocumentMoveRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Reassign a document to a different patient, moving the file on disk."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check access to source patient
    if doc["patient_id"]:
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
        if role != "owner":
            raise HTTPException(status_code=403, detail="Only owners can move documents")

    # Check access to target patient
    target_role = await check_patient_access(db, current_user["id"], body.patient_id)
    if not target_role:
        raise HTTPException(status_code=403, detail="No access to target patient")

    config = get_config()
    vault_root = Path(config.vault.root_path)

    # Get target patient slug
    cursor = await db.execute("SELECT slug FROM patients WHERE id = ?", (body.patient_id,))
    target_patient = await cursor.fetchone()
    if not target_patient:
        raise HTTPException(status_code=404, detail="Target patient not found")

    target_slug = target_patient[0]

    # Move file on disk
    old_file = vault_root / doc["file_path"]
    if old_file.exists():
        from asclepius.pipeline.organizer import build_organized_path, move_file as mv

        # Get doctor/facility slug for path
        doctor_slug = None
        facility_slug = None
        if doc.get("doctor_id"):
            cursor = await db.execute("SELECT slug FROM doctors WHERE id = ?", (doc["doctor_id"],))
            row = await cursor.fetchone()
            if row:
                doctor_slug = row[0]
        if doc.get("facility_id"):
            cursor = await db.execute("SELECT slug FROM facilities WHERE id = ?", (doc["facility_id"],))
            row = await cursor.fetchone()
            if row:
                facility_slug = row[0]

        provider_slug = facility_slug or doctor_slug

        # Get event slug if assigned
        event_slug = None
        if doc.get("event_id"):
            cursor = await db.execute("SELECT title FROM medical_events WHERE id = ?", (doc["event_id"],))
            ev_row = await cursor.fetchone()
            if ev_row:
                from asclepius.pipeline.organizer import slugify_event
                event_slug = slugify_event(ev_row[0])

        # Generate summary slug for filename
        summary_slug = None
        if doc.get("summary_en"):
            _summary = doc["summary_en"][:60].lower()
            _summary = re.sub(r"[^a-z0-9]+", "-", _summary)
            _summary = re.sub(r"-+", "-", _summary).strip("-")
            summary_slug = _summary

        best_date = doc.get("date_visit") or doc.get("date_issued") or doc.get("doc_date") or doc.get("date_received")
        new_relative = build_organized_path(
            config, target_slug, best_date, provider_slug,
            doc.get("doc_type"), doc["original_filename"],
            event_slug=event_slug,
            summary_slug=summary_slug,
        )
        new_dest = vault_root / new_relative
        new_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_file), str(new_dest))
        new_path = str(new_dest.relative_to(vault_root))
    else:
        new_path = doc["file_path"]

    # Update DB
    await update_document_fields(db, doc_id, {"patient_id": body.patient_id, "file_path": new_path})

    # Update child records
    await move_child_records(db, doc_id, body.patient_id)
    await db.commit()
    return await get_document(db, doc_id)


# ── Reprocess ────────────────────────────────────────────────────

@router.post("/{doc_id}/reprocess")
async def reprocess_doc(
    doc_id: int,
    body: ReprocessRequest = ReprocessRequest(),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Mark as pending immediately so the UI reflects the change
    await update_document_status(db, doc_id, "pending")

    # Run reprocessing in background
    import asyncio
    from asclepius.pipeline.processor import reprocess_document

    config = get_config()
    asyncio.create_task(reprocess_document(
        doc_id, config, mode=body.mode,
        llm_provider_id=body.llm_provider_id,
        ocr_provider_id=body.ocr_provider_id,
    ))
    return {"status": "reprocessing", "document_id": doc_id}

