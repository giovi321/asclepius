"""Document linking and relevance routes."""

import logging

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.authz import require_document_access
from asclepius.documents.service import (
    get_document,
    get_document_links,
)
from asclepius.patients.service import check_patient_access

logger = logging.getLogger(__name__)

router = APIRouter()


class DocumentLinkRequest(BaseModel):
    target_document_id: int
    link_type: str  # 'invoice_for', 'report_for', 'imaging_for', 'follow_up', 'related'


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
        raise HTTPException(
            status_code=400, detail=f"Invalid link_type. Must be one of: {valid_types}"
        )

    if doc_id == body.target_document_id:
        raise HTTPException(status_code=400, detail="Cannot link a document to itself")

    # Verify both documents exist
    source = await get_document(db, doc_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source document not found")
    target = await get_document(db, body.target_document_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target document not found")

    # The caller must be able to see BOTH documents, otherwise linking would
    # leak the existence (and, via GET /links, the metadata) of a document on
    # another patient's chart.
    await require_document_access(db, source, current_user)
    await require_document_access(db, target, current_user)

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
        return {
            "id": cursor.lastrowid,
            "source_document_id": doc_id,
            "target_document_id": body.target_document_id,
            "link_type": body.link_type,
        }
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

    await require_document_access(db, doc, current_user)

    return await get_document_links(db, doc_id)


@router.delete("/{doc_id}/links/{link_id}")
async def delete_link(
    doc_id: int,
    link_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Remove a document link."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await require_document_access(db, doc, current_user)

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
        raise HTTPException(
            status_code=400, detail="Document has no patient assigned — cannot suggest links"
        )

    # Check access
    role = await check_patient_access(db, current_user["id"], doc["patient_id"])
    if not role:
        raise HTTPException(status_code=403, detail="No access")

    # Get all other documents for the same patient
    cursor = await db.execute(
        """SELECT d.id, d.doc_type, d.event_date, d.summary_en, d.original_filename,
                  doc.name as doctor_name, f.name as facility_name
           FROM documents d
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           WHERE d.patient_id = ? AND d.id != ? AND d.status = 'done'
           ORDER BY d.event_date DESC
           LIMIT 50""",
        (doc["patient_id"], doc_id),
    )
    rows = await cursor.fetchall()
    other_docs = [dict(r) for r in rows]

    if not other_docs:
        return {"suggestions": []}

    # Format other documents for the prompt
    other_docs_text = "\n".join(
        f"- ID: {d['id']}, Type: {d.get('doc_type', 'unknown')}, Date: {d.get('event_date', 'unknown')}, "
        f"Doctor: {d.get('doctor_name', 'unknown')}, Facility: {d.get('facility_name', 'unknown')}, "
        f"Summary: {d.get('summary_en', 'N/A')}"
        for d in other_docs
    )

    from asclepius.llm.prompts import LINK_SUGGESTION_PROMPT
    from asclepius.pipeline.provider_factory import _build_general_llm_provider

    config = get_config()
    llm = _build_general_llm_provider(config)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail="General LLM is not configured. Set it under Settings → Document Analysis → General.",
        )

    prompt = LINK_SUGGESTION_PROMPT.format(
        doc_id=doc_id,
        doc_type=doc.get("doc_type", "unknown"),
        doc_date=doc.get("event_date", "unknown"),
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
            raise HTTPException(
                status_code=500, detail="LLM provider does not support direct generation"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

    suggestions = result.get("suggestions", [])

    # Validate that suggested document IDs actually exist in the other_docs list
    valid_ids = {d["id"] for d in other_docs}
    valid_link_types = {"invoice_for", "report_for", "imaging_for", "follow_up", "related"}
    validated = [
        s
        for s in suggestions
        if s.get("document_id") in valid_ids and s.get("link_type") in valid_link_types
    ]

    # Enrich each suggestion with document info
    docs_by_id = {d["id"]: d for d in other_docs}
    for s in validated:
        info = docs_by_id.get(s["document_id"], {})
        s["filename"] = info.get("original_filename")
        s["doc_type"] = info.get("doc_type")
        s["event_date"] = info.get("event_date")
        s["summary_en"] = info.get("summary_en")
        s["doctor_name"] = info.get("doctor_name")
        s["facility_name"] = info.get("facility_name")

    return {"suggestions": validated}


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
    existing_links = await get_document_links(db, doc_id)
    linked_ids = set()
    for link in existing_links:
        linked_ids.add(link["source_document_id"])
        linked_ids.add(link["target_document_id"])

    # Get all other documents for the same patient
    cursor = await db.execute(
        """SELECT d.id, d.doc_type, d.event_date, d.summary_en, d.original_filename,
                  doc.name as doctor_name, f.name as facility_name
           FROM documents d
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           WHERE d.patient_id = ? AND d.id != ? AND d.status = 'done'
           ORDER BY d.event_date DESC
           LIMIT 50""",
        (doc["patient_id"], doc_id),
    )
    rows = await cursor.fetchall()
    other_docs = [dict(r) for r in rows if r["id"] not in linked_ids]

    if not other_docs:
        return {"suggestions": []}

    other_docs_text = "\n".join(
        f"- ID: {d['id']}, Type: {d.get('doc_type', 'unknown')}, Date: {d.get('event_date', 'unknown')}, "
        f"Doctor: {d.get('doctor_name', 'unknown')}, Facility: {d.get('facility_name', 'unknown')}, "
        f"Summary: {d.get('summary_en', 'N/A')}"
        for d in other_docs
    )

    from asclepius.llm.prompts import LINK_SUGGESTION_PROMPT
    from asclepius.pipeline.provider_factory import _build_general_llm_provider

    config = get_config()
    llm = _build_general_llm_provider(config)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail="General LLM is not configured. Set it under Settings → Document Analysis → General.",
        )

    prompt = LINK_SUGGESTION_PROMPT.format(
        doc_id=doc_id,
        doc_type=doc.get("doc_type", "unknown"),
        doc_date=doc.get("event_date", "unknown"),
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
            s["event_date"] = d.get("event_date")
            s["doctor_name"] = d.get("doctor_name")
            s["facility_name"] = d.get("facility_name")
            s["summary_en"] = d.get("summary_en")

        return {"suggestions": suggestions}
    except Exception:
        logger.exception("Failed to get relevant documents for doc %d", doc_id)
        return {"suggestions": []}
