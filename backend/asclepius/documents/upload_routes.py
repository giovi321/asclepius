"""Document upload and batch scheduling routes.

Files land in a per-user sub-folder of the inbox so the pipeline watcher
and file browser naturally attribute them to the uploader. Uploads are
streamed to disk in capped chunks so a malicious client cannot use memory
exhaustion as a DoS primitive.
"""

import logging
import os
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import compute_file_hash, get_document
from asclepius.util.paths import UnsafePathError, safe_filename, safe_vault_join

logger = logging.getLogger(__name__)

router = APIRouter()

# Chunk size for streaming uploads to disk. 1 MiB balances syscall overhead
# against peak memory.
_CHUNK = 1024 * 1024


def _detect_mime(path: Path) -> str:
    """Best-effort MIME detection using libmagic; falls back to extension."""
    try:
        import magic  # python-magic
        return magic.from_file(str(path), mime=True) or ""
    except Exception as exc:  # pragma: no cover — libmagic may be absent
        logger.debug("libmagic unavailable, falling back to suffix: %s", exc)
        ext = path.suffix.lower().lstrip(".")
        return {
            "pdf": "application/pdf",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "dcm": "application/dicom",
        }.get(ext, "application/octet-stream")


@router.post("/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    patient_id: int | None = Query(default=None),
    event_id: int | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Upload a document into the current user's inbox for processing."""
    config = get_config()
    user_id = int(current_user["id"])
    vault_root = Path(config.vault.root_path)

    # Resolve the user-specific inbox under the vault root. This also
    # guarantees the inbox stays inside the vault even if the config is
    # edited by a user with shell access.
    try:
        inbox = safe_vault_join(vault_root, f"inbox/user-{user_id}")
    except UnsafePathError as exc:
        logger.error("Inbox path escapes vault root: %s", exc)
        raise HTTPException(status_code=500, detail="Misconfigured vault")
    inbox.mkdir(parents=True, exist_ok=True)

    # Sanitise the client-supplied filename. Rejects ``..``, path separators,
    # NUL bytes, reserved Windows names, etc.
    safe_name = safe_filename(file.filename or "upload")
    try:
        dest = safe_vault_join(inbox, safe_name)
    except UnsafePathError as exc:
        raise HTTPException(status_code=400, detail=f"Unsafe filename: {exc}")

    # Handle name conflicts without leaking info about other uploads.
    counter = 1
    while dest.exists():
        stem = Path(safe_name).stem
        suffix = Path(safe_name).suffix
        dest = inbox / f"{stem}_{counter}{suffix}"
        counter += 1
        if counter > 10_000:  # pragma: no cover — extreme edge case
            raise HTTPException(status_code=409, detail="Could not allocate filename")

    # Stream to disk with a size cap — avoids loading huge files in RAM and
    # bounds disk use per request.
    max_bytes = config.server.max_upload_bytes
    written = 0
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Upload exceeds {max_bytes} bytes",
                    )
                out.write(chunk)
    except HTTPException:
        if dest.exists():
            dest.unlink(missing_ok=True)
        raise
    except Exception:
        if dest.exists():
            dest.unlink(missing_ok=True)
        raise

    # MIME check via libmagic — reject files whose content does not match
    # one of the allowed prefixes (PDF / image / DICOM).
    mime = _detect_mime(dest)
    if not any(mime.startswith(p) for p in config.server.allowed_upload_mime_prefixes):
        dest.unlink(missing_ok=True)
        raise HTTPException(
            status_code=415, detail=f"Unsupported file type: {mime or 'unknown'}",
        )

    # Optional patient/event hints for the pipeline. These are trusted only
    # after the upload handler checks the caller has access to them.
    if patient_id:
        from asclepius.patients.service import check_patient_access
        # Open a short-lived connection (the outer request doesn't have one
        # injected here because we're streaming the body).
        async with aiosqlite.connect(config.database.path) as db:
            role = await check_patient_access(db, user_id, patient_id)
        if not role:
            dest.unlink(missing_ok=True)
            raise HTTPException(status_code=403, detail="No access to patient")
        (dest.parent / f"{dest.name}.patient_hint").write_text(str(patient_id))
    if event_id:
        (dest.parent / f"{dest.name}.event_hint").write_text(str(event_id))

    # Create a DB record immediately so the document shows up in the UI.
    # The pipeline will find this row by file_hash rather than duplicating.
    try:
        file_hash = compute_file_hash(str(dest))
        file_size = os.path.getsize(str(dest))
        async with aiosqlite.connect(config.database.path) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute("PRAGMA foreign_keys=ON")
            await db.execute(
                """INSERT INTO documents
                   (file_path, original_filename, file_hash, file_size, patient_id,
                    event_id, uploaded_by_user_id, date_received, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, DATE('now'), 'pending')""",
                (f"inbox/user-{user_id}/{dest.name}", dest.name, file_hash, file_size,
                 patient_id, event_id, user_id),
            )
            await db.commit()
    except Exception as e:
        logger.warning("Upload DB record failed (pipeline will create): %s", e)

    # Batch-processing suggestion for large uploads / busy queue.
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
        if written > 10 * 1024 * 1024 or queue_size > 5:
            suggestion = "batch_schedule"
            suggestion_message = "Large upload detected. Consider scheduling for later processing."
    except Exception:
        pass

    result = {
        "filename": dest.name,
        "status": "pending",
        "message": "File uploaded and queued for processing",
    }
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
        # Only the uploader or an admin may reschedule; otherwise a viewer
        # with access to the document list could pause processing.
        if current_user.get("role") != "admin" and doc.get("uploaded_by_user_id") != current_user["id"]:
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
