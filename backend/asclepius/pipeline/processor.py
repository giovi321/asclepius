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
from asclepius.pipeline.extractor import extract_and_store
from asclepius.pipeline.organizer import build_organized_path, move_file

logger = logging.getLogger(__name__)

# Pipeline status tracking (in-memory)
pipeline_status = {
    "queue_depth": 0,
    "processing": None,
    "last_processed": None,
    "total_processed": 0,
    "total_errors": 0,
    "recent_errors": [],
}


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

            # Check for duplicates via file hash
            cursor = await db.execute(
                "SELECT id FROM documents WHERE file_hash = ?",
                (file_hash,),
            )
            existing = await cursor.fetchone()
            if existing:
                logger.info("Duplicate detected by hash, skipping: %s", path.name)
                path.unlink()
                return

            ext = path.suffix.lower()

            # DICOM path
            if ext in {".dcm", ".dicom"}:
                from asclepius.pipeline.dicom_ingest import process_dicom
                doc_id = await process_dicom(file_path, config, db)
                if doc_id:
                    pipeline_status["total_processed"] += 1
                    pipeline_status["last_processed"] = path.name
                return

            # Create initial document record with file metadata
            cursor = await db.execute(
                """INSERT INTO documents
                   (file_path, original_filename, file_hash, file_size, page_count,
                    date_received, status)
                   VALUES (?, ?, ?, ?, ?, DATE('now'), 'processing')""",
                (f"inbox/{path.name}", path.name, file_hash, file_size, page_count),
            )
            doc_id = cursor.lastrowid
            await db.commit()

            # OCR
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

            # LLM extraction
            logger.info("Running LLM extraction on doc %d", doc_id)
            llm = get_llm_provider(config)
            extraction = await extract_and_store(db, llm, doc_id, ocr_text, config)

            if "error" in extraction:
                pipeline_status["total_errors"] += 1
                pipeline_status["recent_errors"].append({
                    "file": path.name,
                    "error": extraction.get("error", "Unknown"),
                })
                pipeline_status["recent_errors"] = pipeline_status["recent_errors"][-10:]
                return

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
        for table in ["lab_results", "encounters", "medications", "vaccinations"]:
            await db.execute(f"DELETE FROM {table} WHERE document_id = ?", (doc_id,))

        await db.execute(
            "UPDATE documents SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (doc_id,),
        )
        await db.commit()

        # Run LLM extraction
        logger.info("Re-running LLM extraction on doc %d", doc_id)
        try:
            llm = get_llm_provider(config)
            extraction = await extract_and_store(db, llm, doc_id, ocr_text, config)

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
