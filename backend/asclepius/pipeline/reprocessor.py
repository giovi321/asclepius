"""Document reprocessing — re-run OCR and/or LLM extraction on existing documents."""

import asyncio
import logging
from pathlib import Path

import aiosqlite

from asclepius.config import AppConfig
from asclepius.pipeline.ocr import extract_text
from asclepius.pipeline.chunked_extraction import run_extraction
from asclepius.pipeline.ocr_cache import cache_ocr_pages
from asclepius.pipeline.provider_factory import get_llm_provider, _build_llm_provider

logger = logging.getLogger(__name__)


def _is_cancelled(doc_id: int) -> bool:
    """True if a cancel has been requested for this doc. Used as a
    cooperative checkpoint between reprocess phases so cancel is honoured
    even when the task can't be hard-cancelled immediately."""
    from asclepius.pipeline.processor import cancelled_docs
    return doc_id in cancelled_docs


async def _mark_cancelled(db: aiosqlite.Connection, doc_id: int) -> None:
    from asclepius.pipeline.processor import cancelled_docs
    cancelled_docs.discard(doc_id)
    await db.execute(
        """UPDATE documents SET status = 'cancelled', error_message = NULL,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
        (doc_id,),
    )
    await db.commit()


async def reprocess_document(
    doc_id: int,
    config: AppConfig,
    mode: str = "both",
    llm_provider_id: str | None = None,
    ocr_provider_id: str | None = None,
    vision_provider_id: str | None = None,
) -> dict:
    """Re-run OCR and/or LLM extraction on an existing document.

    mode:
        "ocr"        — re-OCR only
        "llm"        — re-extract only
        "both"       — full reprocess (OCR + LLM)
        "vision_llm" — run the Vision-LLM flow (single-step OCR+extraction)

    llm_provider_id: if set, use this specific LLM provider instead of the default.
    ocr_provider_id: if set, use this specific OCR provider instead of the default.
    vision_provider_id: if set and mode == 'vision_llm', prefer this vision provider.
    """
    if mode == "vision_llm":
        return await _reprocess_vision_llm(doc_id, config, vision_provider_id)

    from asclepius.pipeline.processor import (
        register_running_task, unregister_running_task,
    )
    _current_task = asyncio.current_task()
    if _current_task is not None:
        register_running_task(doc_id, _current_task)

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
            unregister_running_task(doc_id, _current_task)
            return {"error": "Document not found"}

        ocr_text = doc["ocr_text"]
        run_ocr = mode in ("ocr", "both")
        run_llm = mode in ("llm", "both")

        # Cooperative cancel checkpoint before OCR.
        if _is_cancelled(doc_id):
            await _mark_cancelled(db, doc_id)
            unregister_running_task(doc_id, _current_task)
            return {"status": "cancelled", "document_id": doc_id}

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
                unregister_running_task(doc_id, _current_task)
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
            unregister_running_task(doc_id, _current_task)
            return {"error": "No text could be extracted"}

        # OCR-only mode: done here
        if not run_llm:
            await db.execute(
                "UPDATE documents SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()
            logger.info("OCR-only reprocess complete for doc %d", doc_id)
            unregister_running_task(doc_id, _current_task)
            return {"status": "done", "document_id": doc_id}

        # Cooperative cancel checkpoint between OCR and LLM phases.
        if _is_cancelled(doc_id):
            await _mark_cancelled(db, doc_id)
            unregister_running_task(doc_id, _current_task)
            return {"status": "cancelled", "document_id": doc_id}

        # --- LLM phase ---
        # Clear old extracted data before re-extraction (child tables + document metadata)
        for table in ["lab_results", "encounters", "medications", "vaccinations", "invoice_items", "document_sections"]:
            await db.execute(f"DELETE FROM {table} WHERE document_id = ?", (doc_id,))
        await db.execute(
            """UPDATE documents SET
               doc_type = NULL, event_date = NULL, issued_date = NULL,
               language_source = NULL, summary_en = NULL, summary_original = NULL,
               doctor_id = NULL, facility_id = NULL,
               specialty_original = NULL, norm_specialty_id = NULL,
               cost_amount = NULL, cost_currency = NULL,
               insurance_company = NULL, insurance_policy = NULL,
               raw_extraction = NULL, llm_provider = NULL,
               updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (doc_id,),
        )
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

            file_path_for_extract = str(
                Path(config.vault.root_path) / doc["file_path"]
            )
            extraction = await run_extraction(
                db, llm, doc_id, ocr_text, config,
                file_path=file_path_for_extract,
            )

            if "error" in extraction:
                raw_resp = extraction.get("raw_response", "")
                error_detail = extraction.get("error", "Extraction failed")
                if extraction.get("_truncation_suspected"):
                    error_detail = (
                        f"{error_detail} (response length {extraction.get('_response_length')} chars — "
                        f"likely hit the output-token cap; raise llm.extraction_max_output_tokens)"
                    )
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
            if extraction.get("_truncated"):
                logger.warning(
                    "Doc %d: LLM response was truncated; kept partial extraction. "
                    "Consider raising llm.extraction_max_output_tokens.",
                    doc_id,
                )

            # Validate meaningful content
            _has_content = any([
                extraction.get("doc_type"),
                extraction.get("summary_en"),
                extraction.get("summary_original"),
                extraction.get("event_date"),
                extraction.get("issued_date"),
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

        except asyncio.CancelledError:
            # Hard cancel via ``cancel_running_task``. The httpx POST the
            # task was waiting on gets aborted; gate slots release via
            # the context-manager finally blocks on the way out.
            logger.info("Reprocess task cancelled for doc %d", doc_id)
            try:
                await _mark_cancelled(db, doc_id)
            except Exception:
                pass
            raise
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
        finally:
            unregister_running_task(doc_id, _current_task)


async def _reprocess_vision_llm(
    doc_id: int, config: AppConfig, vision_provider_id: str | None,
) -> dict:
    """Re-run the single-step Vision-LLM flow on a document.

    Overwrites OCR fields AND extraction data — this is a full replacement,
    equivalent to running ``mode == 'both'`` but through the vision pipeline.
    """
    from asclepius.pipeline.vision_extractor import extract_with_vision
    from asclepius.pipeline.extractor import (
        extract_and_store, _salvage_classification, _normalize_doc_type,
        _extract_type_specific, build_extraction_context,
    )
    from asclepius.pipeline.processor import (
        register_running_task, unregister_running_task,
    )

    _current_task = asyncio.current_task()
    if _current_task is not None:
        register_running_task(doc_id, _current_task)

    async with aiosqlite.connect(config.database.path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        cursor = await db.execute(
            "SELECT id, file_path FROM documents WHERE id = ?", (doc_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            return {"error": "Document not found"}

        file_path = Path(config.vault.root_path) / doc["file_path"]
        if not file_path.exists():
            await db.execute(
                """UPDATE documents SET status = 'failed', error_message = 'File not found on disk',
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (doc_id,),
            )
            await db.commit()
            return {"error": f"File not found: {doc['file_path']}"}

        await db.execute(
            """UPDATE documents SET status = 'processing', error_message = NULL,
               updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (doc_id,),
        )
        await db.commit()

        # Clear previous extraction state before re-running
        for table in ["lab_results", "encounters", "medications", "vaccinations",
                      "invoice_items", "document_sections"]:
            await db.execute(f"DELETE FROM {table} WHERE document_id = ?", (doc_id,))
        await db.execute(
            """UPDATE documents SET
               doc_type = NULL, event_date = NULL, issued_date = NULL,
               language_source = NULL, summary_en = NULL, summary_original = NULL,
               doctor_id = NULL, facility_id = NULL,
               specialty_original = NULL, norm_specialty_id = NULL,
               cost_amount = NULL, cost_currency = NULL,
               insurance_company = NULL, insurance_policy = NULL,
               raw_extraction = NULL, llm_provider = NULL,
               updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (doc_id,),
        )
        await db.commit()

        logger.info("Re-running Vision-LLM flow on doc %d (provider=%s)",
                    doc_id, vision_provider_id or "default")
        try:
            ocr_text, confidence, engine, vision_result, vision_entry = await extract_with_vision(
                str(file_path), config, provider_override_id=vision_provider_id,
            )
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

            if not ocr_text.strip() and not vision_result:
                await db.execute(
                    """UPDATE documents SET status = 'needs_review',
                       error_message = 'Vision-LLM produced no content',
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (doc_id,),
                )
                await db.commit()
                return {"error": "Vision-LLM produced no content"}

            _salvage_classification(vision_result)
            doc_type = _normalize_doc_type(vision_result.get("doc_type", "other"))
            vision_result["doc_type"] = doc_type

            # Phase 2 uses the same provider the user selected for vision, so
            # a user who picks e.g. Haiku for vision gets Haiku doing the
            # type-specific text extraction too instead of silently falling
            # back to the default text-LLM.
            from asclepius.pipeline.provider_factory import _build_llm_provider
            llm = _build_llm_provider(vision_entry)
            # Phase 2 — vision only handles classification + universal fields,
            # run type-specific extraction on the vision-produced OCR text to
            # capture lab_results / medications / diagnoses / etc.
            try:
                context = await build_extraction_context(db)
                type_extraction = await _extract_type_specific(
                    llm, ocr_text, doc_type, context, db_path=config.database.path,
                )
                if type_extraction:
                    vision_result = {**vision_result, **type_extraction}
            except Exception:
                logger.warning(
                    "Phase 2 type-specific extraction failed for doc %d (non-fatal)",
                    doc_id, exc_info=True,
                )
            extraction = await extract_and_store(
                db, llm, doc_id, ocr_text, config, extraction_override=vision_result,
            )
            if "error" in extraction:
                await db.execute(
                    """UPDATE documents SET status = 'failed', error_message = ?,
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (str(extraction.get("error", "extraction failed"))[:2000], doc_id),
                )
                await db.commit()
                return extraction

            await db.execute(
                "UPDATE documents SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (doc_id,),
            )
            await db.commit()
            return {"status": "done", "document_id": doc_id}

        except asyncio.CancelledError:
            logger.info("Vision-LLM reprocess task cancelled for doc %d", doc_id)
            try:
                await _mark_cancelled(db, doc_id)
            except Exception:
                pass
            raise
        except Exception as e:
            logger.exception("Vision-LLM reprocessing failed for doc %d", doc_id)
            error_msg = f"{type(e).__name__}: {str(e)}" if str(e) else type(e).__name__
            await db.execute(
                """UPDATE documents SET status = 'failed', error_message = ?,
                   retry_count = COALESCE(retry_count, 0) + 1,
                   updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (error_msg[:2000], doc_id),
            )
            await db.commit()
            return {"error": str(e)}
        finally:
            unregister_running_task(doc_id, _current_task)
