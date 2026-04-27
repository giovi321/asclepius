"""Main pipeline processor — orchestrates OCR, LLM extraction, and file organization.

Sub-modules handle provider factory, OCR caching, chunked extraction, and reprocessing.
"""

import asyncio
import logging
import os
from pathlib import Path

import aiosqlite

from asclepius.config import AppConfig
from asclepius.documents.service import compute_file_hash
from asclepius.pipeline.ocr import extract_text
from asclepius.pipeline.organizer import build_organized_path, move_file
from asclepius.util.dates import best_date_with_received

# Re-export from sub-modules for backward compatibility
from asclepius.pipeline.provider_factory import (  # noqa: F401
    ProviderUnreachableError,
    get_llm_provider,
    _build_llm_provider,
    get_llm_provider_count,
    is_provider_unreachable as _is_provider_unreachable,
)
from asclepius.pipeline.ocr_cache import (  # noqa: F401
    cache_ocr_pages as _cache_ocr_pages,
    load_cached_ocr_pages as _load_cached_ocr_pages,
)
from asclepius.pipeline.chunked_extraction import (  # noqa: F401
    chunked_extract_and_store as _chunked_extract_and_store,
    merge_extractions as _merge_extractions,
)
from asclepius.pipeline.reprocessor import reprocess_document  # noqa: F401
from asclepius.pipeline.state import PIPELINE_STATE

logger = logging.getLogger(__name__)


# Backward-compatible aliases. The containers are the same mutable objects
# PIPELINE_STATE owns, so every `.append(...)` / `[key] = ...` call site in
# the rest of the pipeline still writes through to the singleton.
pipeline_status = PIPELINE_STATE.pipeline_status
cancelled_docs: set[int] = PIPELINE_STATE.cancelled_docs
_running_tasks: dict[int, "asyncio.Task"] = PIPELINE_STATE.running_tasks


def register_running_task(doc_id: int, task: "asyncio.Task") -> None:
    PIPELINE_STATE.register_running_task(doc_id, task)


def unregister_running_task(doc_id: int, task: "asyncio.Task | None" = None) -> None:
    PIPELINE_STATE.unregister_running_task(doc_id, task)


def cancel_running_task(doc_id: int) -> bool:
    return PIPELINE_STATE.cancel_running_task(doc_id)


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
    # Pop this file out of the visible queued list so the topbar reflects
    # the new processing target (which is shown via "processing", not the
    # queue list).
    queued_files = pipeline_status.get("queued_files") or []
    for i, entry in enumerate(queued_files):
        if entry.get("filename") == path.name:
            del queued_files[i]
            break

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

            # Opaque zip-member passthrough: files extracted from a zip
            # upload that aren't DICOM and have no OCR/LLM value (DICOMDIR,
            # LOCKFILE, VERSION, JPEG previews). They are stored next to
            # the study on disk but do NOT get their own documents row —
            # one DICOM bundle is one document. Counter still bumped so
            # the topbar reflects the work.
            if ext == ".bin" and Path(str(path) + ".zip_member").exists():
                from asclepius.pipeline.dicom_ingest import process_zip_member
                await process_zip_member(file_path, config, db)
                pipeline_status["total_processed"] += 1
                pipeline_status["last_processed"] = path.name
                return

            # Read hint files from upload (if present)
            hint_patient_id = None
            hint_event_id = None
            hint_user_id: int | None = None
            for hint_name, hint_var in [
                (".patient_hint", "patient"),
                (".event_hint", "event"),
                (".user_hint", "user"),
            ]:
                hint_path = Path(str(path) + hint_name)
                if hint_path.exists():
                    try:
                        val = int(hint_path.read_text().strip())
                        if hint_var == "patient":
                            hint_patient_id = val
                        elif hint_var == "event":
                            hint_event_id = val
                        else:
                            hint_user_id = val
                    except (ValueError, OSError):
                        pass
                    hint_path.unlink(missing_ok=True)

            # Fallback: when the .user_hint sidecar is absent (pre-0.9.5
            # uploads, files dropped manually into inbox/user-{id}/), pull
            # the uploader from the inbox subfolder name.
            if hint_user_id is None:
                try:
                    vault_root = Path(config.vault.root_path).resolve()
                    relative_parts = path.resolve().relative_to(vault_root).parts
                    for part in relative_parts:
                        if part.startswith("user-"):
                            candidate = part[len("user-"):]
                            if candidate.isdigit():
                                hint_user_id = int(candidate)
                                break
                except (ValueError, OSError):
                    pass

            # Mirror where the file actually lives in the inbox so a
            # later reprocess can find it. The subfolder may be a patient
            # slug, ``user-{id}``, or any custom name — we just record
            # whatever path was used.
            try:
                vault_root_rel = Path(config.vault.root_path).resolve()
                rel = path.resolve().relative_to(vault_root_rel).as_posix()
                inbox_rel = rel
            except (ValueError, OSError):
                inbox_rel = f"inbox/{path.name}"

            # Try to INSERT — if file_hash already exists (from upload), it'll be ignored
            await db.execute(
                """INSERT OR IGNORE INTO documents
                   (file_path, original_filename, file_hash, file_size, page_count,
                    patient_id, event_id, uploaded_by_user_id, date_received, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE('now'), 'pending')""",
                (inbox_rel, path.name, file_hash, file_size, page_count,
                 hint_patient_id, hint_event_id, hint_user_id),
            )
            # If the row already existed (uploaded via API), make sure the
            # uploader is stamped on it — older uploads never set this.
            if hint_user_id is not None:
                await db.execute(
                    "UPDATE documents SET uploaded_by_user_id = ? "
                    "WHERE file_hash = ? AND uploaded_by_user_id IS NULL",
                    (hint_user_id, file_hash),
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

            # Register this coroutine so a cancel request can interrupt it.
            # We record the task *before* any long await (OCR, LLM) so
            # cancel is responsive. Unregistration happens in the outer
            # finally of process_file.
            _current_task = asyncio.current_task()
            if _current_task is not None:
                register_running_task(doc_id, _current_task)

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

            # ── Resolve flow ─────────────────────────────────────────
            # New uploads use the configured default flow. Reprocess requests
            # explicitly pass a mode through reprocess_document, not this path.
            flow = (config.pipeline.default_flow or "ocr_llm").lower()
            if flow == "vision_llm" and not config.vision.providers:
                logger.warning(
                    "default_flow is 'vision_llm' but no vision providers configured — "
                    "falling back to ocr_llm for doc %d", doc_id,
                )
                flow = "ocr_llm"

            import asyncio as _asyncio
            ocr_text, confidence, engine = "", 0.0, "none"

            if flow == "vision_llm":
                # ── Vision-LLM flow ─────────────────────────────────
                pipeline_status["processing_step"] = "vision_extraction"
                pipeline_status["processing_doc_id"] = doc_id
                pipeline_status["processing_pages"] = page_count
                logger.info("Running Vision-LLM extraction on doc %d: %s", doc_id, path.name)

                from asclepius.pipeline.vision_extractor import extract_with_vision
                ocr_text, confidence, engine, vision_result, vision_entry = await extract_with_vision(
                    file_path, config,
                )

                await db.execute(
                    """UPDATE documents SET
                       ocr_text = ?, ocr_confidence = ?, ocr_engine = ?,
                       status = 'processing', updated_at = CURRENT_TIMESTAMP
                       WHERE id = ?""",
                    (ocr_text, confidence, engine, doc_id),
                )
                await db.commit()

                try:
                    await _cache_ocr_pages(db, doc_id, ocr_text, engine, confidence)
                except Exception:
                    logger.warning("Failed to cache OCR pages for doc %d (non-fatal)", doc_id)

                if not ocr_text.strip() and not vision_result:
                    logger.warning("Vision extraction returned nothing for %s", path.name)
                    await db.execute(
                        "UPDATE documents SET status = 'needs_review' WHERE id = ?", (doc_id,)
                    )
                    await db.commit()
                    pipeline_status["total_processed"] += 1
                    pipeline_status["last_processed"] = path.name
                    return

                # Check cancellation before the DB-write phase
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

                pipeline_status["processing_step"] = "llm_extraction"
                pipeline_status["processing_pages"] = None
                pipeline_status["processing_page_current"] = None
                from asclepius.pipeline.extractor import (
                    extract_and_store, _salvage_classification, _normalize_doc_type,
                    _extract_type_specific, build_extraction_context,
                )
                _salvage_classification(vision_result)
                doc_type = _normalize_doc_type(vision_result.get("doc_type", "other"))
                vision_result["doc_type"] = doc_type
                # Phase 2 reuses the vision provider's config so the model the
                # user picked for vision also handles type-specific extraction.
                from asclepius.pipeline.provider_factory import _build_llm_provider
                llm = _build_llm_provider(vision_entry)
                # Vision handled classification + universal fields (Phase 1).
                # Still run Phase 2 type-specific extraction on the vision OCR
                # text to capture lab_results / medications / diagnoses / etc.
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
            else:
                # ── OCR phase ────────────────────────────────────────────
                pipeline_status["processing_step"] = "ocr"
                pipeline_status["processing_doc_id"] = doc_id
                pipeline_status["processing_pages"] = page_count
                logger.info("Running OCR on doc %d: %s", doc_id, path.name)

                for ocr_attempt in range(3):
                    try:
                        ocr_text, confidence, engine = await extract_text(file_path, config)
                        break
                    except Exception as ocr_err:
                        if ocr_attempt < 2:
                            wait = 60 * (ocr_attempt + 1)
                            logger.warning(
                                "OCR failed for doc %d (%s, attempt %d/3): %s — retrying in %ds",
                                doc_id, path.name, ocr_attempt + 1, ocr_err, wait,
                            )
                            await _asyncio.sleep(wait)
                        else:
                            logger.error("OCR failed after 3 attempts for doc %d: %s", doc_id, ocr_err)
                            raise

                await db.execute(
                    """UPDATE documents SET
                       ocr_text = ?, ocr_confidence = ?, ocr_engine = ?,
                       status = 'processing', updated_at = CURRENT_TIMESTAMP
                       WHERE id = ?""",
                    (ocr_text, confidence, engine, doc_id),
                )
                await db.commit()

                # Cache per-page OCR text
                try:
                    await _cache_ocr_pages(db, doc_id, ocr_text, engine, confidence)
                except Exception:
                    logger.warning("Failed to cache OCR pages for doc %d (non-fatal)", doc_id)

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

                # ── Standard LLM extraction phase ─────────────────────────────
                pipeline_status["processing_step"] = "llm_extraction"
                pipeline_status["processing_pages"] = None
                pipeline_status["processing_page_current"] = None
                logger.info("Running LLM extraction on doc %d", doc_id)
                llm = get_llm_provider(config)

                from asclepius.pipeline.chunked_extraction import run_extraction
                extraction = await run_extraction(
                    db, llm, doc_id, ocr_text, config, file_path=file_path,
                )

            if "error" in extraction:
                err_msg = extraction.get("error", "Extraction failed")
                if extraction.get("_truncation_suspected"):
                    err_msg = (
                        f"{err_msg} (response length {extraction.get('_response_length')} chars — "
                        f"likely hit the output-token cap; raise llm.extraction_max_output_tokens)"
                    )
                pipeline_status["total_errors"] += 1
                pipeline_status["recent_errors"].append({
                    "file": path.name,
                    "error": err_msg,
                })
                pipeline_status["recent_errors"] = pipeline_status["recent_errors"][-10:]
                await db.execute(
                    """UPDATE documents SET status = 'failed', error_message = ?,
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (err_msg[:2000], doc_id),
                )
                await db.commit()
                return

            # Validate that the LLM actually produced meaningful content.
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
                logger.warning("LLM extraction produced no meaningful content for doc %d", doc_id)
                await db.execute(
                    """UPDATE documents SET status = 'needs_review',
                       error_message = 'LLM extraction returned empty results',
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (doc_id,),
                )
                await db.commit()
                pipeline_status["total_errors"] += 1
                pipeline_status["recent_errors"].append({
                    "file": path.name,
                    "error": "LLM extraction returned empty results",
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

            # ── Organize phase ───────────────────────────────────────
            pipeline_status["processing_step"] = "organizing"

            # Get document metadata for file organization
            cursor = await db.execute(
                """SELECT d.patient_id, d.doc_type, d.event_date, d.issued_date,
                          d.date_received, d.doctor_id, d.facility_id,
                          d.event_id, d.summary_en, d.uploaded_by_user_id,
                          p.slug as patient_slug,
                          doc.slug as doctor_slug,
                          f.slug as facility_slug,
                          me.title as event_title
                   FROM documents d
                   LEFT JOIN patients p ON d.patient_id = p.id
                   LEFT JOIN doctors doc ON d.doctor_id = doc.id
                   LEFT JOIN facilities f ON d.facility_id = f.id
                   LEFT JOIN medical_events me ON d.event_id = me.id
                   WHERE d.id = ?""",
                (doc_id,),
            )
            doc = await cursor.fetchone()

            # Use facility slug for path organization, fall back to doctor slug
            provider_slug = None
            event_slug = None
            summary_slug = None
            if doc:
                provider_slug = doc["facility_slug"] or doc["doctor_slug"]
                if doc["event_title"]:
                    from asclepius.pipeline.organizer import slugify_event
                    event_slug = slugify_event(doc["event_title"])
                # Generate AI filename
                from asclepius.pipeline.organizer import generate_ai_filename
                try:
                    doc_meta = {
                        "doc_type": doc["doc_type"],
                        "event_date": doc["event_date"],
                        "doctor_name": doc["doctor_slug"],
                        "facility_name": doc["facility_slug"],
                        "summary_en": doc["summary_en"],
                    }
                    summary_slug = await generate_ai_filename(llm, doc_meta)
                except Exception:
                    logger.warning("AI filename generation failed for doc %d, using summary fallback", doc_id)
                # Fallback to summary slug if AI failed
                if not summary_slug and doc["summary_en"]:
                    import re as _re
                    summary_slug = doc["summary_en"][:60].lower()
                    summary_slug = _re.sub(r"[^a-z0-9]+", "-", summary_slug)
                    summary_slug = _re.sub(r"-+", "-", summary_slug).strip("-")

            best_date = best_date_with_received(doc) if doc else None

            # Organize file
            dest_path = build_organized_path(
                config,
                doc["patient_slug"] if doc else None,
                best_date,
                provider_slug,
                doc["doc_type"] if doc else None,
                path.name,
                event_slug=event_slug,
                summary_slug=summary_slug,
                uploaded_by_user_id=doc["uploaded_by_user_id"] if doc else None,
            )
            final_path = move_file(config, file_path, dest_path)

            # Update document with final path, new filename, and status
            new_filename = Path(final_path).name
            await db.execute(
                """UPDATE documents SET
                   file_path = ?, original_filename = ?, status = 'done', updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (final_path, new_filename, doc_id),
            )
            await db.commit()

            pipeline_status["total_processed"] += 1
            pipeline_status["last_processed"] = path.name
            logger.info("Completed processing doc %d: %s -> %s", doc_id, path.name, final_path)

        except asyncio.CancelledError:
            # A hard cancel came in via ``cancel_running_task``. Mark the
            # doc cancelled, clear the cooperative flag, and re-raise so
            # the asyncio machinery sees the task as cancelled. The gate
            # slot and DB connection were released by the ``async with``
            # finalizers on the way out.
            logger.info("Pipeline task cancelled for %s", path.name)
            try:
                _doc_id = locals().get("doc_id")
                if _doc_id is not None:
                    cancelled_docs.discard(_doc_id)
                    await db.execute(
                        """UPDATE documents SET status = 'cancelled',
                           error_message = NULL,
                           updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                        (_doc_id,),
                    )
                    await db.commit()
            except Exception:
                pass
            raise
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}" if str(e) else f"{type(e).__name__} (no message)"
            logger.exception("Pipeline error for %s — %s", path.name, error_msg)
            pipeline_status["total_errors"] += 1
            pipeline_status["recent_errors"].append({
                "file": path.name,
                "error": error_msg,
            })
            pipeline_status["recent_errors"] = pipeline_status["recent_errors"][-10:]

            # Mark as failed with error message
            try:
                await db.execute(
                    """UPDATE documents SET status = 'failed', error_message = ?,
                       retry_count = COALESCE(retry_count, 0) + 1,
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                    (error_msg[:2000], doc_id),
                )
                await db.commit()
            except Exception:
                pass

            # Re-raise as ProviderUnreachableError if it's a connectivity issue
            if _is_provider_unreachable(e):
                raise ProviderUnreachableError(error_msg) from e
        finally:
            _doc_id = locals().get("doc_id")
            if _doc_id is not None:
                unregister_running_task(_doc_id)

    pipeline_status["processing"] = None
    pipeline_status["processing_step"] = None
    pipeline_status["processing_doc_id"] = None
    pipeline_status["processing_pages"] = None
    pipeline_status["processing_page_current"] = None
