"""Document reprocessing — re-run OCR and/or LLM extraction on existing documents."""

import logging
from pathlib import Path

import aiosqlite

from asclepius.config import AppConfig
from asclepius.pipeline.ocr import extract_text
from asclepius.pipeline.extractor import classify_and_extract
from asclepius.pipeline.ocr_cache import cache_ocr_pages
from asclepius.pipeline.provider_factory import get_llm_provider, _build_llm_provider

logger = logging.getLogger(__name__)


async def reprocess_document(
    doc_id: int,
    config: AppConfig,
    mode: str = "both",
    llm_provider_id: str | None = None,
    ocr_provider_id: str | None = None,
) -> dict:
    """Re-run OCR and/or LLM extraction on an existing document.

    mode: "ocr" = re-OCR only, "llm" = re-extract only, "both" = full reprocess.
    llm_provider_id: if set, use this specific LLM provider instead of the default.
    ocr_provider_id: if set, use this specific OCR provider instead of the default.
    """
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
        run_ocr = mode in ("ocr", "both")
        run_llm = mode in ("llm", "both")

        # --- OCR phase ---
        if run_ocr:
            file_path = Path(config.vault.root_path) / doc["file_path"]
            if not file_path.exists():
                await db.execute(
                    """UPDATE documents SET status = 'failed', error_message = 'File not found on disk',
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (doc_id,),
                )
                await db.commit()
                return {"error": f"File not found: {doc['file_path']}"}

            logger.info("Re-running OCR on doc %d", doc_id)
            await db.execute(
                """UPDATE documents SET status = 'processing', error_message = NULL,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (doc_id,),
            )
            await db.commit()
            ocr_text, confidence, engine = await extract_text(str(file_path), config, ocr_provider_id=ocr_provider_id)
            await db.execute(
                """UPDATE documents SET ocr_text = ?, ocr_confidence = ?, ocr_engine = ?,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (ocr_text, confidence, engine, doc_id),
            )
            await db.commit()
            try:
                await cache_ocr_pages(db, doc_id, ocr_text, engine, confidence)
            except Exception:
                pass
        elif run_llm and (not ocr_text or not ocr_text.strip()):
            # LLM-only but no OCR text — need to OCR first
            file_path = Path(config.vault.root_path) / doc["file_path"]
            if not file_path.exists():
                await db.execute(
                    """UPDATE documents SET status = 'failed', error_message = 'File not found on disk',
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (doc_id,),
                )
                await db.commit()
                return {"error": f"File not found: {doc['file_path']}"}
            logger.info("No OCR text for doc %d, running OCR before LLM", doc_id)
            await db.execute(
                """UPDATE documents SET status = 'processing', error_message = NULL,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (doc_id,),
            )
            await db.commit()
            ocr_text, confidence, engine = await extract_text(str(file_path), config, ocr_provider_id=ocr_provider_id)
            await db.execute(
                """UPDATE documents SET ocr_text = ?, ocr_confidence = ?, ocr_engine = ?,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (ocr_text, confidence, engine, doc_id),
            )
            await db.commit()

        if not ocr_text or not ocr_text.strip():
            await db.execute(
                """UPDATE documents SET status = 'needs_review', error_message = 'No text could be extracted',
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (doc_id,),
            )
            await db.commit()
            return {"error": "No text could be extracted"}

        # OCR-only mode: done here
        if not run_llm:
            await db.execute(
                "UPDATE documents SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()
            logger.info("OCR-only reprocess complete for doc %d", doc_id)
            return {"status": "done", "document_id": doc_id}

        # --- LLM phase ---
        # Clear old extracted data before re-extraction
        for table in ["lab_results", "encounters", "medications", "vaccinations", "invoice_items", "document_sections"]:
            await db.execute(f"DELETE FROM {table} WHERE document_id = ?", (doc_id,))
        await db.commit()

        logger.info("Re-running LLM extraction on doc %d (provider=%s)", doc_id, llm_provider_id or "default")
        try:
            await db.execute(
                """UPDATE documents SET status = 'processing', error_message = NULL,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (doc_id,),
            )
            await db.commit()

            # Build LLM provider — use specific one if requested
            if llm_provider_id:
                from asclepius.config import get_config as _get_config
                cfg = _get_config()
                entry = None
                for p in cfg.llm.providers:
                    if p.id == llm_provider_id and p.enabled:
                        entry = p
                        break
                if entry:
                    llm = _build_llm_provider(entry)
                else:
                    llm = get_llm_provider(config)
            else:
                llm = get_llm_provider(config)

            extraction = await classify_and_extract(db, llm, doc_id, ocr_text, config)

            if "error" in extraction:
                raw_resp = extraction.get("raw_response", "")
                error_detail = extraction.get("error", "Extraction failed")
                if raw_resp:
                    error_detail = f"{error_detail}\n\nRaw LLM response:\n{raw_resp}"
                logger.error("LLM extraction error for doc %d: %s", doc_id, error_detail[:500])
                await db.execute(
                    """UPDATE documents SET status = 'failed', error_message = ?,
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (error_detail[:2000], doc_id),
                )
                await db.commit()
                return extraction

            # Validate meaningful content
            _has_content = any([
                extraction.get("doc_type"),
                extraction.get("summary_en"),
                extraction.get("summary_original"),
                extraction.get("date_visit"),
                extraction.get("date_issued"),
                extraction.get("doc_date"),
                extraction.get("lab_results"),
                extraction.get("medications"),
                extraction.get("diagnoses"),
            ])
            if not _has_content:
                logger.warning("LLM extraction returned empty results for doc %d. Keys present: %s",
                               doc_id, list(extraction.keys()))
                await db.execute(
                    """UPDATE documents SET status = 'needs_review',
                       error_message = 'LLM extraction returned empty results',
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (doc_id,),
                )
                await db.commit()
                return {"error": "LLM extraction returned empty results"}

            await db.execute(
                "UPDATE documents SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()
            logger.info("Reprocessing complete for doc %d", doc_id)
            return {"status": "done", "document_id": doc_id}

        except Exception as e:
            logger.exception("Reprocessing failed for doc %d", doc_id)
            error_msg = f"{type(e).__name__}: {str(e)}" if str(e) else type(e).__name__
            await db.execute(
                """UPDATE documents SET status = 'failed', error_message = ?,
                   retry_count = COALESCE(retry_count, 0) + 1,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (error_msg[:2000], doc_id),
            )
            await db.commit()
            return {"error": str(e)}
