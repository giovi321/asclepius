"""Document AI editing and filename generation routes."""

import logging
import re
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import get_document, update_document_fields

logger = logging.getLogger(__name__)

router = APIRouter()


class DocumentEditRequest(BaseModel):
    instruction: str


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
    from asclepius.pipeline.extractor import build_extraction_context
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

    # Compact prompt
    prompt = (
        "You are editing a medical document's metadata. The user wants to make changes.\n\n"
        f"Current data: {_json.dumps(current_data)}\n\n"
        f"Known patients: {_json.dumps([p.get('name','') for p in context.get('patient_list', [])[:20]])}\n\n"
        f'User instruction: "{body.instruction}"\n\n'
        "Return ONLY a JSON object with the fields that should change. Use these field names:\n"
        "- patient_name, doc_type, doc_date (YYYY-MM-DD), date_issued, date_visit\n"
        '- doctor_name (string, e.g. "Dr. Bianchi")\n'
        '- facility_name (string, e.g. "Ospedale Civico")\n'
        "- specialty_original\n"
        "- summary_en, summary_original\n\n"
        "Only include fields the user mentioned. JSON only, no explanation."
    )

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
                    raise HTTPException(status_code=429, detail="Rate limited \u2014 please try again in a minute")
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

    # Handle facility change
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
        # Log corrections before applying updates
        from asclepius.documents.corrections import log_corrections
        await log_corrections(db, doc_id, updates)

        await update_document_fields(db, doc_id, updates)

    return {"status": "updated", "document_id": doc_id, "changes": changes}


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

    # Look for a date across every plausible source. raw_extraction is the last
    # resort — LLM output that never landed on a dedicated column.
    doc_date = (
        doc.get("date_visit")
        or doc.get("date_issued")
        or doc.get("doc_date")
        or doc.get("date_received")
        or ""
    )
    if not doc_date and doc.get("raw_extraction"):
        import json as _json
        try:
            raw = doc["raw_extraction"]
            if isinstance(raw, str):
                raw = _json.loads(raw)
            for k in ("date_visit", "date_issued", "doc_date"):
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

    # Strip any date the LLM may have snuck into its slug so we don't end up
    # with "20240315_20240315-blood-test.pdf".
    slug = re.sub(r"^\d{4}[-_]?\d{2}[-_]?\d{2}[-_]*", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-") or "document"

    suggested = f"{date_prefix}_{slug}{ext}"
    logger.info(
        "generate_filename doc=%d date_prefix=%s slug=%s suggested=%s",
        doc_id, date_prefix, slug, suggested,
    )
    return {"suggested_filename": suggested}
