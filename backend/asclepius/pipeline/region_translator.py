"""On-demand region OCR + translation worker.

Crops a user-selected rectangle on a single PDF page, OCRs that crop
with the chosen provider, then translates the OCR text to English with
the chosen LLM. Persists a thumbnail PNG and a row in
``region_translations``. Independent of the whole-document
``translate`` flow which writes to ``documents.ocr_text_en``.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from pathlib import Path

import aiosqlite
import fitz  # pymupdf
import pytesseract
from PIL import Image

from asclepius.config import AppConfig, OcrProviderEntry
from asclepius.db.connection import open_db
from asclepius.llm.prompt_manager import get_prompt
from asclepius.pipeline.ocr import (
    _compress_image_for_vision,
    _llm_vision_page_with_retry,
)
from asclepius.pipeline.provider_factory import _build_llm_provider, get_llm_provider
from asclepius.pipeline.stage_events import (
    STAGE_REGION_OCR,
    STAGE_REGION_TRANSLATION,
    begin_job,
    stage,
)
from asclepius.pipeline.state import PIPELINE_STATE
from asclepius.pipeline.text_utils import strip_chandra_markup
from asclepius.util.paths import safe_vault_join

# Below this OCR-input length we use the floor instead of the actual
# length when computing the max-expansion-ratio denominator. Without
# this, a 5-char OCR input ("Hello") would let the LLM emit at most
# 50 chars on a 10× ratio — too tight for legitimate short-input
# translations that include explanatory context.
_RATIO_INPUT_FLOOR_CHARS = 200
_TRUNCATION_MARKER = "\n\n[truncated]"

logger = logging.getLogger(__name__)


def _is_cancelled(doc_id: int) -> bool:
    from asclepius.pipeline.processor import cancelled_docs

    return doc_id in cancelled_docs


def _resolve_ocr_provider(
    config: AppConfig, ocr_provider_id: str | None
) -> OcrProviderEntry | None:
    if ocr_provider_id:
        for p in config.ocr.providers:
            if p.id == ocr_provider_id and p.enabled:
                return p
    enabled = sorted(
        (p for p in config.ocr.providers if p.enabled),
        key=lambda p: p.priority,
    )
    return enabled[0] if enabled else None


async def _ocr_pil_image(
    img: Image.Image,
    config: AppConfig,
    provider: OcrProviderEntry | None,
) -> tuple[str, str]:
    """OCR a single PIL image. Returns ``(text, engine_label)``.

    Handles the two engines actually used in the field — Tesseract and
    LLM-vision. ``tesseract_remote`` and ``google_vision`` fall back to
    local Tesseract because there is no per-image entry point for them
    in this codebase yet.
    """
    if provider is not None and provider.type == "llm_vision":
        b64 = _compress_image_for_vision(img)
        text = await _llm_vision_page_with_retry(
            b64,
            config,
            provider.llm_model or config.ocr.llm_vision_model,
            provider_entry=provider,
        )
        return text, provider.name or "llm_vision"

    lang = (provider.language if provider else None) or config.ocr.language
    text = pytesseract.image_to_string(img, lang=lang)
    label = (provider.name if provider else None) or "tesseract"
    return text, label


async def translate_region(
    doc_id: int,
    config: AppConfig,
    *,
    region_row_id: int,
    page: int,
    bbox: dict[str, float],
    ocr_provider_id: str | None = None,
    llm_provider_id: str | None = None,
    resolved_providers: dict[str, str | None] | None = None,
    target_language: str | None = None,
    share_id: int | None = None,
) -> dict:
    """Crop, OCR, and translate the region pre-allocated as ``region_row_id``.

    The route handler INSERTs an empty row before enqueuing so the
    timeline / region-translations list can show a placeholder; this
    worker fills in ocr_text, translated_text, and thumbnail_path on
    success, or surfaces the failure through stage events.
    """
    from asclepius.pipeline.processor import (
        register_running_task,
        unregister_running_task,
    )

    _current_task = asyncio.current_task()
    if _current_task is not None:
        register_running_task(doc_id, _current_task)

    resolved_target_language = (
        target_language or getattr(config.llm, "translation_target_language", "") or "English"
    )

    async with open_db() as db:
        cursor = await db.execute(
            "SELECT id, file_path, original_filename FROM documents WHERE id = ?",
            (doc_id,),
        )
        doc = await cursor.fetchone()
        if not doc:
            unregister_running_task(doc_id, _current_task)
            return {"error": "Document not found"}
        if not doc["file_path"]:
            unregister_running_task(doc_id, _current_task)
            return {"error": "Document has no file on disk"}

        vault_root = Path(config.vault.root_path)
        try:
            pdf_path = safe_vault_join(vault_root, doc["file_path"])
        except Exception as exc:
            unregister_running_task(doc_id, _current_task)
            return {"error": f"Invalid file path: {exc}"}
        if not pdf_path.is_file():
            unregister_running_task(doc_id, _current_task)
            return {"error": "File missing on disk"}

        ocr_provider = _resolve_ocr_provider(config, ocr_provider_id)
        begin_job(
            doc_id=doc_id,
            filename=doc["original_filename"],
            kind="translate_region",
            stages_planned=[STAGE_REGION_OCR, STAGE_REGION_TRANSLATION],
            providers=resolved_providers,
        )
        PIPELINE_STATE.pipeline_status["processing"] = doc["original_filename"]
        PIPELINE_STATE.pipeline_status["processing_doc_id"] = doc_id

        if _is_cancelled(doc_id):
            from asclepius.pipeline.processor import cancelled_docs

            cancelled_docs.discard(doc_id)
            unregister_running_task(doc_id, _current_task)
            return {"status": "cancelled", "document_id": doc_id}

        # ─── Crop ──────────────────────────────────────────────
        try:
            pdf = fitz.open(str(pdf_path))
        except Exception as exc:
            await _mark_region_failed(db, region_row_id, f"open_pdf: {exc}")
            unregister_running_task(doc_id, _current_task)
            return {"error": f"Failed to open PDF: {exc}"}

        try:
            if page < 1 or page > pdf.page_count:
                await _mark_region_failed(db, region_row_id, "page_out_of_range")
                return {"error": f"Page {page} out of range (1..{pdf.page_count})"}
            fz_page = pdf[page - 1]
            rect = fz_page.rect
            x0 = rect.x0 + max(0.0, min(1.0, bbox["x"])) * rect.width
            y0 = rect.y0 + max(0.0, min(1.0, bbox["y"])) * rect.height
            x1 = x0 + max(0.0, min(1.0, bbox["w"])) * rect.width
            y1 = y0 + max(0.0, min(1.0, bbox["h"])) * rect.height
            clip = fitz.Rect(x0, y0, x1, y1)
            if clip.is_empty or clip.width < 2 or clip.height < 2:
                await _mark_region_failed(db, region_row_id, "region_too_small")
                return {"error": "Selected region is too small"}

            try:
                pix = fz_page.get_pixmap(dpi=300, clip=clip)
            except Exception as exc:
                await _mark_region_failed(db, region_row_id, f"render: {exc}")
                return {"error": f"Failed to render region: {exc}"}

            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        finally:
            pdf.close()

        # Persist thumbnail under the vault root.
        thumb_dir = vault_root / "region_translations" / str(doc_id)
        thumb_dir.mkdir(parents=True, exist_ok=True)
        thumb_name = f"{uuid.uuid4().hex}.png"
        thumb_path = thumb_dir / thumb_name
        img.save(str(thumb_path), format="PNG", optimize=True)
        thumb_relpath = (Path("region_translations") / str(doc_id) / thumb_name).as_posix()
        await db.execute(
            "UPDATE region_translations SET thumbnail_path = ? WHERE id = ?",
            (thumb_relpath, region_row_id),
        )
        await db.commit()

        try:
            # ─── OCR ───────────────────────────────────────────
            async with stage(db, doc_id, STAGE_REGION_OCR, job_kind="translate_region"):
                if _is_cancelled(doc_id):
                    raise asyncio.CancelledError()
                ocr_text, _ = await _ocr_pil_image(img, config, ocr_provider)
                # Chandra and other Vision-LLM engines emit a wall of
                # ``<div data-bbox=...>`` tags that the LLM faithfully
                # echoes into the translation. Strip the markup before
                # we either persist or send it onward — the
                # ``strip_chandra_markup`` helper preserves alt /
                # data-label captions and paragraph structure, just
                # without the layout DOM.
                ocr_text = strip_chandra_markup((ocr_text or "").strip())
                await db.execute(
                    "UPDATE region_translations SET ocr_text = ? WHERE id = ?",
                    (ocr_text, region_row_id),
                )
                await db.commit()

            if not ocr_text:
                await _mark_region_failed(db, region_row_id, "no_text_detected")
                return {"error": "No text detected in selected region"}

            # ─── Translate ─────────────────────────────────────
            async with stage(db, doc_id, STAGE_REGION_TRANSLATION, job_kind="translate_region"):
                if _is_cancelled(doc_id):
                    raise asyncio.CancelledError()
                if llm_provider_id:
                    entry = next(
                        (p for p in config.llm.providers if p.id == llm_provider_id and p.enabled),
                        None,
                    )
                    llm = _build_llm_provider(entry) if entry else get_llm_provider(config)
                else:
                    llm = get_llm_provider(config)

                prompt_template = await get_prompt(config.database.path, "translation")
                user_message = prompt_template.format(
                    ocr_text=ocr_text,
                    target_language=resolved_target_language,
                )
                response = await llm.chat(
                    messages=[{"role": "user", "content": user_message}],
                    system_prompt=(
                        f"You translate medical documents to {resolved_target_language} "
                        "following the user's rules precisely."
                    ),
                )
                translated = (response or "").strip()
                if not translated:
                    raise RuntimeError("LLM returned empty translation")

                # ── Output-size guardrails (prompt-injection defense) ──
                # The LLM has no tool-use anywhere in this codebase, so
                # the worst a successful injection can do is emit
                # nonsense or an oversized payload. These two checks cap
                # the blast radius:
                max_chars = max(1, int(config.share.max_translation_chars))
                ratio = float(config.share.translation_max_expansion_ratio)
                denominator = max(len(ocr_text), _RATIO_INPUT_FLOOR_CHARS)
                truncated_flag = False
                if ratio > 0 and len(translated) > ratio * denominator:
                    # Catches "OCR is 50 chars, output is 50 KB" cases.
                    # Reject outright — do NOT persist the translation,
                    # mark the row failed, surface a useful error.
                    reason = (
                        f"translation_too_long ({len(translated)} chars "
                        f"> {int(ratio)}× {denominator})"
                    )
                    await _mark_region_failed(db, region_row_id, reason)
                    if config.share.translation_audit_enabled and share_id is not None:
                        await _audit_translation_done(
                            db,
                            share_id=share_id,
                            region_row_id=region_row_id,
                            ocr_text=ocr_text,
                            translated_len=len(translated),
                            llm_model=str(
                                getattr(llm, "_gate_model", None)
                                or getattr(llm, "model", None)
                                or llm_provider_id
                                or "default"
                            ),
                            target_language=resolved_target_language,
                            truncated=False,
                            rejected_reason="ratio",
                        )
                    raise RuntimeError(reason)
                if len(translated) > max_chars:
                    # Past the absolute cap: keep the leading chars and
                    # append a visible marker so the doctor sees the
                    # truncation rather than silently shortened output.
                    keep = max(0, max_chars - len(_TRUNCATION_MARKER))
                    translated = translated[:keep] + _TRUNCATION_MARKER
                    truncated_flag = True

                model_label = (
                    getattr(llm, "_gate_model", None)
                    or getattr(llm, "model", None)
                    or llm_provider_id
                    or "default"
                )
                await db.execute(
                    """UPDATE region_translations
                          SET translated_text = ?, llm_model = ?, target_language = ?
                        WHERE id = ?""",
                    (translated, model_label, resolved_target_language, region_row_id),
                )
                await db.commit()

                if config.share.translation_audit_enabled and share_id is not None:
                    await _audit_translation_done(
                        db,
                        share_id=share_id,
                        region_row_id=region_row_id,
                        ocr_text=ocr_text,
                        translated_len=len(translated),
                        llm_model=str(model_label),
                        target_language=resolved_target_language,
                        truncated=truncated_flag,
                        rejected_reason=None,
                    )

            logger.info(
                "Region translation complete for doc=%d region=%d (model=%s)",
                doc_id,
                region_row_id,
                model_label,
            )
            return {"status": "done", "document_id": doc_id, "region_id": region_row_id}

        except asyncio.CancelledError:
            logger.info("Region translate cancelled for doc=%d", doc_id)
            try:
                from asclepius.pipeline.processor import cancelled_docs

                cancelled_docs.discard(doc_id)
                await _mark_region_failed(db, region_row_id, "cancelled")
            except Exception:
                pass
            raise
        except Exception as exc:
            logger.exception("Region translation failed for doc=%d", doc_id)
            error_msg = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
            await _mark_region_failed(db, region_row_id, error_msg[:500])
            return {"error": error_msg}
        finally:
            unregister_running_task(doc_id, _current_task)


async def _audit_translation_done(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    region_row_id: int,
    ocr_text: str,
    translated_len: int,
    llm_model: str,
    target_language: str,
    truncated: bool,
    rejected_reason: str | None,
) -> None:
    """Write a ``translate_region_done`` row to the share audit log so an
    admin can spot-check what doctors are translating without reading
    every translation by hand.

    The OCR input itself is already stored in ``region_translations``;
    we record its SHA-256 here so the admin can verify the audit row
    refers to a specific translation without having to JOIN.

    Best-effort: a failure here must never break the user-facing path.
    """
    try:
        from asclepius.share.service import write_audit

        ocr_sha = hashlib.sha256((ocr_text or "").encode("utf-8")).hexdigest()
        detail: dict = {
            "kind": "region",
            "region_id": region_row_id,
            "ocr_sha256": ocr_sha,
            "ocr_len": len(ocr_text or ""),
            "translated_len": translated_len,
            "llm_model": llm_model,
            "target_language": target_language,
            "truncated": truncated,
        }
        if rejected_reason:
            detail["rejected"] = rejected_reason
        await write_audit(
            db,
            share_id=share_id,
            action="translate_region_done",
            detail=detail,
        )
    except Exception:
        logger.debug("Translation-done audit write failed", exc_info=True)


async def _mark_region_failed(db: aiosqlite.Connection, region_row_id: int, reason: str) -> None:
    try:
        await db.execute(
            """UPDATE region_translations
                  SET translated_text = COALESCE(translated_text, ?)
                WHERE id = ? AND translated_text IS NULL""",
            (f"[failed: {reason}]", region_row_id),
        )
        await db.commit()
    except Exception:
        logger.warning("Failed to mark region row %d as failed", region_row_id, exc_info=True)
