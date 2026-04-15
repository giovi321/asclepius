"""Document upload and batch scheduling routes."""

import logging
import shutil
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import get_document

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
