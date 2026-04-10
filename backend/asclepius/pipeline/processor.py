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

            # Read patient_id hint from upload (if present)
            hint_patient_id = None
            hint_path = Path(str(path) + ".patient_hint")
            if hint_path.exists():
                try:
                    hint_patient_id = int(hint_path.read_text().strip())
                except (ValueError, OSError):
                    pass
                hint_path.unlink(missing_ok=True)

            # Try to INSERT — if file_hash already exists (from upload), it'll be ignored
            await db.execute(
                """INSERT OR IGNORE INTO documents
                   (file_path, original_filename, file_hash, file_size, page_count,
                    patient_id, date_received, status)
                   VALUES (?, ?, ?, ?, ?, ?, DATE('now'), 'pending')""",
                (f"inbox/{path.name}", path.name, file_hash, file_size, page_count, hint_patient_id),
            )
            await db.commit()

            # Now SELECT the record (whether just inserted or pre-existing from upload)
            cursor = await db.execute(
                "SELECT id, status, patient_id FROM documents WHERE file_hash = ?", (file_hash,),
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

            # Ensure patient_id is set even if pipeline created the record first
            patient_update = ""
            params = [file_size, page_count]
            if hint_patient_id and not existing["patient_id"]:
                patient_update = ", patient_id = ?"
                params.append(hint_patient_id)
            params.append(doc_id)

            await db.execute(
                f"""UPDATE documents SET status = 'processing', file_size = ?, page_count = ?{patient_update},
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                params,
            )
            await db.commit()
            logger.info("Processing doc %d (patient=%s): %s",
                        doc_id, existing["patient_id"] or hint_patient_id, path.name)

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

            # Chunked LLM extraction for very long texts
            if len(ocr_text) > 15000:
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

            pipeline_status["total_processed"] += 1
            pipeline_status["last_processed"] = path.name
            logger.info("Completed processing doc %d: %s -> %s", doc_id, path.name, final_path)

        except Exception as e:
            logger.exception("Pipeline error for %s", path.name)
            pipeline_status["total_errors"] += 1
            pipeline_status["recent_errors"].append({
                "file": path.name,
                "error": str(e),
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
        for table in ["lab_results", "encounters", "medications", "vaccinations", "invoice_items"]:
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
