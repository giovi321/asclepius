"""Document API routes."""

import json
import os
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import get_document, list_documents
from asclepius.patients.service import check_patient_access

router = APIRouter()


@router.post("/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    patient_id: int | None = Query(default=None),
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

    # Write patient_id hint as a sidecar file so the pipeline can read it
    if patient_id:
        hint_path = Path(str(dest) + ".patient_hint")
        hint_path.write_text(str(patient_id))

    # The pipeline watcher will detect the file, create the DB record,
    # and process it. No DB record created here to avoid duplicates.

    return {"filename": dest.name, "status": "pending", "message": "File uploaded and queued for processing"}


class DocumentUpdate(BaseModel):
    patient_id: int | None = None
    doc_type: str | None = None
    doc_date: str | None = None
    doctor_id: int | None = None
    facility_id: int | None = None
    notes: str | None = None
    tags: str | None = None


class DocumentMoveRequest(BaseModel):
    patient_id: int


class DocumentLinkRequest(BaseModel):
    target_document_id: int
    link_type: str  # 'invoice_for', 'report_for', 'imaging_for', 'follow_up', 'related'


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
    limit: int = Query(default=50, le=200),
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

    return {
        **doc,
        "lab_results": lab_results,
        "encounters": encounters,
        "medications": medications,
        "vaccinations": vaccinations,
        "links": links,
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
    if body.patient_id is not None:
        # Verify access to target patient
        role = await check_patient_access(db, current_user["id"], body.patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access to target patient")
        updates["patient_id"] = body.patient_id
    if body.doc_type is not None:
        updates["doc_type"] = body.doc_type
    if body.doc_date is not None:
        updates["doc_date"] = body.doc_date
    if body.doctor_id is not None:
        updates["doctor_id"] = body.doctor_id
    if body.facility_id is not None:
        updates["facility_id"] = body.facility_id
    if body.notes is not None:
        updates["notes"] = body.notes
    if body.tags is not None:
        updates["tags"] = body.tags

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
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a document and its file from disk. Gracefully handles in-progress processing."""
    import asyncio
    from asclepius.pipeline.processor import cancelled_docs

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check access
    if doc["patient_id"]:
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
        if role != "owner":
            raise HTTPException(status_code=403, detail="Only owners can delete documents")

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

        new_relative = build_organized_path(
            config, target_slug, doc.get("doc_date"), provider_slug,
            doc.get("doc_type"), doc["original_filename"],
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

    # Verify both documents exist
    source = await get_document(db, doc_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source document not found")
    target = await get_document(db, body.target_document_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target document not found")

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
- doctor (object: name, title, specialty_original)
- facility (object: name, type, city)
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

    # Handle doctor change
    doctor_data = changes.get("doctor")
    if doctor_data and isinstance(doctor_data, dict) and doctor_data.get("name"):
        from asclepius.pipeline.extractor import _upsert_doctor
        doctor_id = await _upsert_doctor(db, doctor_data)
        updates["doctor_id"] = doctor_id

    # Handle facility change
    facility_data = changes.get("facility")
    if facility_data and isinstance(facility_data, dict) and facility_data.get("name"):
        from asclepius.pipeline.extractor import _upsert_facility
        facility_id = await _upsert_facility(db, facility_data)
        updates["facility_id"] = facility_id

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [doc_id]
        await db.execute(
            f"UPDATE documents SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values,
        )
        await db.commit()

    return {"status": "updated", "document_id": doc_id, "changes": changes}


async def _get_related(db: aiosqlite.Connection, table: str, doc_id: int) -> list[dict]:
    """Get related records from a child table."""
    cursor = await db.execute(f"SELECT * FROM {table} WHERE document_id = ?", (doc_id,))
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


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
