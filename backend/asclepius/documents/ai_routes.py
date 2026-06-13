"""Document AI editing and filename generation routes."""

import logging
import re
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.authz import require_document_access
from asclepius.documents.service import (
    get_document,
    update_document_fields,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class DocumentEditRequest(BaseModel):
    instruction: str
    # Phase B fields: set on the second submit, after the frontend has
    # shown the user the picker spawned by the Phase-A
    # ``status: needs_ocr_choice`` response. All three are None / False
    # on the first submit.
    #
    # ``re_run_ocr`` toggles between two paths inside the scoped page
    # reprocess: re-render and OCR the requested pages from the PDF
    # with ``ocr_provider_id``, or use the cached OCR text already in
    # ``ocr_page_cache`` for those pages. Either way the LLM
    # re-extraction runs against the chosen ``llm_provider_id``.
    ocr_provider_id: str | None = None
    llm_provider_id: str | None = None
    re_run_ocr: bool = False


# Anchored on "page(s)" or "p./pp." so unrelated digits in the instruction
# (dates, dosages, lab values) don't get treated as page references.
_PAGE_REF_RE = re.compile(
    r"\b(?:pages?|pp?\.?)\s+" r"((?:\d+(?:\s*[-–—]\s*\d+)?(?:\s*(?:,|and|through|to|&)\s*)?)+)",
    re.IGNORECASE,
)
_PAGE_RANGE_SEP_RE = re.compile(r"\s*(?:to|through|[-–—])\s*", re.IGNORECASE)
_PAGE_LIST_SEP_RE = re.compile(r"\s*(?:and|&|,)\s*", re.IGNORECASE)
_PAGE_RANGE_RE = re.compile(r"^(\d+)-(\d+)$")


def _parse_pages_from_instruction(text: str, max_pages: int) -> list[int]:
    """Return sorted, 1-indexed page numbers referenced in an instruction.

    Recognises ``page 41``, ``pages 12-15``, ``pages 12 to 15``,
    ``pages 3, 7 and 9``, ``p. 41``. Numbers outside ``[1, max_pages]``
    are dropped; an empty list means no page reference was detected.
    """
    if not text or max_pages < 1:
        return []
    pages: set[int] = set()
    for match in _PAGE_REF_RE.finditer(text):
        chunk = match.group(1)
        # Collapse range separators (to / through / - / – / —) to "-" first,
        # then list separators (and / & / ,) to "," so "12 to 15" becomes
        # "12-15" (a range) instead of "12,15" (two pages).
        chunk = _PAGE_RANGE_SEP_RE.sub("-", chunk)
        chunk = _PAGE_LIST_SEP_RE.sub(",", chunk)
        for piece in chunk.split(","):
            piece = piece.strip()
            if not piece:
                continue
            rng = _PAGE_RANGE_RE.match(piece)
            if rng:
                lo, hi = int(rng.group(1)), int(rng.group(2))
                if lo > hi:
                    lo, hi = hi, lo
                pages.update(range(lo, hi + 1))
            elif piece.isdigit():
                pages.add(int(piece))
    return sorted(p for p in pages if 1 <= p <= max_pages)


@router.post("/{doc_id}/edit-with-ai")
async def edit_document_with_ai(
    doc_id: int,
    body: DocumentEditRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Edit a document via natural-language instruction.

    Two modes, dispatched by the instruction itself:

    1. **Scoped page reprocess** — when the instruction references explicit
       pages (``page 41``, ``pages 12-15``, …). The cached per-page OCR for
       those pages is fed to the pipeline extractor, which wipes every child
       row (lab_results, encounters, medications, vaccinations, invoice_items)
       and re-inserts from the new extraction. Document metadata fields are
       overwritten only where the scoped extraction returned a value, so
       fields outside the chosen pages survive.
    2. **Metadata edit** — fallback path. A compact JSON-only prompt asks
       the general LLM to return just the fields the user asked to change.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    await require_document_access(db, doc, current_user, write=True)

    config = get_config()

    # Mode 1: scoped page reprocess. Page references in the instruction are
    # the trigger — if the user just says "doctor is Dr. X" we fall through
    # to the metadata-edit path below. Parse without an upper bound so the
    # scoped helper can return a clean "page X doesn't exist" error instead
    # of silently routing to metadata edit when the user asked for a page
    # that's out of range.
    requested_pages = _parse_pages_from_instruction(body.instruction, 99999)
    if requested_pages:
        page_count = int(doc.get("page_count") or 0)
        return await _scoped_page_reprocess(
            db,
            doc,
            doc_id,
            requested_pages,
            page_count,
            body.ocr_provider_id,
            body.llm_provider_id,
            body.re_run_ocr,
            config,
            request,
            instruction=body.instruction,
        )

    from asclepius.pipeline.provider_factory import _build_general_llm_provider
    from asclepius.pipeline.extractor import build_extraction_context
    import json as _json
    import asyncio as _asyncio

    llm = _build_general_llm_provider(config)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail="General LLM is not configured. Set it under Settings → Document Analysis → General.",
        )
    context = await build_extraction_context(db)

    # Build a compact current data summary (only non-null fields)
    current_data = {
        k: v
        for k, v in {
            "patient_name": doc.get("patient_name"),
            "doc_type": doc.get("doc_type"),
            "event_date": doc.get("event_date"),
            "issued_date": doc.get("issued_date"),
            "doctor_name": doc.get("doctor_name"),
            "facility_name": doc.get("facility_name"),
            "specialty_original": doc.get("specialty_original"),
            "summary_en": doc.get("summary_en"),
        }.items()
        if v
    }

    # Compact prompt
    prompt = (
        "You are editing a medical document's metadata. The user wants to make changes.\n\n"
        f"Current data: {_json.dumps(current_data)}\n\n"
        f"Known patients: {_json.dumps([p.get('name','') for p in context.get('patient_list', [])[:20]])}\n\n"
        f'User instruction: "{body.instruction}"\n\n'
        "Return ONLY a JSON object with the fields that should change. Use these field names:\n"
        "- patient_name, doc_type, event_date (YYYY-MM-DD), issued_date (YYYY-MM-DD)\n"
        '- doctor_name (string, e.g. "Dr. Bianchi")\n'
        '- facility_name (string, e.g. "Ospedale Civico")\n'
        "- specialty_original\n"
        "- summary_en, summary_original\n\n"
        "Only include fields the user mentioned. JSON only, no explanation."
    )

    # Call LLM with retry for rate limits
    for attempt in range(3):
        try:
            if hasattr(llm, "_generate"):
                response_text = await llm._generate(prompt)
                changes = llm._parse_json(response_text)
            else:
                raise HTTPException(
                    status_code=500, detail="LLM provider does not support direct generation"
                )
            break
        except Exception as e:
            if "429" in str(e) or "rate_limit" in str(e):
                wait = 30 * (attempt + 1)
                await _asyncio.sleep(wait)
                if attempt == 2:
                    raise HTTPException(
                        status_code=429, detail="Rate limited \u2014 please try again in a minute"
                    )
            else:
                raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

    if "error" in changes:
        raise HTTPException(status_code=500, detail=changes.get("error"))

    # Apply changes directly to the documents table
    updates = {}
    if "doc_type" in changes:
        updates["doc_type"] = changes["doc_type"]
    # Accept both new (event_date/issued_date) and legacy (doc_date/date_visit/
    # date_issued) LLM outputs, collapsing the three-field schema with the
    # historic priority rule: date_visit > date_issued > doc_date.
    if "event_date" in changes:
        updates["event_date"] = changes["event_date"]
    elif any(k in changes for k in ("date_visit", "date_issued", "doc_date")):
        updates["event_date"] = (
            changes.get("date_visit") or changes.get("date_issued") or changes.get("doc_date")
        )
    if "issued_date" in changes:
        updates["issued_date"] = changes["issued_date"]
    elif "date_issued" in changes:
        updates["issued_date"] = changes["date_issued"]
    if "summary_en" in changes:
        updates["summary_en"] = changes["summary_en"]
    if "summary_original" in changes:
        updates["summary_original"] = changes["summary_original"]
    if "specialty_original" in changes.get("specialty", changes):
        updates["specialty_original"] = changes.get("specialty", {}).get(
            "original", changes.get("specialty_original")
        )

    # Handle patient name change
    if "patient_name" in changes:
        from asclepius.pipeline.extractor import _match_patient

        patient_id = await _match_patient(db, changes["patient_name"])
        if patient_id:
            updates["patient_id"] = patient_id

    # Handle doctor change
    doctor_data = changes.get("doctor")
    doctor_name_str = changes.get("doctor_name")
    if isinstance(doctor_data, str):
        doctor_name_str = doctor_data
        doctor_data = None
    if doctor_data and isinstance(doctor_data, dict) and doctor_data.get("name"):
        from asclepius.pipeline.extractor import _upsert_doctor

        updates["doctor_id"] = await _upsert_doctor(db, doctor_data)
    elif doctor_name_str:
        from asclepius.pipeline.extractor import _upsert_doctor

        updates["doctor_id"] = await _upsert_doctor(db, {"name": doctor_name_str})

    # Handle facility change
    facility_data = changes.get("facility")
    facility_name_str = changes.get("facility_name")
    if isinstance(facility_data, str):
        facility_name_str = facility_data
        facility_data = None
    if facility_data and isinstance(facility_data, dict) and facility_data.get("name"):
        from asclepius.pipeline.extractor import _upsert_facility

        updates["facility_id"] = await _upsert_facility(db, facility_data)
    elif facility_name_str:
        from asclepius.pipeline.extractor import _upsert_facility

        updates["facility_id"] = await _upsert_facility(db, {"name": facility_name_str})

    if updates:
        # Log corrections before applying updates
        from asclepius.documents.corrections import log_corrections

        await log_corrections(db, doc_id, updates)

        await update_document_fields(db, doc_id, updates)

    return {"status": "updated", "mode": "metadata", "document_id": doc_id, "changes": changes}


async def _scoped_page_reprocess(
    db: aiosqlite.Connection,
    doc: dict,
    doc_id: int,
    requested_pages: list[int],
    page_count: int,
    ocr_provider_id: str | None,
    llm_provider_id: str | None,
    re_run_ocr: bool,
    config,
    request: Request,
    *,
    instruction: str = "",
) -> dict:
    """Two-phase scoped page reprocess.

    Phase A — when neither ``re_run_ocr`` nor ``llm_provider_id`` has been
    set yet (initial submit): validate the requested pages against the
    document's real ``page_count``, attach cache stats so the frontend
    knows whether a re-OCR is required, and return
    ``status='needs_ocr_choice'`` with the available OCR + LLM providers.

    Phase B — second submit: enqueue an ``ai_edit`` job for the pipeline
    worker and return ``status='queued'`` immediately. The worker calls
    ``ai_edit_document`` which either re-OCRs the chosen pages with the
    selected OCR provider (``re_run_ocr=True``) and refreshes the cache,
    or pulls the cached OCR. Either way the LLM extraction runs against
    ``llm_provider_id`` (or the highest-priority enabled LLM if not
    specified). Child rows (lab_results, encounters, medications,
    vaccinations, invoice_items) get wiped and re-inserted, so the
    user's "reprocess page 41 for labs" yields labs from page 41 and
    nothing else. Running on the worker keeps the HTTP request short
    (otherwise a 5-page Chandra OCR run would hold the request open
    long enough for any reverse proxy to return 502).
    """
    from asclepius.pipeline.ocr import list_llm_providers, list_ocr_providers
    from asclepius.pipeline.watcher import enqueue_job

    total_pages = page_count if page_count and page_count > 0 else 0
    if total_pages <= 0:
        # Legacy doc with no page_count — fall back to counting cached
        # OCR rows just so we can produce a sensible upper bound. Fresh
        # ingests always populate page_count.
        cursor = await db.execute(
            "SELECT MAX(page_number) FROM ocr_page_cache WHERE document_id = ?",
            (doc_id,),
        )
        row = await cursor.fetchone()
        total_pages = int(row[0]) if row and row[0] else 0

    in_range = [p for p in requested_pages if 1 <= p <= total_pages] if total_pages else []
    out_of_range = [p for p in requested_pages if p not in in_range]
    if not in_range:
        raise HTTPException(
            status_code=400,
            detail=(
                f"None of the requested pages exist — document has "
                f"{total_pages or 'an unknown number of'} page(s), instruction "
                f"referenced {requested_pages}."
            ),
        )

    # Inspect the existing cache so the picker can default sensibly:
    # if any requested page isn't cached, the user almost always wants
    # to re-OCR.
    cursor = await db.execute(
        "SELECT page_number FROM ocr_page_cache WHERE document_id = ? "
        "AND page_number IN (" + ",".join(["?"] * len(in_range)) + ")",
        (doc_id, *in_range),
    )
    cached_page_set = {int(r[0]) for r in await cursor.fetchall()}
    cached_in_range = sorted(p for p in in_range if p in cached_page_set)
    missing_from_cache = sorted(p for p in in_range if p not in cached_page_set)

    # Phase A — first submit: ask the user whether to re-OCR and (if so)
    # which OCR engine, plus which LLM should re-extract.
    is_phase_a = not re_run_ocr and not llm_provider_id and not ocr_provider_id
    if is_phase_a:
        return {
            "status": "needs_ocr_choice",
            "mode": "pages",
            "document_id": doc_id,
            "pages": in_range,
            "out_of_range_pages": out_of_range,
            "page_count": total_pages,
            "cached_pages": cached_in_range,
            "missing_from_cache": missing_from_cache,
            "recommend_re_run_ocr": bool(missing_from_cache),
            "ocr_providers": list_ocr_providers(config),
            "llm_providers": list_llm_providers(config),
        }

    if re_run_ocr and not ocr_provider_id:
        raise HTTPException(
            status_code=400,
            detail="re_run_ocr=true requires ocr_provider_id.",
        )

    # Validate provider ids against the live config so the user gets a
    # crisp error here instead of a generic worker failure later.
    if llm_provider_id and not any(
        p.id == llm_provider_id and p.enabled for p in config.llm.providers
    ):
        raise HTTPException(
            status_code=400,
            detail=f"LLM provider '{llm_provider_id}' is not configured or disabled.",
        )
    if ocr_provider_id and not any(
        p.id == ocr_provider_id and p.enabled for p in config.ocr.providers
    ):
        raise HTTPException(
            status_code=400,
            detail=f"OCR provider '{ocr_provider_id}' is not configured or disabled.",
        )

    # ``documents.file_path`` is vault-relative; verify the file exists
    # before queuing so the user gets a sync error rather than a silent
    # worker failure.
    rel_path = doc.get("file_path") or ""
    if re_run_ocr and not rel_path:
        raise HTTPException(
            status_code=400,
            detail="Document has no file on disk to re-OCR.",
        )
    if re_run_ocr and not (Path(config.vault.root_path) / rel_path).exists():
        raise HTTPException(
            status_code=400,
            detail=f"File not found on disk: {rel_path}",
        )

    # Surface the LLM credential id for the queued-jobs preview.
    llm_cred_id: str | None = None
    if llm_provider_id:
        for entry in config.llm.providers:
            if entry.id == llm_provider_id:
                llm_cred_id = entry.credential_id or entry.id or None
                break

    queue = getattr(request.app.state, "pipeline_queue", None)
    if queue is None:
        raise HTTPException(status_code=503, detail="Pipeline worker not running")

    enqueue_job(
        queue,
        "ai_edit",
        {
            "doc_id": doc_id,
            "requested_pages": in_range,
            "page_count": total_pages,
            "ocr_provider_id": ocr_provider_id,
            "llm_provider_id": llm_provider_id,
            "re_run_ocr": re_run_ocr,
            # Pass the user's natural-language instruction so the worker
            # can detect intent ("lab tests" / "medications" / …) and
            # route to the matching ``extraction_<doc_type>.yaml``
            # focused prompt.
            "instruction": instruction,
        },
        priority=0,  # user-initiated, jump the inbox queue
        queued_doc_id=doc_id,
        queued_label=doc.get("original_filename") or f"doc#{doc_id}",
        queued_providers={
            "ocr": ocr_provider_id or None,
            "llm": llm_cred_id,
        },
    )
    return {
        "status": "queued",
        "mode": "pages",
        "document_id": doc_id,
        "pages": in_range,
        "out_of_range_pages": out_of_range,
        "page_count": total_pages,
        "re_run_ocr": re_run_ocr,
        "ocr_provider_id": ocr_provider_id,
        "llm_provider_id": llm_provider_id,
    }


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

    await require_document_access(db, doc, current_user)

    # Mirror whatever extension (or lack of one) the original has. Imaging
    # placeholders carry names like "MR Brain (report pending)" with no
    # extension at all; using a ``.pdf`` fallback here would force-suggest a
    # name that the rename endpoint then rejects ("can't change extension
    # from '' to '.pdf'"), so suggest the same suffix the doc already has.
    ext = Path(doc.get("original_filename") or "").suffix.lower()

    # Look for a date across every plausible source. raw_extraction is the
    # last resort — LLM output that never landed on a dedicated column. The
    # raw_extraction JSON can carry either the new event_date or the legacy
    # date_visit / date_issued / doc_date trio.
    doc_date = doc.get("event_date") or doc.get("issued_date") or doc.get("date_received") or ""
    if not doc_date and doc.get("raw_extraction"):
        import json as _json

        try:
            raw = doc["raw_extraction"]
            if isinstance(raw, str):
                raw = _json.loads(raw)
            for k in ("event_date", "date_visit", "date_issued", "doc_date", "issued_date"):
                v = raw.get(k) if isinstance(raw, dict) else None
                if v:
                    doc_date = v
                    break
        except Exception:
            pass

    # Normalize to YYYYMMDD. Accept strings only; guard against any weirdness.
    date_prefix = "00000000"
    if doc_date and isinstance(doc_date, str):
        digits = re.sub(r"\D", "", doc_date)[:8]
        if len(digits) == 8:
            date_prefix = digits

    # Use LLM to generate a concise, descriptive name
    from asclepius.pipeline.organizer import generate_ai_filename
    from asclepius.pipeline.provider_factory import _build_general_llm_provider

    config = get_config()
    llm = _build_general_llm_provider(config)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail="General LLM is not configured. Set it under Settings → Document Analysis → General.",
        )

    doc_meta = {
        "doc_type": doc.get("doc_type"),
        "event_date": doc_date,
        "doctor_name": doc.get("doctor_name"),
        "facility_name": doc.get("facility_name"),
        "summary_en": doc.get("summary_en"),
    }

    slug = await generate_ai_filename(llm, doc_meta)

    # Fallback if LLM fails
    if not slug:
        fallback = doc.get("doc_type") or "document"
        slug = re.sub(r"[^a-z0-9]+", "-", fallback.lower()).strip("-")

    # Strip any date the LLM may have snuck into its slug so we don't end up
    # with "20240315_20240315-blood-test.pdf".
    slug = re.sub(r"^\d{4}[-_]?\d{2}[-_]?\d{2}[-_]*", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-") or "document"

    suggested = f"{date_prefix}_{slug}{ext}"
    logger.info(
        "generate_filename doc=%d date_prefix=%s slug=%s suggested=%s",
        doc_id,
        date_prefix,
        slug,
        suggested,
    )
    return {"suggested_filename": suggested}
