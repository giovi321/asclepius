"""Document API routes — CRUD, move, reprocess, and failed-queue management.

Sub-routers handle upload, file ops, linking, and AI features.
"""

import logging
import re
import shutil
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

import aiosqlite
from asclepius.auth.session import get_current_user, require_role
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.authz import require_document_access
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.util.dates import best_date_with_received
from asclepius.documents.service import (
    get_document,
    list_documents,
    get_failed_documents,
    get_related_records,
    get_document_sections,
    get_document_links,
    update_document_status,
    update_document_fields,
    delete_document_record,
    move_child_records,
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
    """Partial update payload. Unset fields are left untouched."""

    patient_id: int | None = None
    doc_type: str | None = Field(default=None, max_length=120)
    event_date: str | None = Field(default=None, max_length=40)
    issued_date: str | None = Field(default=None, max_length=40)
    doctor_id: int | None = None
    doctor_name: str | None = Field(default=None, max_length=200)
    facility_id: int | None = None
    facility_name: str | None = Field(default=None, max_length=200)
    specialty_original: str | None = Field(default=None, max_length=200)
    summary_en: str | None = Field(default=None, max_length=5000)
    event_id: int | None = None
    notes: str | None = Field(default=None, max_length=5000)
    tags: str | None = Field(default=None, max_length=2000)
    original_filename: str | None = Field(default=None, max_length=255)
    user_notes: str | None = Field(default=None, max_length=5000)


class DocumentMoveRequest(BaseModel):
    patient_id: int


class ReprocessRequest(BaseModel):
    # Enforced via Literal so a typo yields 422.
    mode: Literal["ocr", "llm", "both", "vision_llm"] = "both"
    llm_provider_id: str | None = None  # optional override
    ocr_provider_id: str | None = None  # optional override
    vision_provider_id: str | None = None  # optional override, used when mode == 'vision_llm'


class TranslateRequest(BaseModel):
    llm_provider_id: str | None = None  # optional text-LLM override


class RegionBbox(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)


class TranslateRegionRequest(BaseModel):
    """Bbox is in normalized [0,1] coords relative to the page width/height."""

    page: int = Field(ge=1)
    bbox: RegionBbox
    ocr_provider_id: str | None = None
    llm_provider_id: str | None = None


# ── Failed documents ─────────────────────────────────────────────


@router.get("/failed")
async def list_failed_docs(
    limit: int = Query(default=50, ge=1, le=500),
    current_user: dict = Depends(require_role("admin", "editor")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List failed documents with error messages for the review queue.

    Restricted to admins/editors because the failure messages can expose
    internal paths, provider error strings, or extracted content snippets.
    """
    return await get_failed_documents(db, limit)


@router.post("/retry-all-failed")
async def retry_all_failed(
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Retry all failed documents. Admin-only.

    Each doc is enqueued onto the same single-threaded pipeline worker as
    fresh uploads — that's the only way to keep the "max 1 doc at a time"
    invariant. ``priority=10`` puts retries behind interactive reprocess
    clicks (which use 0) but ahead of large uploads.
    """
    from asclepius.pipeline.watcher import enqueue_job

    queue = getattr(request.app.state, "pipeline_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="Pipeline worker not running")

    cursor = await db.execute("SELECT id FROM documents WHERE status = 'failed'")
    doc_ids = [row[0] for row in await cursor.fetchall()]

    for doc_id in doc_ids:
        enqueue_job(
            queue,
            "reprocess",
            {"doc_id": doc_id, "mode": "both"},
            priority=10,
            queued_doc_id=doc_id,
            queued_label=f"doc#{doc_id}",
        )

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
    sort: str | None = Query(default=None),
    order: str | None = Query(default=None),
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
        db,
        current_user["id"],
        patient_id,
        type,
        date_from,
        date_to,
        status,
        q,
        limit,
        offset,
        specialty=specialty,
        doctor_id=effective_doctor,
        facility_id=effective_facility,
        user_role=current_user.get("role"),
        sort=sort,
        order=order,
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

    # Read access: admins, the uploader, or any patient grant (canonical rule
    # in asclepius.authz). Unclassified docs with no uploader stay admin-only.
    await require_document_access(db, doc, current_user)

    # Get related data
    lab_results = await get_related_records(db, "lab_results", doc_id)
    encounters = await get_related_records(db, "encounters", doc_id)
    medications = await get_related_records(db, "medications", doc_id)
    vaccinations = await get_related_records(db, "vaccinations", doc_id)

    # Imaging studies attached to this document (an imaging_dicom doc has
    # exactly one study; other doc types have zero — we just return an
    # empty list and the UI hides the section). Series are nested per-study.
    cursor = await db.execute(
        "SELECT * FROM imaging_studies WHERE document_id = ?",
        (doc_id,),
    )
    imaging_studies: list[dict] = []
    for srow in await cursor.fetchall():
        srow = dict(srow)
        cur2 = await db.execute(
            "SELECT * FROM imaging_series WHERE study_id = ? ORDER BY series_number",
            (srow["id"],),
        )
        srow["series"] = [dict(r) for r in await cur2.fetchall()]
        imaging_studies.append(srow)

    # Get linked documents
    links = await get_document_links(db, doc_id)

    # Get document sections (page-level sectioning)
    sections = await get_document_sections(db, doc_id)

    # Get ad-hoc region translations (newest first). Strip Chandra
    # markup defensively here too — new rows are clean (the region
    # translator pre-strips before persisting), but pre-existing rows
    # still contain raw HTML that would otherwise render unreadable.
    from asclepius.pipeline.text_utils import strip_chandra_markup

    rt_cursor = await db.execute(
        """SELECT id, page, bbox_x, bbox_y, bbox_w, bbox_h,
                  ocr_text, translated_text,
                  ocr_provider_id, llm_provider_id, llm_model,
                  thumbnail_path, created_at
             FROM region_translations
            WHERE document_id = ?
            ORDER BY id DESC""",
        (doc_id,),
    )
    region_translations = []
    for r in await rt_cursor.fetchall():
        item = dict(r)
        if item.get("ocr_text"):
            item["ocr_text"] = strip_chandra_markup(item["ocr_text"])
        if item.get("translated_text"):
            item["translated_text"] = strip_chandra_markup(item["translated_text"])
        region_translations.append(item)

    return {
        **doc,
        "lab_results": lab_results,
        "encounters": encounters,
        "medications": medications,
        "vaccinations": vaccinations,
        "imaging_studies": imaging_studies,
        "links": links,
        "sections": sections,
        "region_translations": region_translations,
    }


# ── Update & Delete ──────────────────────────────────────────────


@router.patch("/{doc_id}")
async def update_doc(
    doc_id: int,
    body: DocumentUpdate,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    from asclepius.documents.file_routes import _require_write_access

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    updates = {}
    # ``model_fields_set`` only contains fields the client explicitly sent, so
    # a None there is intentional (user clicked Clear). Accept it as a null
    # write rather than silently dropping the field — that's the difference
    # between PATCH semantics and "update with non-empty fields only".
    for field_name in body.model_fields_set:
        value = getattr(body, field_name)
        if field_name == "patient_id" and value is not None:
            role = await check_patient_access(db, current_user["id"], value)
            if not role:
                raise HTTPException(status_code=403, detail="No access to target patient")
        updates[field_name] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # doctor_name / facility_name are no longer columns — they're accepted as
    # convenience API inputs that resolve to the corresponding FK via the
    # alias-aware _upsert_* helpers. Log the raw text as a correction first,
    # then drop the fields before they reach the UPDATE statement.
    from asclepius.pipeline.extractor import _upsert_doctor, _upsert_facility

    if "doctor_name" in updates and "doctor_id" not in updates:
        name = (updates["doctor_name"] or "").strip()
        updates["doctor_id"] = await _upsert_doctor(db, {"name": name}) if name else None
    if "facility_name" in updates and "facility_id" not in updates:
        name = (updates["facility_name"] or "").strip()
        updates["facility_id"] = await _upsert_facility(db, {"name": name}) if name else None

    # specialty_original is the user's free-text. The detail view displays via
    # the norm_specialties join (norm_specialty_id), so we must also resolve /
    # auto-create a canonical row, otherwise the edit looks like a no-op.
    # Clearing the field drops the FK in lockstep so the two views agree.
    if "specialty_original" in updates:
        raw_specialty = updates["specialty_original"]
        if raw_specialty is None or not str(raw_specialty).strip():
            updates["specialty_original"] = None
            updates["norm_specialty_id"] = None
        else:
            from asclepius.normalization.resolver import AliasCache, resolve_specialty

            cleaned = str(raw_specialty).strip()
            updates["specialty_original"] = cleaned
            cache = AliasCache()
            norm_id = await resolve_specialty(db, cache, cleaned)
            if norm_id is not None:
                updates["norm_specialty_id"] = norm_id

    # Log corrections before applying updates (compares against raw_extraction)
    from asclepius.documents.corrections import log_corrections

    await log_corrections(db, doc_id, updates)

    # Strip API-only convenience fields before they reach the UPDATE statement
    # — doctor_name / facility_name resolve via FK, they are no longer columns.
    updates.pop("doctor_name", None)
    updates.pop("facility_name", None)

    await update_document_fields(db, doc_id, updates)
    await audit_log(
        db,
        current_user["id"],
        "document.update",
        "document",
        doc_id,
        {"fields": sorted(updates.keys())},
        get_client_ip(request),
    )
    return await get_document(db, doc_id)


@router.post("/{doc_id}/mark-reviewed")
async def mark_reviewed(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Confirm that the user has reviewed a flagged document.

    Flips ``status`` from ``needs_review`` (or ``failed``) to ``done`` and
    clears ``error_message`` so the red banner disappears. No-op when the
    document is already in any other state. Requires write access.
    """
    from asclepius.documents.file_routes import _require_write_access

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    if doc.get("status") not in ("needs_review", "failed"):
        return {
            "status": doc.get("status"),
            "document_id": doc_id,
            "changed": False,
        }

    await db.execute(
        """UPDATE documents SET status = 'done', error_message = NULL,
               updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
        (doc_id,),
    )
    await db.commit()
    return {"status": "done", "document_id": doc_id, "changed": True}


@router.post("/{doc_id}/cancel")
async def cancel_processing(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Cancel processing of a document. Requires write access.

    Belt-and-braces: we both set the cooperative ``cancelled_docs`` flag
    (honoured at phase boundaries inside the pipeline) and hard-cancel the
    running asyncio task if one is registered. The hard cancel aborts any
    in-flight ``await`` immediately (httpx POST, DB write), so the gate
    slot releases and the processing chip clears without waiting for the
    LLM request to finish on its own.
    """
    from asclepius.documents.file_routes import _require_write_access
    from asclepius.pipeline.processor import cancelled_docs, cancel_running_task

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    cancelled_docs.add(doc_id)
    hard_cancelled = cancel_running_task(doc_id)
    await update_document_status(db, doc_id, "cancelled")
    return {
        "status": "cancelled",
        "document_id": doc_id,
        "hard_cancelled": hard_cancelled,
    }


@router.delete("/{doc_id}")
async def delete_doc(
    doc_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a document and its file from disk. Gracefully handles in-progress processing."""
    import asyncio
    from asclepius.pipeline.processor import cancelled_docs, cancel_running_task

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete requires write access: admins, the uploader, or an owner/editor
    # patient grant (canonical rule in asclepius.authz). Viewers and callers
    # with no grant on a classified doc are rejected; unclassified docs with
    # no uploader stay admin-only.
    await require_document_access(db, doc, current_user, write=True)

    # If document is being processed, cancel it first — both cooperatively
    # and hard-cancel so an in-flight LLM request releases its gate slot.
    if doc["status"] in ("processing", "pending"):
        cancelled_docs.add(doc_id)
        cancel_running_task(doc_id)
        # Give the pipeline a moment to notice the cancellation
        await asyncio.sleep(0.5)

    # Delete file from disk — handle case where file may have already been moved.
    # Imaging report-PDFs are normal files; placeholder imaging docs have
    # file_path=NULL (skip the disk step). Some imaging documents may have
    # file_path pointing at a folder, so we ``rmtree`` for any path that
    # resolves to a dir.
    import shutil as _shutil

    config = get_config()
    raw_file_path = doc.get("file_path")
    file_path = (Path(config.vault.root_path) / raw_file_path) if raw_file_path else None
    if file_path is not None and file_path.exists():
        if file_path.is_dir():
            _shutil.rmtree(file_path, ignore_errors=True)
        else:
            file_path.unlink()
    elif raw_file_path:
        # Try inbox with original filename
        inbox_path = Path(config.vault.inbox_path) / doc["original_filename"]
        if inbox_path.exists():
            if inbox_path.is_dir():
                _shutil.rmtree(inbox_path, ignore_errors=True)
            else:
                inbox_path.unlink()

    # If this is an imaging study (``imaging_dicom`` or ``imaging_report``),
    # also remove the on-disk DICOM folder and the auxiliary bundle folder
    # (DICOMDIR / JPEG previews / LOCKFILE / VERSION).
    if doc.get("doc_type") in ("imaging_dicom", "imaging_report"):
        # Look up the study's folder + bundle slug derivation. The bundle
        # folder lives under either patients/{slug}/imaging-bundles/{stem}
        # or unclassified/imaging-bundles/{stem}, where {stem} is the slug
        # of the original zip filename. We approximate it by sweeping the
        # imaging-bundles directory of the patient and dropping anything
        # that no longer has a matching study.
        try:
            cursor = await db.execute(
                "SELECT folder_path FROM imaging_studies WHERE document_id = ?",
                (doc_id,),
            )
            study_row = await cursor.fetchone()
            if study_row and study_row[0]:
                # Layout: patients/{slug}/{year}/{study_folder}, or with an
                # optional ``imaging/`` segment for older folder layouts.
                study_folder = study_row[0]
                study_dir = Path(config.vault.root_path) / study_folder
                if study_dir.exists() and study_dir.is_dir():
                    _shutil.rmtree(study_dir, ignore_errors=True)
                # Bundle folder lives at the patient root.
                parts = study_folder.split("/")
                if parts and parts[0] in ("patients", "unclassified"):
                    if parts[0] == "patients" and len(parts) >= 2:
                        bundle_root = f"patients/{parts[1]}/imaging-bundles"
                    else:
                        bundle_root = "unclassified/imaging-bundles"
                    bundle_path = Path(config.vault.root_path) / bundle_root
                    if bundle_path.exists() and bundle_path.is_dir():
                        # Pragmatic compromise: drop the whole bundle root
                        # if NO studies remain for this patient/scope.
                        if parts[0] == "patients":
                            scope_like = f"patients/{parts[1]}/%"
                        else:
                            scope_like = "unclassified/%"
                        cursor = await db.execute(
                            "SELECT COUNT(*) FROM imaging_studies WHERE folder_path LIKE ?",
                            (scope_like,),
                        )
                        cnt_row = await cursor.fetchone()
                        if cnt_row and cnt_row[0] == 0:
                            _shutil.rmtree(bundle_path, ignore_errors=True)
        except Exception:
            logger.warning("Bundle cleanup failed for doc=%d (non-fatal)", doc_id, exc_info=True)

    # Clean up cancellation set
    cancelled_docs.discard(doc_id)

    # Delete from DB (CASCADE will handle child tables)
    await delete_document_record(db, doc_id)

    await audit_log(
        db,
        current_user["id"],
        "document.delete",
        "document",
        doc_id,
        {"filename": doc["original_filename"]},
        get_client_ip(request),
    )

    return {"status": "deleted", "document_id": doc_id}


# ── Move ─────────────────────────────────────────────────────────


@router.post("/{doc_id}/move")
async def move_doc(
    doc_id: int,
    body: DocumentMoveRequest,
    request: Request,
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
        from asclepius.pipeline.organizer import build_organized_path

        # Get doctor/facility slug for path
        doctor_slug = None
        facility_slug = None
        if doc.get("doctor_id"):
            cursor = await db.execute("SELECT slug FROM doctors WHERE id = ?", (doc["doctor_id"],))
            row = await cursor.fetchone()
            if row:
                doctor_slug = row[0]
        if doc.get("facility_id"):
            cursor = await db.execute(
                "SELECT slug FROM facilities WHERE id = ?", (doc["facility_id"],)
            )
            row = await cursor.fetchone()
            if row:
                facility_slug = row[0]

        provider_slug = facility_slug or doctor_slug

        # Get event slug if assigned
        event_slug = None
        if doc.get("event_id"):
            cursor = await db.execute(
                "SELECT title FROM medical_events WHERE id = ?", (doc["event_id"],)
            )
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

        best = best_date_with_received(doc)
        new_relative = build_organized_path(
            config,
            target_slug,
            best,
            provider_slug,
            doc.get("doc_type"),
            doc["original_filename"],
            event_slug=event_slug,
            summary_slug=summary_slug,
            uploaded_by_user_id=doc.get("uploaded_by_user_id"),
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
    await audit_log(
        db,
        current_user["id"],
        "document.move",
        "document",
        doc_id,
        {"from_patient_id": doc.get("patient_id"), "to_patient_id": body.patient_id},
        get_client_ip(request),
    )
    return await get_document(db, doc_id)


# ── Stage timeline ───────────────────────────────────────────────


@router.get("/{doc_id}/stages")
async def get_doc_stages(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Per-document pipeline stage timeline.

    Returns rows in chronological order (oldest first) so the UI can group
    runs (upload → reprocess → reprocess) without re-sorting.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    await require_document_access(db, doc, current_user)

    cursor = await db.execute(
        """SELECT id, stage, status, job_kind, message,
                  page_current, page_total, started_at, finished_at
           FROM document_stage_events
           WHERE document_id = ?
           ORDER BY id ASC""",
        (doc_id,),
    )
    rows = [dict(r) for r in await cursor.fetchall()]
    return {"document_id": doc_id, "events": rows}


# ── Reprocess ────────────────────────────────────────────────────


@router.post("/{doc_id}/reprocess")
async def reprocess_doc(
    doc_id: int,
    request: Request,
    body: ReprocessRequest = ReprocessRequest(),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Queue a document for reprocessing. Requires write access.

    Reprocess goes through the same single-threaded pipeline worker queue as
    fresh uploads. The previous implementation spawned the reprocess as an
    asyncio task on the FastAPI loop, which ran in parallel with the worker
    loop and let two docs hit the same Ollama server at the same time.
    """
    from asclepius.documents.file_routes import _require_write_access
    from asclepius.pipeline.watcher import enqueue_job

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    queue = getattr(request.app.state, "pipeline_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="Pipeline worker not running")

    # Mark as pending immediately so the UI reflects the change.
    await update_document_status(db, doc_id, "pending")

    # Resolve "use default" (None) into concrete provider ids so the dashboard
    # can show the actual model that will run, not a vague "default" label.
    # Only populate families that participate in the requested mode.
    from asclepius.config import get_config as _get_config

    cfg = _get_config()

    def _first_enabled(items):
        enabled = [p for p in items if getattr(p, "enabled", False)]
        if enabled:
            return min(enabled, key=lambda p: getattr(p, "priority", 0))
        return items[0] if items else None

    queued_providers: dict[str, str | None] = {}
    if body.mode in ("ocr", "both", "llm"):
        # mode=="llm" still needs OCR when no cached text exists; mode=="both"/"ocr" run OCR.
        ocr_id = body.ocr_provider_id
        if not ocr_id:
            p = _first_enabled(cfg.ocr.providers)
            ocr_id = p.id if p else None
        if ocr_id:
            queued_providers["ocr"] = ocr_id
    if body.mode in ("llm", "both"):
        llm_id = body.llm_provider_id
        if not llm_id:
            p = _first_enabled(cfg.llm.providers)
            llm_id = p.id if p else None
        if llm_id:
            queued_providers["llm"] = llm_id
    if body.mode == "vision_llm":
        vision_id = body.vision_provider_id
        if not vision_id:
            p = _first_enabled(cfg.vision.providers)
            vision_id = p.id if p else None
        if vision_id:
            queued_providers["vision"] = vision_id

    enqueue_job(
        queue,
        "reprocess",
        {
            "doc_id": doc_id,
            "mode": body.mode,
            "llm_provider_id": body.llm_provider_id,
            "ocr_provider_id": body.ocr_provider_id,
            "vision_provider_id": body.vision_provider_id,
            "resolved_providers": queued_providers,
        },
        priority=0,  # user clicked reprocess explicitly — jump the queue
        queued_doc_id=doc_id,
        queued_label=doc.get("original_filename") or f"doc#{doc_id}",
        queued_providers=queued_providers,
    )
    return {"status": "queued", "document_id": doc_id}


# ── Translate ────────────────────────────────────────────────────


@router.post("/{doc_id}/translate")
async def translate_doc(
    doc_id: int,
    request: Request,
    body: TranslateRequest = TranslateRequest(),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Queue an on-demand English translation of the document body.

    Re-uses the cached ``ocr_text`` — does not run OCR again. Result is
    persisted to ``documents.ocr_text_en``, overwriting any prior run.
    """
    from asclepius.documents.file_routes import _require_write_access
    from asclepius.pipeline.watcher import enqueue_job

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    if not (doc.get("ocr_text") or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Document has no OCR text yet — run OCR before translating.",
        )

    queue = getattr(request.app.state, "pipeline_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="Pipeline worker not running")

    cfg = get_config()

    def _first_enabled(items):
        enabled = [p for p in items if getattr(p, "enabled", False)]
        if enabled:
            return min(enabled, key=lambda p: getattr(p, "priority", 0))
        return items[0] if items else None

    queued_providers: dict[str, str | None] = {}
    llm_id = body.llm_provider_id
    if not llm_id:
        p = _first_enabled(cfg.llm.providers)
        llm_id = p.id if p else None
    if llm_id:
        queued_providers["llm"] = llm_id

    enqueue_job(
        queue,
        "translate",
        {
            "doc_id": doc_id,
            "llm_provider_id": body.llm_provider_id,
            "resolved_providers": queued_providers,
        },
        priority=0,
        queued_doc_id=doc_id,
        queued_label=doc.get("original_filename") or f"doc#{doc_id}",
        queued_providers=queued_providers,
    )
    return {"status": "queued", "document_id": doc_id}


# ── Region translate ─────────────────────────────────────────────


@router.post("/{doc_id}/translate-region")
async def translate_region_endpoint(
    doc_id: int,
    body: TranslateRegionRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Queue OCR + translation of a user-selected rectangle on one page.

    Pre-allocates a row in ``region_translations`` with the bbox so the
    UI can show a placeholder while the worker fills in the OCR text,
    translation, and thumbnail.
    """
    from asclepius.documents.file_routes import _require_write_access
    from asclepius.pipeline.watcher import enqueue_job

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    if not doc.get("file_path"):
        raise HTTPException(
            status_code=400,
            detail="Document has no file on disk to crop.",
        )

    queue = getattr(request.app.state, "pipeline_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="Pipeline worker not running")

    cfg = get_config()

    def _first_enabled(items):
        enabled = [p for p in items if getattr(p, "enabled", False)]
        if enabled:
            return min(enabled, key=lambda p: getattr(p, "priority", 0))
        return items[0] if items else None

    queued_providers: dict[str, str | None] = {}
    ocr_id = body.ocr_provider_id
    if not ocr_id:
        p = _first_enabled(cfg.ocr.providers)
        ocr_id = p.id if p else None
    if ocr_id:
        queued_providers["ocr"] = ocr_id
    llm_id = body.llm_provider_id
    if not llm_id:
        p = _first_enabled(cfg.llm.providers)
        llm_id = p.id if p else None
    if llm_id:
        queued_providers["llm"] = llm_id

    cursor = await db.execute(
        """INSERT INTO region_translations
              (document_id, page, bbox_x, bbox_y, bbox_w, bbox_h,
               ocr_provider_id, llm_provider_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            doc_id,
            body.page,
            body.bbox.x,
            body.bbox.y,
            body.bbox.w,
            body.bbox.h,
            ocr_id,
            llm_id,
        ),
    )
    await db.commit()
    region_row_id = cursor.lastrowid

    enqueue_job(
        queue,
        "translate_region",
        {
            "doc_id": doc_id,
            "region_row_id": region_row_id,
            "page": body.page,
            "bbox": body.bbox.model_dump(),
            "ocr_provider_id": body.ocr_provider_id,
            "llm_provider_id": body.llm_provider_id,
            "resolved_providers": queued_providers,
        },
        priority=0,
        queued_doc_id=doc_id,
        queued_label=doc.get("original_filename") or f"doc#{doc_id}",
        queued_providers=queued_providers,
    )
    return {
        "status": "queued",
        "document_id": doc_id,
        "region_id": region_row_id,
    }


@router.delete("/{doc_id}/region-translations/{region_id}")
async def delete_region_translation(
    doc_id: int,
    region_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a region translation row and its thumbnail file (if present)."""
    from asclepius.documents.file_routes import _require_write_access

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    cursor = await db.execute(
        """SELECT thumbnail_path FROM region_translations
            WHERE id = ? AND document_id = ?""",
        (region_id, doc_id),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Region translation not found")

    thumbnail_path = row["thumbnail_path"]
    cfg = get_config()
    if thumbnail_path:
        try:
            from asclepius.util.paths import safe_vault_join, UnsafePathError

            try:
                disk_path = safe_vault_join(Path(cfg.vault.root_path), thumbnail_path)
                if disk_path.is_file():
                    disk_path.unlink()
            except UnsafePathError:
                logger.warning("Refusing to delete unsafe thumbnail path %r", thumbnail_path)
        except Exception:
            logger.warning("Failed to delete thumbnail %s", thumbnail_path, exc_info=True)

    await db.execute(
        "DELETE FROM region_translations WHERE id = ? AND document_id = ?",
        (region_id, doc_id),
    )
    await db.commit()
    return {"status": "deleted", "region_id": region_id}


@router.get("/{doc_id}/region-translations/{region_id}/thumbnail")
async def get_region_thumbnail(
    doc_id: int,
    region_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Serve the cropped PNG thumbnail for a region translation."""
    from fastapi.responses import FileResponse
    from asclepius.util.paths import safe_vault_join, UnsafePathError

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await require_document_access(db, doc, current_user)

    cursor = await db.execute(
        """SELECT thumbnail_path FROM region_translations
            WHERE id = ? AND document_id = ?""",
        (region_id, doc_id),
    )
    row = await cursor.fetchone()
    if not row or not row["thumbnail_path"]:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    cfg = get_config()
    try:
        disk_path = safe_vault_join(Path(cfg.vault.root_path), row["thumbnail_path"])
    except UnsafePathError:
        raise HTTPException(status_code=400, detail="Invalid thumbnail path")
    if not disk_path.is_file():
        raise HTTPException(status_code=404, detail="Thumbnail file missing")
    return FileResponse(
        path=str(disk_path),
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )
