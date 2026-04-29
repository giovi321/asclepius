"""On-demand body-translation worker.

Re-uses the document's already-cached OCR text — never runs OCR again.
Strips Chandra HTML markup before sending to the LLM. Persists the
result to ``documents.ocr_text_en``, overwriting any previous run.
"""

from __future__ import annotations

import asyncio
import logging

import aiosqlite

from asclepius.config import AppConfig
from asclepius.llm.prompt_manager import get_prompt
from asclepius.pipeline.chunked_extraction import _build_page_chunks, _load_pages
from asclepius.pipeline.provider_factory import _build_llm_provider, get_llm_provider
from asclepius.pipeline.stage_events import (
    STAGE_TRANSLATION,
    begin_job,
    stage,
)
from asclepius.pipeline.state import PIPELINE_STATE
from asclepius.pipeline.text_utils import strip_chandra_markup

logger = logging.getLogger(__name__)

_TRANSLATION_CHUNK_CHARS = 8000


def _is_cancelled(doc_id: int) -> bool:
    from asclepius.pipeline.processor import cancelled_docs

    return doc_id in cancelled_docs


async def _mark_cancelled(db: aiosqlite.Connection, doc_id: int) -> None:
    from asclepius.pipeline.processor import cancelled_docs

    cancelled_docs.discard(doc_id)


async def translate_document(
    doc_id: int,
    config: AppConfig,
    llm_provider_id: str | None = None,
    resolved_providers: dict[str, str | None] | None = None,
) -> dict:
    """Translate ``documents.ocr_text`` to English and persist as ``ocr_text_en``.

    Returns a dict with ``status`` and ``document_id``. Does not modify
    the document's pipeline ``status`` — translation is an independent
    side-job that leaves the document's main lifecycle alone.
    """
    from asclepius.pipeline.processor import (
        register_running_task,
        unregister_running_task,
    )

    _current_task = asyncio.current_task()
    if _current_task is not None:
        register_running_task(doc_id, _current_task)

    async with aiosqlite.connect(config.database.path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        cursor = await db.execute(
            "SELECT id, ocr_text, ocr_engine, original_filename FROM documents WHERE id = ?",
            (doc_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            unregister_running_task(doc_id, _current_task)
            return {"error": "Document not found"}

        ocr_text = doc["ocr_text"] or ""
        if not ocr_text.strip():
            unregister_running_task(doc_id, _current_task)
            return {"error": "Document has no OCR text to translate"}

        begin_job(
            doc_id=doc_id,
            filename=doc["original_filename"],
            kind="translate",
            stages_planned=[STAGE_TRANSLATION],
            providers=resolved_providers,
        )
        PIPELINE_STATE.pipeline_status["processing"] = doc["original_filename"]
        PIPELINE_STATE.pipeline_status["processing_doc_id"] = doc_id
        PIPELINE_STATE.pipeline_status["processing_step"] = STAGE_TRANSLATION

        if _is_cancelled(doc_id):
            await _mark_cancelled(db, doc_id)
            unregister_running_task(doc_id, _current_task)
            return {"status": "cancelled", "document_id": doc_id}

        cleaned = strip_chandra_markup(ocr_text)
        if not cleaned.strip():
            unregister_running_task(doc_id, _current_task)
            return {"error": "OCR text contained no translatable content after markup strip"}

        if llm_provider_id:
            entry = next(
                (p for p in config.llm.providers if p.id == llm_provider_id and p.enabled),
                None,
            )
            llm = _build_llm_provider(entry) if entry else get_llm_provider(config)
        else:
            llm = get_llm_provider(config)

        prompt_template = await get_prompt(config.database.path, "translation_en")

        # Reuse the page-aware chunker so paragraph and table boundaries
        # are respected. ``cleaned`` lacks page-cache parity with
        # ``ocr_text``, so we feed page text drawn from the cleaned body.
        raw_pages = await _load_pages(db, doc_id, ocr_text)
        cleaned_pages = [strip_chandra_markup(p) for p in raw_pages]
        cleaned_pages = [p for p in cleaned_pages if p.strip()] or [cleaned]
        chunks = _build_page_chunks(cleaned_pages, _TRANSLATION_CHUNK_CHARS)
        total_chunks = len(chunks)

        try:
            async with stage(
                db,
                doc_id,
                STAGE_TRANSLATION,
                job_kind="translate",
                page_total=total_chunks,
            ) as progress:
                translated_parts: list[str] = []
                for index, chunk in enumerate(chunks, start=1):
                    if _is_cancelled(doc_id):
                        raise asyncio.CancelledError()

                    progress.set_page(index, total=total_chunks)

                    user_message = prompt_template.format(ocr_text=chunk["text"])
                    response = await llm.chat(
                        messages=[{"role": "user", "content": user_message}],
                        system_prompt="You translate medical documents to English following the user's rules precisely.",
                    )
                    translated_parts.append(response.strip())

                translated = "\n\n".join(p for p in translated_parts if p).strip()
                if not translated:
                    raise RuntimeError("LLM returned empty translation")

                # Store just the model id, not the verbose provider_label
                # ("DisplayName · model_id"). Otherwise the frontend chip
                # reads like duplicated information when the credential's
                # display name happens to match the model name.
                model_label = (
                    getattr(llm, "_gate_model", None)
                    or getattr(llm, "model", None)
                    or llm_provider_id
                    or "default"
                )
                await db.execute(
                    """UPDATE documents SET
                           ocr_text_en = ?,
                           ocr_text_en_model = ?,
                           ocr_text_en_translated_at = CURRENT_TIMESTAMP,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE id = ?""",
                    (translated, model_label, doc_id),
                )
                await db.commit()
                logger.info(
                    "Translation complete for doc %d (%d chunk(s), model=%s)",
                    doc_id,
                    total_chunks,
                    model_label,
                )

            return {"status": "done", "document_id": doc_id}

        except asyncio.CancelledError:
            logger.info("Translate task cancelled for doc %d", doc_id)
            try:
                await _mark_cancelled(db, doc_id)
            except Exception:
                pass
            raise
        except Exception as e:
            logger.exception("Translation failed for doc %d", doc_id)
            error_msg = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
            return {"error": error_msg}
        finally:
            unregister_running_task(doc_id, _current_task)
