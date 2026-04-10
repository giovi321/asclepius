"""Document API routes."""

import json
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
    provider_id: int | None = None


@router.get("")
async def list_docs(
    patient_id: int | None = None,
    type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    q: str | None = None,
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
        db, current_user["id"], patient_id, type, date_from, date_to, status, q, limit, offset
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

    return {
        **doc,
        "lab_results": lab_results,
        "encounters": encounters,
        "medications": medications,
        "vaccinations": vaccinations,
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
    file_path = Path(config.vault.root_path) / doc["file_path"]
    if not file_path.exists():
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
    if body.provider_id is not None:
        updates["provider_id"] = body.provider_id

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
