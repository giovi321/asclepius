"""Main pipeline processor — orchestrates OCR, LLM extraction, and file organization."""

import json
import logging
import os
from pathlib import Path

import aiosqlite

from asclepius.config import AppConfig
from asclepius.db.connection import get_db
from asclepius.documents.service import compute_file_hash
from asclepius.pipeline.ocr import extract_text
from asclepius.pipeline.extractor import classify_and_extract, extract_and_store
from asclepius.pipeline.organizer import build_organized_path, move_file

logger = logging.getLogger(__name__)

# Pipeline status tracking (in-memory)
pipeline_status = {
    "queue_depth": 0,
    "processing": None,
    "processing_step": None,  # 'ocr', 'llm_extraction', 'organizing'
    "processing_doc_id": None,
    "processing_pages": None,
    "processing_page_current": None,
    "last_processed": None,
    "total_processed": 0,
    "total_errors": 0,
    "recent_errors": [],
    "queued_files": [],  # list of {filename, size} in queue
}

# Set of doc IDs that have been requested for cancellation
cancelled_docs: set[int] = set()


def get_llm_provider(config: AppConfig):
    """Factory function to get the configured LLM provider."""
    if config.llm.provider == "claude" and config.llm.claude_api_key:
        from asclepius.llm.claude import ClaudeProvider
        return ClaudeProvider(
            api_key=config.llm.claude_api_key,
            model=config.llm.claude_model,
            timeout=config.llm.extraction_timeout,
        )
    else:
        from asclepius.llm.ollama import OllamaProvider
        return OllamaProvider(
            base_url=config.llm.ollama_base_url,
            model=config.llm.ollama_model,
            timeout=config.llm.extraction_timeout,
        )


def _count_pages(file_path: str) -> int | None:
    """Try to count pages in a PDF file. Returns None for non-PDFs or on error."""
    path = Path(file_path)
    if path.suffix.lower() != ".pdf":
        return None
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(str(path))
        count = len(doc)
        doc.close()
        return count
    except Exception:
        try:
            # Fallback: try pikepdf
            import pikepdf
            pdf = pikepdf.open(str(path))
            count = len(pdf.pages)
            pdf.close()
            return count
        except Exception:
            return None


async def process_file(file_path: str, config: AppConfig) -> None:
    """Process a single file through the full pipeline."""
    path = Path(file_path)
    if not path.exists():
        logger.warning("File no longer exists: %s", file_path)
        return

    pipeline_status["processing"] = path.name
    pipeline_status["processing_step"] = None
    pipeline_status["processing_doc_id"] = None
    pipeline_status["processing_pages"] = None
    pipeline_status["processing_page_current"] = None
    pipeline_status["queue_depth"] = max(0, pipeline_status["queue_depth"] - 1)

    logger.info("Processing: %s", path.name)

    async with aiosqlite.connect(config.database.path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        try:
            # Compute file hash and size for dedup
            file_hash = compute_file_hash(file_path)
            file_size = os.path.getsize(file_path)
            page_count = _count_pages(file_path)

            ext = path.suffix.lower()

            # DICOM path (handle before dedup since DICOM has its own logic)
            if ext in {".dcm", ".dicom"}:
                from asclepius.pipeline.dicom_ingest import process_dicom
                doc_id = await process_dicom(file_path, config, db)
                if doc_id:
                    pipeline_status["total_processed"] += 1
                    pipeline_status["last_processed"] = path.name
                return

            # Read hint files from upload (if present)
            hint_patient_id = None
            hint_event_id = None
            for hint_name, hint_var in [(".patient_hint", "patient"), (".event_hint", "event")]:
                hint_path = Path(str(path) + hint_name)
                if hint_path.exists():
                    try:
                        val = int(hint_path.read_text().strip())
                        if hint_var == "patient":
                            hint_patient_id = val
                        else:
                            hint_event_id = val
                    except (ValueError, OSError):
                        pass
                    hint_path.unlink(missing_ok=True)

            # Try to INSERT — if file_hash already exists (from upload), it'll be ignored
            await db.execute(
                """INSERT OR IGNORE INTO documents
                   (file_path, original_filename, file_hash, file_size, page_count,
                    patient_id, event_id, date_received, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, DATE('now'), 'pending')""",
                (f"inbox/{path.name}", path.name, file_hash, file_size, page_count, hint_patient_id, hint_event_id),
            )
            await db.commit()

            # Now SELECT the record (whether just inserted or pre-existing from upload)
            cursor = await db.execute(
                "SELECT id, status, patient_id, event_id FROM documents WHERE file_hash = ?", (file_hash,),
            )
            existing = await cursor.fetchone()
            if not existing:
                logger.error("Failed to find/create document record for: %s", path.name)
                return

            if existing["status"] == "done":
                logger.info("Already processed (doc %d), skipping: %s", existing["id"], path.name)
                path.unlink()
                return

            doc_id = existing["id"]

            # Ensure patient_id and event_id are set even if pipeline created the record first
            extra_updates = ""
            params = [file_size, page_count]
            if hint_patient_id and not existing["patient_id"]:
                extra_updates += ", patient_id = ?"
                params.append(hint_patient_id)
            if hint_event_id and not existing["event_id"]:
                extra_updates += ", event_id = ?"
                params.append(hint_event_id)
            params.append(doc_id)

            await db.execute(
                f"""UPDATE documents SET status = 'processing', file_size = ?, page_count = ?{extra_updates},
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                params,
            )
            await db.commit()
            logger.info("Processing doc %d (patient=%s, event=%s): %s",
                        doc_id, existing["patient_id"] or hint_patient_id,
                        existing["event_id"] or hint_event_id, path.name)

            ext = path.suffix.lower()
            if ext in {".dcm", ".dicom"}:
                from asclepius.pipeline.dicom_ingest import process_dicom
                await process_dicom(file_path, config, db)
                pipeline_status["total_processed"] += 1
                pipeline_status["last_processed"] = path.name
                return

            # Check cancellation
            if doc_id in cancelled_docs:
                cancelled_docs.discard(doc_id)
                await db.execute(
                    "UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (doc_id,),
                )
                await db.commit()
                logger.info("Processing cancelled for doc %d", doc_id)
                pipeline_status["processing"] = None
                return

            # OCR
            pipeline_status["processing_step"] = "ocr"
            pipeline_status["processing_doc_id"] = doc_id
            pipeline_status["processing_pages"] = page_count
            logger.info("Running OCR on doc %d: %s", doc_id, path.name)
            ocr_text, confidence, engine = await extract_text(file_path, config)

            await db.execute(
                """UPDATE documents SET
                   ocr_text = ?, ocr_confidence = ?, ocr_engine = ?,
                   status = 'processing', updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (ocr_text, confidence, engine, doc_id),
            )
            await db.commit()

            if not ocr_text.strip():
                logger.warning("No text extracted from %s", path.name)
                await db.execute(
                    "UPDATE documents SET status = 'needs_review' WHERE id = ?", (doc_id,)
                )
                await db.commit()
                pipeline_status["total_processed"] += 1
                pipeline_status["last_processed"] = path.name
                return

            # Check confidence
            if confidence < config.ocr.confidence_threshold:
                logger.warning(
                    "Low OCR confidence (%.2f) for %s", confidence, path.name
                )

            # Check cancellation before LLM extraction
            if doc_id in cancelled_docs:
                cancelled_docs.discard(doc_id)
                await db.execute(
                    "UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (doc_id,),
                )
                await db.commit()
                logger.info("Processing cancelled for doc %d", doc_id)
                pipeline_status["processing"] = None
                return

            # LLM extraction
            pipeline_status["processing_step"] = "llm_extraction"
            logger.info("Running LLM extraction on doc %d", doc_id)
            llm = get_llm_provider(config)

            # Check if document needs page-level sectioning
            from asclepius.pipeline.section_processor import should_section, process_with_sections

            if await should_section(file_path):
                logger.info("Large document (%s pages) — using page-level sectioning for doc %d", page_count, doc_id)

                # Get per-page OCR text
                from asclepius.pipeline.ocr import extract_text_per_page
                ocr_pages = await extract_text_per_page(file_path, config)

                # If per-page extraction returned nothing useful, split full OCR text
                if all(not p.strip() for p in ocr_pages):
                    total_pages = max(page_count or 1, 1)
                    chunk_size = max(1, len(ocr_text) // total_pages)
                    ocr_pages = [ocr_text[i:i + chunk_size] for i in range(0, len(ocr_text), chunk_size)]

                # Run section-level extraction (classify pages, extract per-section)
                try:
                    section_extraction = await process_with_sections(db, llm, doc_id, file_path, ocr_pages, config)
                except Exception as sect_err:
                    logger.exception("Sectioning failed for doc %d, falling back to normal extraction", doc_id)
                    section_extraction = None

                if section_extraction is not None:
                    # Run normal classification on a truncated version of the text
                    # to get document-level metadata (patient, doctor, facility, dates)
                    from asclepius.pipeline.extractor import (
                        build_extraction_context, extract_and_store,
                    )
                    context = await build_extraction_context(db)

                    # Classify using first ~5000 chars (cover page + start)
                    classification_text = ocr_text[:5000]
                    try:
                        classification = await llm.classify(classification_text, context)
                    except Exception:
                        classification = {"error": "classification failed"}

                    if "error" not in classification:
                        merged = {**classification, **section_extraction}
                        extraction = await extract_and_store(db, llm, doc_id, ocr_text, config,
                                                            extraction_override=merged)
                    else:
                        extraction = await extract_and_store(db, llm, doc_id, ocr_text, config,
                                                            extraction_override=section_extraction)
                else:
                    # Sectioning failed — fall through to normal extraction
                    logger.info("Falling back to chunked extraction for doc %d", doc_id)
                    extraction = await _chunked_extract_and_store(db, llm, doc_id, ocr_text, config)
            # Chunked LLM extraction for very long texts
            elif len(ocr_text) > 15000:
                logger.info("Long text (%d chars) — using chunked extraction for doc %d", len(ocr_text), doc_id)
                extraction = await _chunked_extract_and_store(db, llm, doc_id, ocr_text, config)
            else:
                extraction = await classify_and_extract(db, llm, doc_id, ocr_text, config)

            if "error" in extraction:
                pipeline_status["total_errors"] += 1
                pipeline_status["recent_errors"].append({
                    "file": path.name,
                    "error": extraction.get("error", "Unknown"),
                })
                pipeline_status["recent_errors"] = pipeline_status["recent_errors"][-10:]
                return

            # Check cancellation before organizing
            if doc_id in cancelled_docs:
                cancelled_docs.discard(doc_id)
                await db.execute(
                    "UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (doc_id,),
                )
                await db.commit()
                logger.info("Processing cancelled for doc %d", doc_id)
                pipeline_status["processing"] = None
                return

            # Organize file
            pipeline_status["processing_step"] = "organizing"

            # Get document metadata for file organization
            cursor = await db.execute(
                """SELECT d.patient_id, d.doc_type, d.doc_date, d.doctor_id, d.facility_id,
                          p.slug as patient_slug,
                          doc.slug as doctor_slug,
                          f.slug as facility_slug
                   FROM documents d
                   LEFT JOIN patients p ON d.patient_id = p.id
                   LEFT JOIN doctors doc ON d.doctor_id = doc.id
                   LEFT JOIN facilities f ON d.facility_id = f.id
                   WHERE d.id = ?""",
                (doc_id,),
            )
            doc = await cursor.fetchone()

            # Use facility slug for path organization, fall back to doctor slug
            provider_slug = None
            if doc:
                provider_slug = doc["facility_slug"] or doc["doctor_slug"]

            # Organize file
            dest_path = build_organized_path(
                config,
                doc["patient_slug"] if doc else None,
                doc["doc_date"] if doc else None,
                provider_slug,
                doc["doc_type"] if doc else None,
                path.name,
            )
            final_path = move_file(config, file_path, dest_path)

            # Update document with final path and status
            await db.execute(
                """UPDATE documents SET
                   file_path = ?, status = 'done', updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (final_path, doc_id),
            )
            await db.commit()

            # Auto-assign to medical event if not already assigned
            try:
                await _auto_assign_event(db, llm, doc_id, config)
            except Exception:
                logger.warning("Auto-event assignment failed for doc %d (non-fatal)", doc_id)

            pipeline_status["total_processed"] += 1
            pipeline_status["last_processed"] = path.name
            logger.info("Completed processing doc %d: %s -> %s", doc_id, path.name, final_path)

        except Exception as e:
            logger.exception("Pipeline error for %s", path.name)
            error_msg = f"{type(e).__name__}: {str(e)}" if str(e) else f"{type(e).__name__} (no message)"
            pipeline_status["total_errors"] += 1
            pipeline_status["recent_errors"].append({
                "file": path.name,
                "error": error_msg,
            })
            pipeline_status["recent_errors"] = pipeline_status["recent_errors"][-10:]

            # Mark as failed if doc_id exists
            try:
                await db.execute(
                    "UPDATE documents SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (doc_id,),
                )
                await db.commit()
            except Exception:
                pass

    pipeline_status["processing"] = None
    pipeline_status["processing_step"] = None
    pipeline_status["processing_doc_id"] = None
    pipeline_status["processing_pages"] = None
    pipeline_status["processing_page_current"] = None


async def _auto_assign_event(
    db: aiosqlite.Connection, llm, doc_id: int, config: AppConfig
) -> None:
    """Auto-assign a document to a medical event after extraction.

    Skips if the document already has an event_id assigned.
    Uses LLM to match against existing events or suggest a new one.
    """
    # Check if already assigned
    cursor = await db.execute(
        "SELECT event_id, patient_id, doc_type, summary_en, doctor_name, facility_name, "
        "COALESCE(date_visit, date_issued, doc_date) as best_date "
        "FROM documents WHERE id = ?",
        (doc_id,),
    )
    doc = await cursor.fetchone()
    if not doc or doc["event_id"] or not doc["patient_id"]:
        return  # Already assigned, no patient, or doc not found

    doc = dict(doc)

    # Get existing events for this patient
    cursor = await db.execute(
        """SELECT id, title, event_type, date_start, date_end, is_ongoing, diagnosis_text
           FROM medical_events WHERE patient_id = ? ORDER BY date_start DESC""",
        (doc["patient_id"],),
    )
    events = [dict(r) for r in await cursor.fetchall()]

    events_text = "\n".join(
        f"- ID {e['id']}: \"{e['title']}\" ({e['event_type']}, {e.get('date_start', '?')})"
        + (f" — {e.get('diagnosis_text', '')}" if e.get("diagnosis_text") else "")
        for e in events
    ) or "No events exist yet."

    prompt = f"""Match this document to a medical event, or suggest creating a new one.

Document: type={doc.get('doc_type','?')}, date={doc.get('best_date','?')}, doctor={doc.get('doctor_name','?')}, facility={doc.get('facility_name','?')}
Summary: {(doc.get('summary_en') or 'N/A')[:300]}

Existing events:
{events_text}

JSON response:
{{"existing_event_id": number or null, "new_event": {{"title": "string", "event_type": "string", "date_start": "YYYY-MM-DD or null"}} or null}}"""

    try:
        response = await llm._generate(prompt)
        result = llm._parse_json(response)
    except Exception:
        return

    if result.get("existing_event_id"):
        # Verify event exists
        eid = result["existing_event_id"]
        cursor = await db.execute("SELECT id FROM medical_events WHERE id = ?", (eid,))
        if await cursor.fetchone():
            await db.execute("UPDATE documents SET event_id = ? WHERE id = ?", (eid, doc_id))
            await db.execute(
                "INSERT OR IGNORE INTO document_event_links (document_id, event_id, auto_linked) VALUES (?, ?, 1)",
                (doc_id, eid),
            )
            await db.commit()
            logger.info("Auto-assigned doc %d to event %d", doc_id, eid)
    elif result.get("new_event"):
        ne = result["new_event"]
        if ne.get("title"):
            cursor = await db.execute(
                """INSERT INTO medical_events (patient_id, title, event_type, date_start)
                   VALUES (?, ?, ?, ?)""",
                (doc["patient_id"], ne["title"], ne.get("event_type", "other"), ne.get("date_start")),
            )
            new_eid = cursor.lastrowid
            await db.execute("UPDATE documents SET event_id = ? WHERE id = ?", (new_eid, doc_id))
            await db.execute(
                "INSERT OR IGNORE INTO document_event_links (document_id, event_id, auto_linked) VALUES (?, ?, 1)",
                (doc_id, new_eid),
            )
            await db.commit()
            logger.info("Auto-created event '%s' (id=%d) and assigned doc %d", ne["title"], new_eid, doc_id)


async def _chunked_extract_and_store(
    db: aiosqlite.Connection,
    llm,
    doc_id: int,
    ocr_text: str,
    config: AppConfig,
) -> dict:
    """Split long text into overlapping chunks, extract from each, and merge results."""
    from asclepius.pipeline.extractor import build_extraction_context, extract_and_store

    chunk_size = 10000
    overlap = 1000
    chunks = []
    start = 0
    while start < len(ocr_text):
        end = start + chunk_size
        chunks.append(ocr_text[start:end])
        start = end - overlap

    logger.info("Splitting doc %d into %d chunks for LLM extraction", doc_id, len(chunks))

    # Extract first chunk normally (this writes to DB)
    extraction = await extract_and_store(db, llm, doc_id, chunks[0], config)
    if "error" in extraction:
        return extraction

    # Extract remaining chunks and merge
    context = await build_extraction_context(db)
    for i, chunk in enumerate(chunks[1:], start=2):
        logger.info("Extracting chunk %d/%d for doc %d", i, len(chunks), doc_id)
        try:
            chunk_extraction = await llm.extract(chunk, context)
            if "error" in chunk_extraction:
                continue
            extraction = _merge_extractions(extraction, chunk_extraction)
        except Exception:
            logger.exception("Chunk %d extraction failed for doc %d", i, doc_id)

    return extraction


def _merge_extractions(base: dict, additional: dict) -> dict:
    """Merge additional extraction results into the base, deduplicating."""
    # Merge lab results — deduplicate by test_name_original
    existing_labs = {lr.get("test_name_original") for lr in base.get("lab_results", [])}
    for lab in additional.get("lab_results", []):
        if lab.get("test_name_original") not in existing_labs:
            base.setdefault("lab_results", []).append(lab)
            existing_labs.add(lab.get("test_name_original"))

    # Merge medications — deduplicate by brand_name + active_ingredient_original
    existing_meds = {
        (m.get("brand_name"), m.get("active_ingredient_original"))
        for m in base.get("medications", [])
    }
    for med in additional.get("medications", []):
        key = (med.get("brand_name"), med.get("active_ingredient_original"))
        if key not in existing_meds:
            base.setdefault("medications", []).append(med)
            existing_meds.add(key)

    # Merge diagnoses — deduplicate by diagnosis_original
    existing_diags = {d.get("diagnosis_original") for d in base.get("diagnoses", [])}
    for diag in additional.get("diagnoses", []):
        if diag.get("diagnosis_original") not in existing_diags:
            base.setdefault("diagnoses", []).append(diag)
            existing_diags.add(diag.get("diagnosis_original"))

    # Merge vaccinations — deduplicate by vaccine_name + date_administered
    existing_vax = {
        (v.get("vaccine_name"), v.get("date_administered"))
        for v in base.get("vaccinations", [])
    }
    for vax in additional.get("vaccinations", []):
        key = (vax.get("vaccine_name"), vax.get("date_administered"))
        if key not in existing_vax:
            base.setdefault("vaccinations", []).append(vax)
            existing_vax.add(key)

    # Merge cost line items — deduplicate by description + amount
    base_cost = base.get("cost", {})
    add_cost = additional.get("cost", {})
    existing_items = {
        (li.get("description"), li.get("amount"))
        for li in base_cost.get("line_items", [])
    }
    for item in add_cost.get("line_items", []):
        key = (item.get("description"), item.get("amount"))
        if key not in existing_items:
            base_cost.setdefault("line_items", []).append(item)
            existing_items.add(key)

    return base


async def reprocess_document(doc_id: int, config: AppConfig) -> dict:
    """Re-run LLM extraction on an existing document. Does NOT re-OCR or move files."""
    async with aiosqlite.connect(config.database.path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        cursor = await db.execute(
            "SELECT id, ocr_text, file_path, original_filename, patient_id FROM documents WHERE id = ?",
            (doc_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            return {"error": "Document not found"}

        ocr_text = doc["ocr_text"]
        if not ocr_text or not ocr_text.strip():
            # Need to re-OCR — find the file
            file_path = Path(config.vault.root_path) / doc["file_path"]
            if not file_path.exists():
                await db.execute(
                    "UPDATE documents SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (doc_id,),
                )
                await db.commit()
                return {"error": f"File not found: {doc['file_path']}"}

            logger.info("Re-running OCR on doc %d", doc_id)
            await db.execute(
                "UPDATE documents SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()
            ocr_text, confidence, engine = await extract_text(str(file_path), config)
            await db.execute(
                """UPDATE documents SET ocr_text = ?, ocr_confidence = ?, ocr_engine = ?,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (ocr_text, confidence, engine, doc_id),
            )
            await db.commit()

        if not ocr_text or not ocr_text.strip():
            await db.execute(
                "UPDATE documents SET status = 'needs_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()
            return {"error": "No text could be extracted"}

        # Clear old extracted data
        for table in ["lab_results", "encounters", "medications", "vaccinations", "invoice_items", "document_sections"]:
            await db.execute(f"DELETE FROM {table} WHERE document_id = ?", (doc_id,))
        await db.commit()

        # Run LLM extraction — only set 'processing' right before actual work begins
        logger.info("Re-running LLM extraction on doc %d", doc_id)
        try:
            await db.execute(
                "UPDATE documents SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()

            llm = get_llm_provider(config)
            extraction = await classify_and_extract(db, llm, doc_id, ocr_text, config)

            if "error" in extraction:
                await db.execute(
                    "UPDATE documents SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (doc_id,),
                )
                await db.commit()
                return extraction

            await db.execute(
                "UPDATE documents SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()
            logger.info("Reprocessing complete for doc %d", doc_id)
            return {"status": "done", "document_id": doc_id}

        except Exception as e:
            logger.exception("Reprocessing failed for doc %d", doc_id)
            await db.execute(
                "UPDATE documents SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()
            return {"error": str(e)}
