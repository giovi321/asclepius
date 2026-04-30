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
from asclepius.pipeline.extractor import (
    _extract_type_specific,
    build_extraction_context,
    extract_and_store,
)
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


# Map intent keywords (extracted from the user's instruction) to the
# canonical doc_type whose ``extraction_<key>.yaml`` prompt we should
# run. Longest match wins so "lab tests" beats a stray "labs" elsewhere
# in the instruction. ``scope`` lists the child tables the extraction
# is allowed to wipe + re-insert, so a "labs" edit doesn't clobber the
# document's medications / encounters / vaccinations.
_INTENTS: list[tuple[str, set[str], tuple[str, ...]]] = [
    (
        "lab_test",
        {"lab_results"},
        (
            "lab tests",
            "blood tests",
            "blood test",
            "lab test",
            "labtest",
            "labs",
            "lab",
            "analisi",
            "blutbild",
            "bloodtest",
        ),
    ),
    (
        "prescription",
        {"medications"},
        (
            "medications",
            "medication",
            "prescriptions",
            "prescription",
            "drugs",
            "drug",
            "ricetta",
            "rezept",
            "meds",
        ),
    ),
    (
        "specialist_report",
        {"encounters"},
        (
            "diagnoses",
            "diagnosis",
            "encounter",
            "encounters",
            "findings",
        ),
    ),
    (
        "vaccination",
        {"vaccinations"},
        ("vaccination", "vaccine", "immunization", "impfung"),
    ),
    (
        "imaging_report",
        # Imaging report extraction populates encounters (findings live in
        # the encounter row), so scope it to encounters.
        {"encounters"},
        (
            "imaging report",
            "radiology",
            "imaging",
            "x-ray",
            "xray",
            "ct scan",
            "mri",
        ),
    ),
    (
        "invoice",
        {"invoice_items"},
        ("invoice", "bill", "billing", "fattura", "rechnung"),
    ),
    (
        "surgical_report",
        {"encounters"},
        ("surgical", "surgery", "operative", "intervento"),
    ),
]


def _detect_intent(instruction: str) -> tuple[str, set[str]] | None:
    """Return ``(doc_type, scope)`` matched in the user's instruction.

    Returns ``None`` when no clear intent can be detected, in which case
    the worker falls back to the legacy whole-document extraction path.
    """
    if not instruction:
        return None
    text = instruction.lower()
    best: tuple[int, str | None, set[str] | None] = (0, None, None)
    for doc_type, scope, keywords in _INTENTS:
        for kw in keywords:
            if kw in text:
                # Length-based scoring so "lab tests" beats "lab".
                if len(kw) > best[0]:
                    best = (len(kw), doc_type, scope)
                    break
    if best[1] is None or best[2] is None:
        return None
    return best[1], best[2]


async def ai_edit_document(
    doc_id: int,
    config: AppConfig,
    *,
    requested_pages: list[int],
    page_count: int,
    ocr_provider_id: str | None,
    llm_provider_id: str | None,
    re_run_ocr: bool,
    instruction: str = "",
) -> dict:
    """Run the AI editor's scoped page reprocess on the worker.

    Caller validates the request (pages in range, file_path resolves,
    provider ids exist) before enqueuing — this function only performs
    the work and persists results.

    ``instruction`` is the user's original natural-language prompt,
    used to detect intent (labs vs medications vs imaging…). When a
    clear intent is matched the worker runs the dedicated
    ``extraction_<doc_type>.yaml`` prompt and writes only the matching
    child table. When no intent is detected the worker falls back to
    the legacy whole-document extraction.
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

            # Detect intent so we can run the focused per-type prompt
            # (extraction_lab_test.yaml etc.) instead of the legacy
            # whole-document prompt. The whole-document prompt has a huge
            # JSON schema and qwen2.5:14b in particular tends to skip
            # lab_results when given partial OCR — the focused prompt
            # asks for just lab_results and is far more reliable.
            intent = _detect_intent(instruction)
            intent_type: str | None = intent[0] if intent else None
            scope: set[str] | None = intent[1] if intent else None

            # Run extract_and_store inside the LLM stage; let exceptions
            # escape the ``stage()`` so it records "failed" with the
            # message, then catch outside and persist on the document.
            extraction_error: str | None = None
            inserted_counts: dict[str, int] = {}
            try:
                async with stage(db, doc_id, STAGE_LLM_EXTRACTION, job_kind="ai_edit"):
                    if intent_type:
                        # Focused per-type extraction.
                        logger.info(
                            "AI-edit doc=%d using extraction_%s prompt (scope=%s)",
                            doc_id,
                            intent_type,
                            sorted(scope or []),
                        )
                        ctx = await build_extraction_context(db)
                        type_extraction = await _extract_type_specific(
                            llm,
                            scoped_ocr,
                            intent_type,
                            ctx,
                            db_path=config.database.path,
                        )
                        if isinstance(type_extraction, dict) and type_extraction.get("error"):
                            # parse_llm_json returns
                            # ``{"error": "Failed to parse extraction",
                            #    "raw_response": "<first 500 chars>"}``
                            # when the model emitted non-JSON. Surface the
                            # raw response so the user can see what the
                            # model said and pick a more capable provider.
                            raw = type_extraction.get("raw_response", "")
                            err = str(type_extraction["error"])
                            if raw:
                                err = f"{err}. LLM returned: {raw[:300]!r}"
                            raise RuntimeError(err)
                        if not isinstance(type_extraction, dict) or not type_extraction:
                            raise RuntimeError(
                                f"extraction_{intent_type} prompt returned no usable JSON. "
                                f"Try selecting a more capable LLM provider in the picker."
                            )
                        # If the focused prompt returned NO rows for the
                        # requested table, that's a strong signal the
                        # model didn't follow the schema (or there's
                        # genuinely nothing to extract). Surface the
                        # response shape so the user can decide.
                        scope_keys = list(scope or [])
                        if scope_keys and not any(
                            isinstance(type_extraction.get(k), list)
                            and len(type_extraction.get(k) or [])
                            for k in scope_keys
                        ):
                            keys_seen = sorted(type_extraction.keys())
                            raise RuntimeError(
                                f"extraction_{intent_type} returned 0 rows for "
                                f"{scope_keys}. Response keys: {keys_seen}. "
                                f"Either the OCR text on those pages didn't "
                                f"contain extractable {intent_type} data, or "
                                f"the LLM didn't follow the schema. Try a "
                                f"more capable LLM provider."
                            )
                        result = await extract_and_store(
                            db,
                            llm,
                            doc_id,
                            scoped_ocr,
                            config,
                            extraction_override=type_extraction,
                            scope=scope,
                        )
                    else:
                        # Fallback: legacy whole-document extraction.
                        result = await extract_and_store(db, llm, doc_id, scoped_ocr, config)
                    if isinstance(result, dict) and result.get("error"):
                        # extract_and_store handled the failure path
                        # internally; re-raise so the stage records as
                        # failed.
                        raise RuntimeError(str(result["error"]))
                    # Surface insert counts so the toast / log can tell
                    # the user something actually landed (or didn't).
                    for key in (
                        "lab_results",
                        "medications",
                        "diagnoses",
                        "vaccinations",
                    ):
                        v = result.get(key) if isinstance(result, dict) else None
                        if isinstance(v, list):
                            inserted_counts[key] = len(v)
            except Exception as exc:  # noqa: BLE001
                extraction_error = f"{type(exc).__name__}: {exc}".strip()
                logger.exception(
                    "AI-edit extraction failed for doc %d: %s", doc_id, extraction_error
                )
                await _persist_doc_warning(
                    db, doc_id, f"AI edit extraction failed: {extraction_error}"
                )
                return {"error": extraction_error}

            logger.info(
                "AI-edit doc=%d done: intent=%s scope=%s counts=%s",
                doc_id,
                intent_type,
                sorted(scope or []),
                inserted_counts,
            )

            # Note empty OCR pages in the worker log only. We deliberately
            # don't flip the document to ``needs_review`` here: when the
            # scoped extraction succeeded (e.g. 42 lab rows landed from
            # the non-empty pages), the document is in fine shape and a
            # red-banner status change is misleading. Empty pages are
            # surfaced via the API result instead so the frontend toast
            # can hint at them without changing the doc state.
            if empty_pages:
                logger.info(
                    "Doc %d: AI edit completed; OCR returned empty text on "
                    "page(s) %s, extraction used %s",
                    doc_id,
                    empty_pages,
                    used_pages,
                )

            # Clear any prior AI-edit / extraction error and mark the
            # document done — same shape as reprocess_document. Without
            # this, a successful AI edit run leaves a previous failure's
            # red banner sitting on the document.
            await db.execute(
                """UPDATE documents
                      SET status = 'done',
                          error_message = NULL,
                          updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                      AND status IN ('failed', 'needs_review', 'processing')""",
                (doc_id,),
            )
            await db.commit()

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
