"""Worker for the AI editor's scoped page reprocess.

Mirrors ``reprocess_document`` but for the AI editor's per-page flow:
re-OCR a chosen subset of pages with the chosen engine (or pull cached
OCR), update ``ocr_page_cache`` keyed by real PDF page numbers, then
re-run LLM extraction over the resulting text.

The HTTP handler enqueues an ``ai_edit`` job onto the pipeline queue
and returns immediately; the watcher's worker calls
``ai_edit_document`` exactly like it would for ``reprocess`` /
``translate`` jobs. Running on the worker means a 5-page Chandra OCR
run no longer holds the request open for several minutes (which is
what was generating proxy 502s).
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import aiosqlite

from asclepius.config import AppConfig, get_active_llm_provider_config
from asclepius.pipeline.extractor import extract_and_store
from asclepius.pipeline.ocr import extract_text_for_pages
from asclepius.pipeline.provider_factory import (
    ProviderUnreachableError,
    _build_llm_provider,
    get_llm_provider,
)
from asclepius.pipeline.stage_events import (
    STAGE_LLM_EXTRACTION,
    STAGE_OCR,
    begin_job,
    end_job,
    stage,
)
from asclepius.pipeline.state import PIPELINE_STATE

logger = logging.getLogger(__name__)


def _resolve_llm(config: AppConfig, llm_provider_id: str | None):
    """Pick the LLM provider for the extraction step. Falls back to the
    highest-priority enabled provider when no id is specified."""
    if llm_provider_id:
        for entry in config.llm.providers:
            if entry.id == llm_provider_id and entry.enabled:
                return _build_llm_provider(entry)
        raise RuntimeError(f"LLM provider '{llm_provider_id}' is not configured or disabled.")
    return get_llm_provider(config, priority=1)


async def ai_edit_document(
    doc_id: int,
    config: AppConfig,
    *,
    requested_pages: list[int],
    page_count: int,
    ocr_provider_id: str | None,
    llm_provider_id: str | None,
    re_run_ocr: bool,
) -> dict:
    """Run the AI editor's scoped page reprocess on the worker.

    Caller validates the request (pages in range, file_path resolves,
    provider ids exist) before enqueuing — this function only performs
    the work and persists results.
    """
    from asclepius.pipeline.processor import (
        register_running_task,
        unregister_running_task,
    )

    _current_task = asyncio.current_task()
    if _current_task is not None:
        register_running_task(doc_id, _current_task)

    in_range = sorted({int(n) for n in requested_pages if 1 <= int(n) <= page_count})
    if not in_range:
        return {"error": f"No requested page is within 1..{page_count}."}

    async with aiosqlite.connect(config.database.path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        cursor = await db.execute(
            "SELECT id, file_path, original_filename FROM documents WHERE id = ?",
            (doc_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            unregister_running_task(doc_id, _current_task)
            return {"error": "Document not found"}

        rel_path = doc["file_path"] or ""
        file_path = str(Path(config.vault.root_path) / rel_path) if rel_path else ""
        if re_run_ocr and (not file_path or not Path(file_path).exists()):
            unregister_running_task(doc_id, _current_task)
            return {"error": f"File not found on disk: {rel_path}"}

        # Plan the stages the dashboard / timeline should render.
        planned: list[str] = []
        if re_run_ocr:
            planned.append(STAGE_OCR)
        planned.append(STAGE_LLM_EXTRACTION)

        # Resolve the LLM credential id for the dashboard's model badge.
        llm_cred_id: str | None = None
        if llm_provider_id:
            for entry in config.llm.providers:
                if entry.id == llm_provider_id:
                    llm_cred_id = entry.credential_id or entry.id or None
                    break
        else:
            active = get_active_llm_provider_config(config, 1)
            if active:
                llm_cred_id = active.credential_id or active.id or None

        begin_job(
            doc_id=doc_id,
            filename=doc["original_filename"],
            kind="ai_edit",
            stages_planned=planned,
            providers={"ocr": ocr_provider_id or None, "llm": llm_cred_id},
        )
        # Mirror onto the legacy fields so the older topbar still updates.
        PIPELINE_STATE.pipeline_status["processing"] = doc["original_filename"]
        PIPELINE_STATE.pipeline_status["processing_doc_id"] = doc_id

        try:
            logger.info(
                "AI-edit worker doc=%d pages=%s (of %d) re_run_ocr=%s ocr=%s llm=%s",
                doc_id,
                in_range,
                page_count,
                re_run_ocr,
                ocr_provider_id,
                llm_provider_id or "default",
            )

            ocr_for_pages: dict[int, str] = {}
            empty_pages: list[int] = []

            # Phase 1 — re-OCR the chosen pages, OR pull cached OCR.
            # Exceptions inside the ``stage()`` block intentionally
            # propagate so the stage_event row is recorded as "failed"
            # with the exception message; the outer try/except below
            # then turns that into the worker's error result + persists
            # the message onto the document so the user sees it in the UI.
            if re_run_ocr:
                async with stage(
                    db, doc_id, STAGE_OCR, job_kind="ai_edit", page_total=len(in_range)
                ) as p:
                    fresh = await extract_text_for_pages(
                        file_path,
                        config,
                        in_range,
                        ocr_provider_id=ocr_provider_id,
                    )

                    for i, page_num in enumerate(in_range, start=1):
                        p.set_page(i)
                        page_text = (fresh.get(page_num) or "").strip()
                        if not page_text:
                            empty_pages.append(page_num)
                            logger.warning(
                                "AI-edit: OCR returned empty text for doc=%d page=%d",
                                doc_id,
                                page_num,
                            )
                            continue
                        await db.execute(
                            """INSERT INTO ocr_page_cache
                                  (document_id, page_number, ocr_text, ocr_engine, confidence)
                               VALUES (?, ?, ?, ?, ?)
                               ON CONFLICT(document_id, page_number) DO UPDATE SET
                                  ocr_text = excluded.ocr_text,
                                  ocr_engine = excluded.ocr_engine,
                                  confidence = excluded.confidence""",
                            (
                                doc_id,
                                page_num,
                                page_text,
                                f"ai_edit:{ocr_provider_id}",
                                0.0,
                            ),
                        )
                        ocr_for_pages[page_num] = page_text
                    await db.commit()
            else:
                cursor = await db.execute(
                    "SELECT page_number, ocr_text FROM ocr_page_cache "
                    "WHERE document_id = ? AND page_number IN ("
                    + ",".join(["?"] * len(in_range))
                    + ")",
                    (doc_id, *in_range),
                )
                for r in await cursor.fetchall():
                    txt = (r["ocr_text"] or "").strip()
                    if txt:
                        ocr_for_pages[int(r["page_number"])] = txt
                empty_pages = [p for p in in_range if p not in ocr_for_pages]

            used_pages = sorted(ocr_for_pages)
            if not used_pages:
                msg = (
                    "OCR returned no text for the requested pages."
                    if re_run_ocr
                    else "None of the requested pages have cached OCR text."
                )
                logger.warning("AI-edit doc=%d: %s", doc_id, msg)
                await _persist_doc_warning(db, doc_id, msg)
                return {"error": msg}

            scoped_ocr = "\n\n".join(ocr_for_pages[n] for n in used_pages)

            # Phase 2 — re-extract from the OCR text (fresh or cached).
            try:
                llm = _resolve_llm(config, llm_provider_id)
            except (ProviderUnreachableError, RuntimeError) as e:
                await _persist_doc_warning(db, doc_id, str(e))
                return {"error": str(e)}

            # Run extract_and_store inside the LLM stage; let exceptions
            # escape the ``stage()`` so it records "failed" with the
            # message, then catch outside and persist on the document.
            extraction_error: str | None = None
            try:
                async with stage(db, doc_id, STAGE_LLM_EXTRACTION, job_kind="ai_edit"):
                    result = await extract_and_store(db, llm, doc_id, scoped_ocr, config)
                    if isinstance(result, dict) and result.get("error"):
                        # extract_and_store handled the failure path
                        # internally (it sets status='failed' on the
                        # documents row when extraction has an error
                        # key). Re-raise so the stage records as failed.
                        raise RuntimeError(str(result["error"]))
            except Exception as exc:  # noqa: BLE001
                extraction_error = f"{type(exc).__name__}: {exc}".strip()
                logger.exception(
                    "AI-edit extraction failed for doc %d: %s", doc_id, extraction_error
                )
                await _persist_doc_warning(
                    db, doc_id, f"AI edit extraction failed: {extraction_error}"
                )
                return {"error": extraction_error}

            # Surface partial-OCR result on the document so the user knows
            # which pages came back blank and might want to re-OCR them.
            if empty_pages:
                note = (
                    f"AI edit: OCR returned empty text for page(s) "
                    f"{empty_pages}; extraction used pages {used_pages}."
                )
                logger.info("Doc %d: %s", doc_id, note)
                await _persist_doc_warning(db, doc_id, note, status="needs_review")

            return {
                "status": "reprocessed",
                "document_id": doc_id,
                "pages": used_pages,
                "empty_pages": empty_pages,
                "page_count": page_count,
                "re_run_ocr": re_run_ocr,
                "ocr_provider_id": ocr_provider_id,
                "llm_provider_id": llm_provider_id,
            }
        finally:
            end_job()
            unregister_running_task(doc_id, _current_task)


async def _persist_doc_warning(
    db: aiosqlite.Connection,
    doc_id: int,
    message: str,
    *,
    status: str | None = None,
) -> None:
    """Surface a worker-side issue on the document so the user sees it.

    Writes ``error_message`` (capped at 1000 chars) and optionally
    flips ``status``. The document detail page renders ``error_message``
    inside the status block when status is ``failed`` or
    ``needs_review``, which is exactly the visibility we want here.
    """
    try:
        if status:
            await db.execute(
                """UPDATE documents SET error_message = ?, status = ?,
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (message[:1000], status, doc_id),
            )
        else:
            await db.execute(
                """UPDATE documents SET error_message = ?,
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (message[:1000], doc_id),
            )
        await db.commit()
    except Exception:
        # Best-effort — never let the message-persist itself crash the worker.
        logger.warning(
            "Failed to persist AI-edit warning on doc %d (non-fatal)", doc_id, exc_info=True
        )
