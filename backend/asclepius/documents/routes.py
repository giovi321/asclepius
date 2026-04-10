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

    return {"filename": dest.name, "status": "queued", "message": "File uploaded to inbox for processing"}


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


@router.delete("/{doc_id}")
async def delete_doc(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a document and its file from disk."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check access
    if doc["patient_id"]:
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
        if role != "owner":
            raise HTTPException(status_code=403, detail="Only owners can delete documents")

    # Delete file from disk
    config = get_config()
    file_path = Path(config.vault.root_path) / doc["file_path"]
    if file_path.exists():
        file_path.unlink()

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
