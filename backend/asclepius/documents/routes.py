"""Document API routes."""

import json
import logging
import os
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import get_document, list_documents
from asclepius.patients.service import check_patient_access

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    patient_id: int | None = Query(default=None),
    event_id: int | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Upload a document file to the inbox for processing."""
    config = get_config()
    inbox = Path(config.vault.inbox_path)
    inbox.mkdir(parents=True, exist_ok=True)

    # Sanitize filename
    original_name = file.filename or "upload"
    safe_name = "".join(c if c.isalnum() or c in ".-_ " else "_" for c in original_name)

    dest = inbox / safe_name
    # Handle conflicts
    counter = 1
    while dest.exists():
        stem = Path(safe_name).stem
        suffix = Path(safe_name).suffix
        dest = inbox / f"{stem}_{counter}{suffix}"
        counter += 1

    # Save file
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Write hint files so the pipeline can pick them up even if it wins the race
    if patient_id:
        Path(str(dest) + ".patient_hint").write_text(str(patient_id))
    if event_id:
        Path(str(dest) + ".event_hint").write_text(str(event_id))

    # Create DB record immediately so the document is visible in the list.
    # The pipeline will find this record by file_hash and reuse it (not duplicate).
    import os
    import aiosqlite
    from asclepius.documents.service import compute_file_hash
    try:
        file_hash = compute_file_hash(str(dest))
        file_size = os.path.getsize(str(dest))
        async with aiosqlite.connect(config.database.path) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute("PRAGMA foreign_keys=ON")
            # Use the dest.name (sanitized) as both file_path and original_filename
            # so the pipeline can match by hash
            await db.execute(
                """INSERT INTO documents
                   (file_path, original_filename, file_hash, file_size, patient_id, event_id, date_received, status)
                   VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'pending')""",
                (f"inbox/{dest.name}", dest.name, file_hash, file_size, patient_id, event_id),
            )
            await db.commit()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Upload DB record failed (pipeline will create): %s", e)

    # Check if we should suggest batch scheduling
    suggestion = None
    suggestion_message = None
    queue_size = 0
    try:
        async with aiosqlite.connect(config.database.path) as db2:
            cursor = await db2.execute(
                "SELECT COUNT(*) FROM documents WHERE status IN ('pending', 'processing')"
            )
            row = await cursor.fetchone()
            queue_size = row[0] if row else 0
        if file_size > 10 * 1024 * 1024 or queue_size > 5:
            suggestion = "batch_schedule"
            suggestion_message = "Large upload detected. Consider scheduling for later processing."
    except Exception:
        pass

    result = {"filename": dest.name, "status": "pending", "message": "File uploaded and queued for processing"}
    if suggestion:
        result["suggestion"] = suggestion
        result["message"] = suggestion_message
        result["queue_size"] = queue_size
    return result


class BatchScheduleRequest(BaseModel):
    document_ids: list[int]  # list of document IDs to schedule
    process_at: str | None = None  # ISO datetime, null = process now


@router.post("/schedule-batch")
async def schedule_batch(
    body: BatchScheduleRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Schedule a batch of documents for later processing."""
    if not body.document_ids:
        raise HTTPException(status_code=400, detail="No document IDs provided")

    count = 0
    for doc_id in body.document_ids:
        doc = await get_document(db, doc_id)
        if not doc:
            continue
        if body.process_at:
            await db.execute(
                "UPDATE documents SET status = 'scheduled', process_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (body.process_at, doc_id),
            )
        else:
            await db.execute(
                "UPDATE documents SET status = 'pending', process_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
        count += 1

    await db.commit()
    return {"scheduled": count, "process_at": body.process_at}


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


class RenameRequest(BaseModel):
    filename: str


class DocumentMoveRequest(BaseModel):
    patient_id: int


class DocumentLinkRequest(BaseModel):
    target_document_id: int
    link_type: str  # 'invoice_for', 'report_for', 'imaging_for', 'follow_up', 'related'


@router.get("/failed")
async def list_failed_docs(
    limit: int = Query(default=50),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List failed documents with error messages for the review queue."""
    cursor = await db.execute(
        """SELECT d.id, d.original_filename, d.file_path, d.status, d.error_message,
                  d.retry_count, d.created_at, d.updated_at,
                  p.display_name as patient_name
           FROM documents d
           LEFT JOIN patients p ON d.patient_id = p.id
           WHERE d.status IN ('failed', 'needs_review')
           ORDER BY d.updated_at DESC
           LIMIT ?""",
        (limit,),
    )
    return [dict(r) for r in await cursor.fetchall()]


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


@router.get("")
async def list_docs(
    patient_id: int | None = None,
    type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    q: str | None = None,
    specialty: str | None = None,
    doctor_id: int | None = None,
    facility_id: int | None = None,
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

    return await list_documents(
        db, current_user["id"], patient_id, type, date_from, date_to, status, q, limit, offset,
        specialty=specialty, doctor_id=doctor_id, facility_id=facility_id,
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
    lab_results = await _get_related(db, "lab_results", doc_id)
    encounters = await _get_related(db, "encounters", doc_id)
    medications = await _get_related(db, "medications", doc_id)
    vaccinations = await _get_related(db, "vaccinations", doc_id)

    # Get linked documents
    links = await _get_document_links(db, doc_id)

    # Get document sections (page-level sectioning)
    sections_cursor = await db.execute(
        """SELECT id, section_index, page_start, page_end, section_type, summary_en
           FROM document_sections WHERE document_id = ? ORDER BY section_index""",
        (doc_id,),
    )
    sections = [dict(r) for r in await sections_cursor.fetchall()]

    return {
        **doc,
        "lab_results": lab_results,
        "encounters": encounters,
        "medications": medications,
        "vaccinations": vaccinations,
        "links": links,
        "sections": sections,
    }


@router.get("/{doc_id}/file")
async def serve_file(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc["patient_id"]:
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
        if not role:
            raise HTTPException(status_code=403, detail="No access")

    config = get_config()
    vault_root = Path(config.vault.root_path)
    file_path = vault_root / doc["file_path"]

    # Primary path check
    if not file_path.exists():
        # Try absolute path (file_path might already be absolute)
        abs_path = Path(doc["file_path"])
        if abs_path.is_absolute() and abs_path.exists():
            file_path = abs_path
        else:
            # Fallback: look in inbox with original_filename
            inbox_path = Path(config.vault.inbox_path) / doc["original_filename"]
            if inbox_path.exists():
                file_path = inbox_path
            else:
                # Last resort: search vault root for the original filename
                for candidate in vault_root.rglob(doc["original_filename"]):
                    file_path = candidate
                    break
                else:
                    raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        filename=doc["original_filename"],
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


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

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [doc_id]
    await db.execute(
        f"UPDATE documents SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        values,
    )
    await db.commit()
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
    await db.execute(
        "UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (doc_id,),
    )
    await db.commit()

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
    await db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    await db.commit()

    await audit_log(db, current_user["id"], "document.delete", "document", doc_id,
                    {"filename": doc["original_filename"]}, get_client_ip(request))

    return {"status": "deleted", "document_id": doc_id}


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

        new_relative = build_organized_path(
            config, target_slug, doc.get("doc_date"), provider_slug,
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
    await db.execute(
        """UPDATE documents SET patient_id = ?, file_path = ?,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
        (body.patient_id, new_path, doc_id),
    )

    # Update child records
    for table in ["lab_results", "encounters", "medications", "vaccinations"]:
        await db.execute(
            f"UPDATE {table} SET patient_id = ? WHERE document_id = ?",
            (body.patient_id, doc_id),
        )

    await db.commit()
    return await get_document(db, doc_id)


@router.post("/{doc_id}/link")
async def link_documents(
    doc_id: int,
    body: DocumentLinkRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Link two documents together."""
    valid_types = {"invoice_for", "report_for", "imaging_for", "follow_up", "related"}
    if body.link_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid link_type. Must be one of: {valid_types}")

    if doc_id == body.target_document_id:
        raise HTTPException(status_code=400, detail="Cannot link a document to itself")

    # Verify both documents exist
    source = await get_document(db, doc_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source document not found")
    target = await get_document(db, body.target_document_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target document not found")

    # Check for existing link in either direction
    existing = await db.execute(
        """SELECT id FROM document_links
           WHERE (source_document_id = ? AND target_document_id = ?)
              OR (source_document_id = ? AND target_document_id = ?)""",
        (doc_id, body.target_document_id, body.target_document_id, doc_id),
    )
    if await existing.fetchone():
        raise HTTPException(status_code=409, detail="These documents are already linked")

    try:
        cursor = await db.execute(
            """INSERT INTO document_links (source_document_id, target_document_id, link_type)
               VALUES (?, ?, ?)""",
            (doc_id, body.target_document_id, body.link_type),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "source_document_id": doc_id,
                "target_document_id": body.target_document_id, "link_type": body.link_type}
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="Link already exists")


@router.get("/{doc_id}/links")
async def get_links(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get all linked documents for a document."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return await _get_document_links(db, doc_id)


@router.delete("/{doc_id}/links/{link_id}")
async def delete_link(
    doc_id: int,
    link_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Remove a document link."""
    cursor = await db.execute(
        "SELECT id FROM document_links WHERE id = ? AND (source_document_id = ? OR target_document_id = ?)",
        (link_id, doc_id, doc_id),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Link not found")

    await db.execute("DELETE FROM document_links WHERE id = ?", (link_id,))
    await db.commit()
    return {"status": "deleted", "link_id": link_id}


@router.post("/{doc_id}/reprocess")
async def reprocess_doc(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Run reprocessing in background
    import asyncio
    from asclepius.pipeline.processor import reprocess_document

    config = get_config()
    asyncio.create_task(reprocess_document(doc_id, config))
    return {"status": "reprocessing", "document_id": doc_id}


class DocumentEditRequest(BaseModel):
    instruction: str


@router.post("/{doc_id}/suggest-links")
async def suggest_document_links(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Use LLM to suggest related documents for linking."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if not doc.get("patient_id"):
        raise HTTPException(status_code=400, detail="Document has no patient assigned — cannot suggest links")

    # Check access
    role = await check_patient_access(db, current_user["id"], doc["patient_id"])
    if not role:
        raise HTTPException(status_code=403, detail="No access")

    # Get all other documents for the same patient
    cursor = await db.execute(
        """SELECT d.id, d.doc_type, d.doc_date, d.summary_en, d.original_filename,
                  doc.name as doctor_name, f.name as facility_name
           FROM documents d
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           WHERE d.patient_id = ? AND d.id != ? AND d.status = 'done'
           ORDER BY d.doc_date DESC
           LIMIT 50""",
        (doc["patient_id"], doc_id),
    )
    rows = await cursor.fetchall()
    other_docs = [dict(r) for r in rows]

    if not other_docs:
        return {"suggestions": []}

    # Format other documents for the prompt
    other_docs_text = "\n".join(
        f"- ID: {d['id']}, Type: {d.get('doc_type', 'unknown')}, Date: {d.get('doc_date', 'unknown')}, "
        f"Doctor: {d.get('doctor_name', 'unknown')}, Facility: {d.get('facility_name', 'unknown')}, "
        f"Summary: {d.get('summary_en', 'N/A')}"
        for d in other_docs
    )

    from asclepius.llm.prompts import LINK_SUGGESTION_PROMPT
    from asclepius.pipeline.processor import get_llm_provider

    config = get_config()
    llm = get_llm_provider(config)

    prompt = LINK_SUGGESTION_PROMPT.format(
        doc_id=doc_id,
        doc_type=doc.get("doc_type", "unknown"),
        doc_date=doc.get("doc_date", "unknown"),
        doctor_name=doc.get("doctor_name", "unknown"),
        facility_name=doc.get("facility_name", "unknown"),
        summary=doc.get("summary_en", "N/A"),
        other_documents=other_docs_text,
    )

    try:
        if hasattr(llm, "_generate"):
            response_text = await llm._generate(prompt)
            result = llm._parse_json(response_text)
        else:
            raise HTTPException(status_code=500, detail="LLM provider does not support direct generation")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

    suggestions = result.get("suggestions", [])

    # Validate that suggested document IDs actually exist in the other_docs list
    valid_ids = {d["id"] for d in other_docs}
    valid_link_types = {"invoice_for", "report_for", "imaging_for", "follow_up", "related"}
    validated = [
        s for s in suggestions
        if s.get("document_id") in valid_ids and s.get("link_type") in valid_link_types
    ]

    # Enrich each suggestion with document info
    docs_by_id = {d["id"]: d for d in other_docs}
    for s in validated:
        info = docs_by_id.get(s["document_id"], {})
        s["filename"] = info.get("original_filename")
        s["doc_type"] = info.get("doc_type")
        s["doc_date"] = info.get("doc_date")
        s["summary_en"] = info.get("summary_en")
        s["doctor_name"] = info.get("doctor_name")
        s["facility_name"] = info.get("facility_name")

    return {"suggestions": validated}


@router.post("/{doc_id}/edit-with-ai")
async def edit_document_with_ai(
    doc_id: int,
    body: DocumentEditRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Edit document metadata using natural language instruction via LLM.

    Uses a compact prompt to minimize token usage. For simple field changes,
    the LLM returns only the changed fields as JSON.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    config = get_config()
    from asclepius.pipeline.processor import get_llm_provider
    from asclepius.pipeline.extractor import build_extraction_context, extract_and_store
    import json as _json
    import asyncio as _asyncio

    llm = get_llm_provider(config)
    context = await build_extraction_context(db)

    # Build a compact current data summary (only non-null fields)
    current_data = {k: v for k, v in {
        "patient_name": doc.get("patient_name"),
        "doc_type": doc.get("doc_type"),
        "doc_date": doc.get("doc_date"),
        "date_issued": doc.get("date_issued"),
        "date_visit": doc.get("date_visit"),
        "doctor_name": doc.get("doctor_name"),
        "facility_name": doc.get("facility_name"),
        "specialty_original": doc.get("specialty_original"),
        "summary_en": doc.get("summary_en"),
    }.items() if v}

    # Compact prompt — no huge JSON schema, just the fields
    prompt = f"""You are editing a medical document's metadata. The user wants to make changes.

Current data: {_json.dumps(current_data)}

Known patients: {_json.dumps([p.get("name","") for p in context.get("patient_list", [])[:20]])}

User instruction: "{body.instruction}"

Return ONLY a JSON object with the fields that should change. Use these field names:
- patient_name, doc_type, doc_date (YYYY-MM-DD), date_issued, date_visit
- doctor_name (string, e.g. "Dr. Bianchi")
- facility_name (string, e.g. "Ospedale Civico")
- specialty_original
- summary_en, summary_original

Only include fields the user mentioned. JSON only, no explanation."""

    # Call LLM with retry for rate limits
    for attempt in range(3):
        try:
            if hasattr(llm, '_generate'):
                response_text = await llm._generate(prompt)
                changes = llm._parse_json(response_text)
            else:
                raise HTTPException(status_code=500, detail="LLM provider does not support direct generation")
            break
        except Exception as e:
            if "429" in str(e) or "rate_limit" in str(e):
                wait = 30 * (attempt + 1)
                await _asyncio.sleep(wait)
                if attempt == 2:
                    raise HTTPException(status_code=429, detail="Rate limited — please try again in a minute")
            else:
                raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

    if "error" in changes:
        raise HTTPException(status_code=500, detail=changes.get("error"))

    # Apply changes directly to the documents table
    updates = {}
    if "doc_type" in changes:
        updates["doc_type"] = changes["doc_type"]
    if "doc_date" in changes:
        updates["doc_date"] = changes["doc_date"]
    if "date_issued" in changes:
        updates["date_issued"] = changes["date_issued"]
    if "date_visit" in changes:
        updates["date_visit"] = changes["date_visit"]
    if "summary_en" in changes:
        updates["summary_en"] = changes["summary_en"]
    if "summary_original" in changes:
        updates["summary_original"] = changes["summary_original"]
    if "specialty_original" in changes.get("specialty", changes):
        updates["specialty_original"] = changes.get("specialty", {}).get("original", changes.get("specialty_original"))

    # Handle patient name change
    if "patient_name" in changes:
        from asclepius.pipeline.extractor import _match_patient
        patient_id = await _match_patient(db, changes["patient_name"])
        if patient_id:
            updates["patient_id"] = patient_id

    # Handle doctor change — accept both {"doctor": {"name": "X"}} and {"doctor_name": "X"}
    doctor_data = changes.get("doctor")
    doctor_name_str = changes.get("doctor_name")
    if isinstance(doctor_data, str):
        doctor_name_str = doctor_data
        doctor_data = None
    if doctor_data and isinstance(doctor_data, dict) and doctor_data.get("name"):
        from asclepius.pipeline.extractor import _upsert_doctor
        doctor_id = await _upsert_doctor(db, doctor_data)
        updates["doctor_id"] = doctor_id
        updates["doctor_name"] = doctor_data["name"]
    elif doctor_name_str:
        from asclepius.pipeline.extractor import _upsert_doctor
        doctor_id = await _upsert_doctor(db, {"name": doctor_name_str})
        updates["doctor_id"] = doctor_id
        updates["doctor_name"] = doctor_name_str

    # Handle facility change — accept both {"facility": {"name": "X"}} and {"facility_name": "X"}
    facility_data = changes.get("facility")
    facility_name_str = changes.get("facility_name")
    if isinstance(facility_data, str):
        facility_name_str = facility_data
        facility_data = None
    if facility_data and isinstance(facility_data, dict) and facility_data.get("name"):
        from asclepius.pipeline.extractor import _upsert_facility
        facility_id = await _upsert_facility(db, facility_data)
        updates["facility_id"] = facility_id
        updates["facility_name"] = facility_data["name"]
    elif facility_name_str:
        from asclepius.pipeline.extractor import _upsert_facility
        facility_id = await _upsert_facility(db, {"name": facility_name_str})
        updates["facility_id"] = facility_id
        updates["facility_name"] = facility_name_str

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [doc_id]
        await db.execute(
            f"UPDATE documents SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values,
        )
        await db.commit()

    return {"status": "updated", "document_id": doc_id, "changes": changes}


_VALID_RELATED_TABLES = {"lab_results", "encounters", "medications", "vaccinations"}

async def _get_related(db: aiosqlite.Connection, table: str, doc_id: int) -> list[dict]:
    """Get related records from a child table."""
    if table not in _VALID_RELATED_TABLES:
        raise ValueError(f"Invalid related table: {table}")
    cursor = await db.execute(f"SELECT * FROM {table} WHERE document_id = ?", (doc_id,))
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


class RotateRequest(BaseModel):
    degrees: int = 90  # 90, 180, 270
    pages: list[int] | None = None  # None = all pages, or list of 1-based page numbers


@router.post("/{doc_id}/rotate")
async def rotate_document(
    doc_id: int,
    body: RotateRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Permanently rotate pages of a PDF document.

    - degrees: rotation angle (90, 180, 270)
    - pages: list of 1-based page numbers to rotate, or null/empty for all pages
    """
    if body.degrees not in (90, 180, 270):
        raise HTTPException(status_code=400, detail="Degrees must be 90, 180, or 270")

    config = get_config()
    cursor = await db.execute(
        "SELECT file_path, patient_id FROM documents WHERE id = ?", (doc_id,)
    )
    doc = await cursor.fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(config.vault.root_path) / doc[0]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    if file_path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Rotation is only supported for PDF files")

    import fitz
    try:
        pdf = fitz.open(str(file_path))
        total_pages = len(pdf)

        if body.pages:
            # Validate page numbers
            for p in body.pages:
                if p < 1 or p > total_pages:
                    pdf.close()
                    raise HTTPException(
                        status_code=400,
                        detail=f"Page {p} is out of range (document has {total_pages} pages)"
                    )
            target_pages = [p - 1 for p in body.pages]  # Convert to 0-based
        else:
            target_pages = list(range(total_pages))

        for page_idx in target_pages:
            page = pdf[page_idx]
            page.set_rotation((page.rotation + body.degrees) % 360)

        # Full rewrite (not incremental) to ensure rotation is properly persisted
        # Save to temp file then replace, to avoid corruption on failure
        import tempfile, shutil
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf", dir=str(file_path.parent))
        try:
            import os
            os.close(tmp_fd)
            pdf.save(tmp_path, garbage=3, deflate=True)
            pdf.close()
            shutil.move(tmp_path, str(file_path))
        except Exception:
            pdf.close()
            if Path(tmp_path).exists():
                Path(tmp_path).unlink()
            raise

        rotated_desc = (
            f"pages {body.pages}" if body.pages
            else f"all {total_pages} pages"
        )
        return {
            "status": "rotated",
            "document_id": doc_id,
            "degrees": body.degrees,
            "pages_rotated": len(target_pages),
            "total_pages": total_pages,
            "description": f"Rotated {rotated_desc} by {body.degrees} degrees",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rotate PDF: {str(e)}")


@router.post("/{doc_id}/rename")
async def rename_document(
    doc_id: int,
    body: RenameRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Rename a document's file on disk and in the database."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    new_name = body.filename.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    # Ensure the extension is preserved
    old_ext = Path(doc["original_filename"]).suffix.lower()
    new_ext = Path(new_name).suffix.lower()
    if not new_ext:
        new_name += old_ext
    elif new_ext != old_ext:
        raise HTTPException(status_code=400, detail=f"Cannot change file extension from {old_ext} to {new_ext}")

    # Sanitize filename
    stem = Path(new_name).stem
    ext = Path(new_name).suffix
    stem = re.sub(r'[^\w\-. ]', '-', stem)
    stem = re.sub(r'-+', '-', stem).strip('-')
    new_name = f"{stem}{ext}"

    # Rename file on disk if it exists
    config = get_config()
    vault_root = Path(config.vault.root_path)
    old_path = vault_root / doc["file_path"]

    if old_path.exists():
        new_path = old_path.parent / new_name
        if new_path.exists() and new_path != old_path:
            raise HTTPException(status_code=409, detail="A file with that name already exists")
        old_path.rename(new_path)
        new_file_path = str(new_path.relative_to(vault_root))
    else:
        new_file_path = doc["file_path"]

    await db.execute(
        "UPDATE documents SET original_filename = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_name, new_file_path, doc_id),
    )
    await db.commit()
    return await get_document(db, doc_id)


@router.post("/{doc_id}/generate-filename")
async def generate_filename(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Generate an AI-suggested filename based on document metadata."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    ext = Path(doc.get("original_filename", "doc")).suffix.lower() or ".pdf"
    doc_date = doc.get("date_visit") or doc.get("date_issued") or doc.get("doc_date") or ""
    date_prefix = doc_date.replace("-", "") if doc_date else "00000000"

    # Use LLM to generate a concise, descriptive name
    from asclepius.pipeline.organizer import generate_ai_filename
    from asclepius.pipeline.processor import get_llm_provider

    config = get_config()
    llm = get_llm_provider(config)

    doc_meta = {
        "doc_type": doc.get("doc_type"),
        "doc_date": doc_date,
        "doctor_name": doc.get("doctor_name"),
        "facility_name": doc.get("facility_name"),
        "summary_en": doc.get("summary_en"),
    }

    slug = await generate_ai_filename(llm, doc_meta)

    # Fallback if LLM fails
    if not slug:
        fallback = doc.get("doc_type") or "document"
        slug = re.sub(r"[^a-z0-9]+", "-", fallback.lower()).strip("-")

    suggested = f"{date_prefix}_{slug}{ext}"
    return {"suggested_filename": suggested}


@router.get("/{doc_id}/relevant")
async def get_relevant_documents(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get AI-suggested relevant documents. Returns cached results if available."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if not doc.get("patient_id"):
        return {"suggestions": []}

    # Check access
    role = await check_patient_access(db, current_user["id"], doc["patient_id"])
    if not role:
        raise HTTPException(status_code=403, detail="No access")

    # Get existing links to exclude
    existing_links = await _get_document_links(db, doc_id)
    linked_ids = set()
    for link in existing_links:
        linked_ids.add(link["source_document_id"])
        linked_ids.add(link["target_document_id"])

    # Get all other documents for the same patient
    cursor = await db.execute(
        """SELECT d.id, d.doc_type, d.doc_date, d.summary_en, d.original_filename,
                  doc.name as doctor_name, f.name as facility_name
           FROM documents d
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           WHERE d.patient_id = ? AND d.id != ? AND d.status = 'done'
           ORDER BY d.doc_date DESC
           LIMIT 50""",
        (doc["patient_id"], doc_id),
    )
    rows = await cursor.fetchall()
    other_docs = [dict(r) for r in rows if r["id"] not in linked_ids]

    if not other_docs:
        return {"suggestions": []}

    other_docs_text = "\n".join(
        f"- ID: {d['id']}, Type: {d.get('doc_type', 'unknown')}, Date: {d.get('doc_date', 'unknown')}, "
        f"Doctor: {d.get('doctor_name', 'unknown')}, Facility: {d.get('facility_name', 'unknown')}, "
        f"Summary: {d.get('summary_en', 'N/A')}"
        for d in other_docs
    )

    from asclepius.llm.prompts import LINK_SUGGESTION_PROMPT
    from asclepius.pipeline.processor import get_llm_provider

    config = get_config()
    llm = get_llm_provider(config)

    prompt = LINK_SUGGESTION_PROMPT.format(
        doc_id=doc_id,
        doc_type=doc.get("doc_type", "unknown"),
        doc_date=doc.get("doc_date", "unknown"),
        doctor_name=doc.get("doctor_name", "unknown"),
        facility_name=doc.get("facility_name", "unknown"),
        summary=doc.get("summary_en", "N/A"),
        other_documents=other_docs_text,
    )

    try:
        if hasattr(llm, "_generate"):
            response_text = await llm._generate(prompt)
            result = llm._parse_json(response_text)
        else:
            return {"suggestions": []}

        suggestions = result.get("suggestions", [])
        valid_ids = {d["id"] for d in other_docs}
        suggestions = [s for s in suggestions if s.get("document_id") in valid_ids]

        # Enrich with doc metadata
        docs_by_id = {d["id"]: d for d in other_docs}
        for s in suggestions:
            d = docs_by_id.get(s["document_id"], {})
            s["filename"] = d.get("original_filename")
            s["doc_type"] = d.get("doc_type")
            s["doc_date"] = d.get("doc_date")
            s["doctor_name"] = d.get("doctor_name")
            s["facility_name"] = d.get("facility_name")
            s["summary_en"] = d.get("summary_en")

        return {"suggestions": suggestions}
    except Exception as e:
        logger.exception("Failed to get relevant documents for doc %d", doc_id)
        return {"suggestions": []}


async def _get_document_links(db: aiosqlite.Connection, doc_id: int) -> list[dict]:
    """Get all document links (both directions) for a document."""
    cursor = await db.execute(
        """SELECT dl.id, dl.link_type, dl.created_at,
                  dl.source_document_id, dl.target_document_id,
                  sd.original_filename as source_filename, sd.doc_type as source_doc_type,
                  td.original_filename as target_filename, td.doc_type as target_doc_type
           FROM document_links dl
           JOIN documents sd ON dl.source_document_id = sd.id
           JOIN documents td ON dl.target_document_id = td.id
           WHERE dl.source_document_id = ? OR dl.target_document_id = ?""",
        (doc_id, doc_id),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]
