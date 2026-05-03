"""Doctor-facing read endpoints under ``/api/share``.

Every endpoint here pulls a valid share session via ``get_share_session``.
The dependency rejects with 401 if the cookie is missing, the session is
revoked, or the share itself is past its expiry — so the route handlers
never need to repeat those checks.

The doctor surface is intentionally narrow: list shared docs, view a
single doc's full record, fetch a watermarked copy of the file, read
existing translations, and ask for a fresh translation. No write of any
kind goes through here.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel, Field

from asclepius.audit.service import get_client_ip
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import (
    get_document,
    get_document_links,
    get_document_sections,
    get_related_records,
)
from asclepius.pipeline.text_utils import strip_chandra_markup
from asclepius.share import service as share_service
from asclepius.share.dependencies import get_share_session
from asclepius.share.rate_limit import translate_allowed, translate_headroom
from asclepius.share.watermark import (
    WatermarkError,
    watermark_image_bytes,
    watermark_pdf_bytes,
)
from asclepius.util.paths import UnsafePathError, safe_vault_join

# Doctor-side region-translation text is rendered with
# ``whitespace-pre-wrap``, so the paragraph-break ``\n\n`` that
# strip_chandra_markup preserves shows as a full blank line between
# every paragraph — visually wasteful for short translations like
# "Medical History\n\nFollow-up visit..." Collapse runs of newlines
# to a single one only for the doctor surface; admin display keeps
# the original structure.
_COLLAPSE_NEWLINES = re.compile(r"\n{2,}")


def _compact_for_doctor(text: str | None) -> str | None:
    if not text:
        return text
    return _COLLAPSE_NEWLINES.sub("\n", text)


logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────


class ShareTranslateRequest(BaseModel):
    llm_provider_id: str | None = None
    target_language: str | None = None


class RegionBbox(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)


class ShareTranslateRegionRequest(BaseModel):
    page: int = Field(ge=1)
    bbox: RegionBbox
    ocr_provider_id: str | None = None
    llm_provider_id: str | None = None
    target_language: str | None = None


# ── Helpers ──────────────────────────────────────────────────────


async def _ensure_doc_in_share(db: aiosqlite.Connection, share_id: int, doc_id: int) -> dict:
    """Resolve a document and confirm it is part of the caller's share.

    Raises 404 (not 403) when the document exists but isn't shared, so we
    don't leak the existence of unrelated documents.
    """
    if not await share_service.share_has_document(db, share_id, doc_id):
        raise HTTPException(status_code=404, detail="Document not in this share")
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


# ── Endpoints ────────────────────────────────────────────────────


@router.get("/me")
async def share_me(
    session: dict = Depends(get_share_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Doctor dashboard payload: patient label, share metadata, doc list,
    and current translate-rate-limit headroom."""
    cfg = get_config()

    # Patient display name for the dashboard header.
    cursor = await db.execute(
        "SELECT display_name FROM patients WHERE id = ?",
        (session["patient_id"],),
    )
    row = await cursor.fetchone()
    patient_name = row[0] if row else "Patient"

    docs = await share_service.share_documents(db, session["share_id"])
    # Strip vault path/file_hash from the doctor-facing shape — not
    # needed and could leak storage details.
    safe_docs = [
        {
            "id": d["id"],
            "doc_type": d.get("doc_type"),
            "event_date": d.get("event_date"),
            "issued_date": d.get("issued_date"),
            "summary_en": d.get("summary_en"),
            "summary_original": d.get("summary_original"),
            "doctor_name": d.get("doctor_name"),
            "facility_name": d.get("facility_name"),
            "specialty_display": d.get("specialty_display"),
            "language_source": d.get("language_source"),
            "page_count": d.get("page_count"),
            "original_filename": d.get("original_filename"),
        }
        for d in docs
    ]

    headroom = translate_headroom(
        session_id=session["id"],
        share_id=session["share_id"],
        debounce_seconds=cfg.share.translate_per_session_seconds,
        per_share_per_hour=cfg.share.translate_per_share_per_hour,
    )

    allowed_languages = list(cfg.llm.translation_allowed_languages) or ["English"]
    default_language = cfg.llm.translation_target_language or "English"
    if default_language not in allowed_languages:
        default_language = allowed_languages[0]

    return {
        "recipient_label": session["recipient_label"],
        "patient_name": patient_name,
        "share_expires_at": session["share_expires_at"],
        "session_expires_at": session["expires_at"],
        "documents": safe_docs,
        "translate_rate_limit": headroom,
        "default_translation_language": default_language,
        "allowed_translation_languages": allowed_languages,
    }


@router.get("/documents/{doc_id}")
async def share_document_detail(
    doc_id: int,
    request: Request,
    session: dict = Depends(get_share_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Full document view — labs, encounters, medications, vaccinations,
    sections, region translations, and links scoped to the share's docs."""
    doc = await _ensure_doc_in_share(db, session["share_id"], doc_id)

    # Encounters are intentionally NOT exposed on the doctor surface —
    # they often contain free-text clinical notes / diagnoses written by
    # the original physician for internal use. The structured lab,
    # medication, and vaccination tables, plus the watermarked PDF +
    # summary, are sufficient for an outside doctor's review.
    lab_results = await get_related_records(db, "lab_results", doc_id)
    medications = await get_related_records(db, "medications", doc_id)
    vaccinations = await get_related_records(db, "vaccinations", doc_id)
    sections = await get_document_sections(db, doc_id)

    # Region translations. We strip Chandra/Vision-LLM HTML markup
    # before serving — the raw ocr_text can be a wall of <div data-bbox=...>
    # tags that would render unreadably in the doctor's "view original
    # text" panel. The pipeline's translator stage strips internally
    # before sending to the LLM but the row itself stores the raw
    # markup, so we clean on read instead of changing the storage shape.
    rt_cursor = await db.execute(
        """SELECT id, page, bbox_x, bbox_y, bbox_w, bbox_h,
                  ocr_text, translated_text, thumbnail_path,
                  target_language, created_at
             FROM region_translations
            WHERE document_id = ?
            ORDER BY id DESC""",
        (doc_id,),
    )
    # Don't include llm_model in the doctor surface — the doctor doesn't
    # need to know which provider the admin configured, and surfacing it
    # would require revealing internal model identifiers (sometimes
    # tied to specific deployments). Storage isn't touched; we just
    # don't SELECT it. ``thumbnail_path`` is collapsed to a boolean
    # ``has_thumbnail`` so we don't leak the on-disk path.
    region_translations = []
    for r in await rt_cursor.fetchall():
        item = dict(r)
        if item.get("ocr_text"):
            item["ocr_text"] = _compact_for_doctor(strip_chandra_markup(item["ocr_text"]))
        if item.get("translated_text"):
            item["translated_text"] = _compact_for_doctor(
                strip_chandra_markup(item["translated_text"])
            )
        item["has_thumbnail"] = bool(item.pop("thumbnail_path", None))
        region_translations.append(item)

    # Links — but filter to only docs that are also part of this share so
    # the doctor cannot pivot to documents outside the curated set.
    cursor = await db.execute(
        "SELECT document_id FROM document_share_documents WHERE share_id = ?",
        (session["share_id"],),
    )
    shared_ids = {row[0] for row in await cursor.fetchall()}
    links = [
        link
        for link in await get_document_links(db, doc_id)
        if (
            link.get("source_document_id") in shared_ids
            and link.get("target_document_id") in shared_ids
        )
    ]

    await share_service.write_audit(
        db,
        share_id=session["share_id"],
        action="view_doc",
        session_id=session["id"],
        document_id=doc_id,
        client_ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    # Strip storage-internal fields before returning. We expose a
    # boolean ``has_file`` in their place so the doctor UI can decide
    # whether to enable translate / fetch the file without ever seeing
    # the vault path.
    public_doc = {
        k: v
        for k, v in doc.items()
        if k
        not in {
            "file_path",
            "file_hash",
            "raw_extraction",
            "uploaded_by_user_id",
            "process_at",
            "retry_count",
            "error_message",
        }
    }
    public_doc["has_file"] = bool(doc.get("file_path"))

    return {
        **public_doc,
        "lab_results": lab_results,
        "medications": medications,
        "vaccinations": vaccinations,
        "sections": sections,
        "region_translations": region_translations,
        "links": links,
    }


@router.head("/documents/{doc_id}/file")
async def share_head_file(
    doc_id: int,
    session: dict = Depends(get_share_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    doc = await _ensure_doc_in_share(db, session["share_id"], doc_id)
    if not doc.get("file_path"):
        raise HTTPException(status_code=404, detail="File not found")
    cfg = get_config()
    try:
        path = safe_vault_join(Path(cfg.vault.root_path), doc["file_path"])
    except UnsafePathError:
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return Response(status_code=200)


@router.get("/documents/{doc_id}/file")
async def share_serve_file(
    doc_id: int,
    request: Request,
    session: dict = Depends(get_share_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Stream a watermarked copy of the document file.

    The original vault bytes are never streamed unmodified — every
    response is a fresh in-memory render with the doctor's identity
    burned onto every page (PDF) or composited onto the image (PNG/JPG).
    """
    cfg = get_config()
    doc = await _ensure_doc_in_share(db, session["share_id"], doc_id)
    if not doc.get("file_path"):
        raise HTTPException(status_code=404, detail="File not available")

    try:
        path = safe_vault_join(Path(cfg.vault.root_path), doc["file_path"])
    except UnsafePathError:
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    suffix = path.suffix.lower()
    headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        # Empty filename keeps browsers from prompting "Save As" with a
        # useful default. Combined with no Download UI in the doctor app,
        # this removes every easy on-disk save path.
        "Content-Disposition": 'inline; filename=""',
        "X-Content-Type-Options": "nosniff",
    }

    if suffix == ".pdf":
        try:
            body = watermark_pdf_bytes(
                path,
                label=session["recipient_label"],
                opacity=cfg.share.watermark_opacity,
            )
        except WatermarkError:
            await share_service.write_audit(
                db,
                share_id=session["share_id"],
                action="view_file_failed",
                session_id=session["id"],
                document_id=doc_id,
                client_ip=get_client_ip(request),
                user_agent=request.headers.get("user-agent"),
                detail={"reason": "watermark_failed"},
            )
            raise HTTPException(
                status_code=503,
                detail="Document temporarily unavailable. Please retry.",
            )
        media_type = "application/pdf"
    elif suffix in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
        try:
            body, media_type = watermark_image_bytes(
                path,
                label=session["recipient_label"],
                opacity=cfg.share.watermark_opacity,
            )
        except WatermarkError:
            await share_service.write_audit(
                db,
                share_id=session["share_id"],
                action="view_file_failed",
                session_id=session["id"],
                document_id=doc_id,
                client_ip=get_client_ip(request),
                user_agent=request.headers.get("user-agent"),
                detail={"reason": "watermark_failed"},
            )
            raise HTTPException(
                status_code=503,
                detail="Document temporarily unavailable. Please retry.",
            )
    else:
        # Non-watermarkable formats are not exposed to the doctor surface.
        # Refusing rather than streaming raw bytes keeps the "no leak"
        # guarantee tight.
        raise HTTPException(
            status_code=415,
            detail="This file type cannot be displayed in the share view",
        )

    await share_service.write_audit(
        db,
        share_id=session["share_id"],
        action="view_file",
        session_id=session["id"],
        document_id=doc_id,
        client_ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return FastAPIResponse(
        content=body,
        media_type=media_type,
        headers=headers,
    )


@router.get("/documents/{doc_id}/region-translations/{region_id}/thumbnail")
async def share_region_thumbnail(
    doc_id: int,
    region_id: int,
    session: dict = Depends(get_share_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Serve the cropped PNG thumbnail for a region translation.

    Mirrors the admin endpoint but scopes by the share session so the
    doctor can only fetch thumbnails for documents in their share.
    Returns 404 (not 403) for region IDs that exist but belong to a
    different doc, matching the rest of the share surface — we don't
    leak existence of unrelated rows.
    """
    from fastapi.responses import FileResponse
    from asclepius.util.paths import safe_vault_join, UnsafePathError

    # Confirm the doc is in this share before any DB lookup on the
    # thumbnail itself; cheap permission gate keyed on the share.
    await _ensure_doc_in_share(db, session["share_id"], doc_id)

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


@router.post("/documents/{doc_id}/translate", deprecated=True)
async def share_translate(
    doc_id: int,
    request: Request,
    body: ShareTranslateRequest = ShareTranslateRequest(),
    session: dict = Depends(get_share_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    """DEPRECATED: whole-document translation via the doctor surface.

    Kept for backward compatibility (the e2e test still exercises it)
    but the doctor UI no longer exposes a button. Use
    ``/documents/{doc_id}/translate-region`` with a full-page bbox
    (x=0, y=0, w=1, h=1) instead — that path is rate-limited the same
    way and lets the doctor pick which page to translate.
    """
    cfg = get_config()
    doc = await _ensure_doc_in_share(db, session["share_id"], doc_id)
    if not (doc.get("ocr_text") or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Document has not been OCR'd yet, so translation is unavailable.",
        )

    allowed, retry_after = translate_allowed(
        session_id=session["id"],
        share_id=session["share_id"],
        debounce_seconds=cfg.share.translate_per_session_seconds,
        per_share_per_hour=cfg.share.translate_per_share_per_hour,
    )
    if not allowed:
        return Response(
            status_code=429,
            headers={"Retry-After": str(retry_after)},
            content=f'{{"detail":"Try again in {retry_after}s"}}',
            media_type="application/json",
        )

    queue = getattr(request.app.state, "pipeline_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="Pipeline worker not running")

    from asclepius.pipeline.watcher import enqueue_job

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

    allowed_languages = list(cfg.llm.translation_allowed_languages) or ["English"]
    target_language = body.target_language or cfg.llm.translation_target_language or "English"
    if target_language not in allowed_languages:
        raise HTTPException(
            status_code=400,
            detail=f"Language '{target_language}' is not in the configured allow-list",
        )

    enqueue_job(
        queue,
        "translate",
        {
            "doc_id": doc_id,
            "llm_provider_id": body.llm_provider_id,
            "resolved_providers": queued_providers,
            "target_language": target_language,
        },
        priority=0,
        queued_doc_id=doc_id,
        queued_label=doc.get("original_filename") or f"doc#{doc_id}",
        queued_providers=queued_providers,
    )

    await share_service.write_audit(
        db,
        share_id=session["share_id"],
        action="translate",
        session_id=session["id"],
        document_id=doc_id,
        client_ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        detail={"kind": "full", "target_language": target_language},
    )

    return {"status": "queued", "document_id": doc_id}


@router.post("/documents/{doc_id}/translate-region")
async def share_translate_region(
    doc_id: int,
    body: ShareTranslateRegionRequest,
    request: Request,
    session: dict = Depends(get_share_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Region translate — same behaviour as the admin endpoint, scoped
    to the share and rate-limited like ``share_translate``.

    Provider resolution order (each falls through if missing):
    1. The body override sent by the doctor's UI.
    2. The per-share defaults the admin saved at share-creation time.
    3. The system's first-enabled provider.
    """
    cfg = get_config()
    doc = await _ensure_doc_in_share(db, session["share_id"], doc_id)
    if not doc.get("file_path"):
        raise HTTPException(
            status_code=400,
            detail="Document has no file to crop.",
        )

    # Pull the share row so we can read the per-share provider defaults.
    share_row = await share_service.get_share_by_id(db, session["share_id"])
    share_default_ocr = (share_row or {}).get("default_ocr_provider_id") or None
    share_default_llm = (share_row or {}).get("default_llm_provider_id") or None

    allowed, retry_after = translate_allowed(
        session_id=session["id"],
        share_id=session["share_id"],
        debounce_seconds=cfg.share.translate_per_session_seconds,
        per_share_per_hour=cfg.share.translate_per_share_per_hour,
    )
    if not allowed:
        return Response(
            status_code=429,
            headers={"Retry-After": str(retry_after)},
            content=f'{{"detail":"Try again in {retry_after}s"}}',
            media_type="application/json",
        )

    queue = getattr(request.app.state, "pipeline_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="Pipeline worker not running")

    from asclepius.pipeline.watcher import enqueue_job

    def _first_enabled(items):
        enabled = [p for p in items if getattr(p, "enabled", False)]
        if enabled:
            return min(enabled, key=lambda p: getattr(p, "priority", 0))
        return items[0] if items else None

    # Provider resolution ladder:
    #   1. body override (the doctor's UI does not expose this; reserved
    #      for the admin-side region translate)
    #   2. per-share default the admin set when creating the share
    #   3. system-wide translation default (settings page)
    #   4. first-enabled provider in the system
    queued_providers: dict[str, str | None] = {}
    ocr_id = body.ocr_provider_id or share_default_ocr or (cfg.ocr.translation_provider_id or None)
    if not ocr_id:
        p = _first_enabled(cfg.ocr.providers)
        ocr_id = p.id if p else None
    if ocr_id:
        queued_providers["ocr"] = ocr_id
    llm_id = body.llm_provider_id or share_default_llm or (cfg.llm.translation_provider_id or None)
    if not llm_id:
        p = _first_enabled(cfg.llm.providers)
        llm_id = p.id if p else None
    if llm_id:
        queued_providers["llm"] = llm_id

    # Target-language resolution: doctor's pick -> admin default -> "English".
    # Validated against the admin allow-list so a tampered request can't
    # ask for an unsupported language.
    allowed_languages = list(cfg.llm.translation_allowed_languages) or ["English"]
    target_language = body.target_language or cfg.llm.translation_target_language or "English"
    if target_language not in allowed_languages:
        raise HTTPException(
            status_code=400,
            detail=f"Language '{target_language}' is not in the configured allow-list",
        )

    cursor = await db.execute(
        """INSERT INTO region_translations
              (document_id, page, bbox_x, bbox_y, bbox_w, bbox_h,
               ocr_provider_id, llm_provider_id, target_language)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            doc_id,
            body.page,
            body.bbox.x,
            body.bbox.y,
            body.bbox.w,
            body.bbox.h,
            ocr_id,
            llm_id,
            target_language,
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
            # Pass the resolved IDs (including share defaults) to the
            # worker, not the raw body — otherwise the per-share defaults
            # would be silently dropped and the worker would re-resolve
            # to the system default.
            "ocr_provider_id": ocr_id,
            "llm_provider_id": llm_id,
            "resolved_providers": queued_providers,
            "target_language": target_language,
        },
        priority=0,
        queued_doc_id=doc_id,
        queued_label=doc.get("original_filename") or f"doc#{doc_id}",
        queued_providers=queued_providers,
    )

    await share_service.write_audit(
        db,
        share_id=session["share_id"],
        action="translate",
        session_id=session["id"],
        document_id=doc_id,
        client_ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        detail={
            "kind": "region",
            "region_id": region_row_id,
            "target_language": target_language,
        },
    )

    return {"status": "queued", "document_id": doc_id, "region_id": region_row_id}
