"""Per-document pipeline stage tracking.

Wraps the existing ``pipeline_status["processing_step"] = ...`` pattern with a
context manager that ALSO writes a row to ``document_stage_events``. The result
is a persistent timeline the document detail view can show, plus a richer
in-memory ``current_job`` block on the pipeline status dict for the dashboard.

Single source of truth: every stage call updates both the in-memory status and
the DB. The DB write is best-effort — if it fails, the live status still
reflects reality so the worker doesn't crash on a logging-only side effect.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime
from typing import Any

import aiosqlite

from asclepius.pipeline.state import PIPELINE_STATE

logger = logging.getLogger(__name__)


# Canonical stage names. The frontend renders these via a label map; new stages
# need an entry there too.
STAGE_OCR = "ocr"
STAGE_VISION_EXTRACTION = "vision_extraction"
STAGE_LLM_EXTRACTION = "llm_extraction"
STAGE_PAGE_CLASSIFICATION = "page_classification"
STAGE_SECTION_EXTRACTION = "section_extraction"
STAGE_ORGANIZING = "organizing"
STAGE_THUMBNAIL = "thumbnail"
STAGE_CACHE_OCR = "cache_ocr"
STAGE_TRANSLATION = "translation"
STAGE_REGION_OCR = "region_ocr"
STAGE_REGION_TRANSLATION = "region_translation"
# Wraps the AI editor's scoped page reprocess so the document timeline
# shows ai_edit → ocr → llm_extraction in the same shape as a normal
# reprocess.
STAGE_AI_EDIT = "ai_edit"


def plan_stages(*, flow: str, mode: str | None = None, has_ocr_text: bool = False) -> list[str]:
    """Predict the stages a job will go through, given the flow and reprocess mode.

    Used to pre-fill ``pipeline_status["current_job"]["stages_planned"]`` so the
    dashboard can render a stepper before the work actually starts.

    flow:    "ocr_llm" | "vision_llm" | "reprocess"
    mode:    only meaningful when flow=="reprocess": "ocr" | "llm" | "both" | "vision_llm"
    has_ocr_text: only meaningful for reprocess mode=="llm" — when there's no
                  cached OCR we still run OCR before LLM.
    """
    if flow == "vision_llm":
        return [STAGE_VISION_EXTRACTION, STAGE_LLM_EXTRACTION, STAGE_ORGANIZING]
    if flow == "reprocess":
        if mode == "vision_llm":
            return [STAGE_VISION_EXTRACTION, STAGE_LLM_EXTRACTION]
        if mode == "ocr":
            return [STAGE_OCR]
        if mode == "llm":
            return [STAGE_OCR, STAGE_LLM_EXTRACTION] if not has_ocr_text else [STAGE_LLM_EXTRACTION]
        # "both" (default)
        return [STAGE_OCR, STAGE_LLM_EXTRACTION]
    # Default upload flow.
    return [STAGE_OCR, STAGE_LLM_EXTRACTION, STAGE_ORGANIZING]


class _ProgressHandle:
    """Thin handle yielded from ``stage()`` so the body can update page progress.

    ``set_page(n)`` writes through to ``pipeline_status["processing_page_current"]``
    and stashes the latest value to be persisted on the row when the stage ends.
    """

    __slots__ = ("_status", "page_current", "page_total")

    def __init__(self, status: dict[str, Any], page_total: int | None):
        self._status = status
        self.page_current = 0
        self.page_total = page_total

    def set_page(self, current: int, total: int | None = None) -> None:
        self.page_current = current
        if total is not None:
            self.page_total = total
            self._status["processing_pages"] = total
        self._status["processing_page_current"] = current


def _provider_for_stage(stage_name: str, providers: dict[str, Any] | None) -> str | None:
    """Pick the provider id that drives ``stage_name`` from the job's
    resolved providers dict. ``ocr`` and ``cache_ocr`` map to the OCR
    provider, ``vision_extraction`` to the Vision provider, everything
    else (LLM extraction, classification, sections, etc.) to the LLM."""
    if not providers:
        return None
    if stage_name in ("ocr", "cache_ocr", "region_ocr"):
        return providers.get("ocr")
    if stage_name == "vision_extraction":
        return providers.get("vision")
    return providers.get("llm")


@contextlib.asynccontextmanager
async def stage(
    db: aiosqlite.Connection,
    doc_id: int | None,
    stage_name: str,
    *,
    job_kind: str,
    page_total: int | None = None,
):
    """Bracket a pipeline stage with status updates and a persisted event row.

    Usage:

        async with stage(db, doc_id, STAGE_OCR, job_kind="upload", page_total=49) as p:
            for i, page in enumerate(pages, start=1):
                p.set_page(i)
                ...

    On normal exit: writes a ``completed`` event.
    On asyncio.CancelledError: writes ``cancelled`` and re-raises.
    On any other exception: writes ``failed`` with the error message and re-raises.

    A ``doc_id`` of None is allowed — the in-memory status still updates but no
    DB row is written. This handles the early phase of ``process_file`` before
    the documents row exists.
    """
    status = PIPELINE_STATE.pipeline_status
    started = datetime.utcnow().isoformat(timespec="seconds")

    # In-memory status updates: mirror what each call site used to do inline.
    status["processing_step"] = stage_name
    if doc_id is not None:
        status["processing_doc_id"] = doc_id
    if page_total is not None:
        status["processing_pages"] = page_total
        status["processing_page_current"] = 0
    else:
        status["processing_pages"] = None
        status["processing_page_current"] = None

    # Reflect the stage on the richer current_job block too.
    job = status.get("current_job") or {}
    job["stage"] = stage_name
    job["page_total"] = page_total
    job["page_current"] = 0 if page_total else None
    job["stage_provider"] = _provider_for_stage(stage_name, job.get("providers"))
    status["current_job"] = job

    handle = _ProgressHandle(status, page_total)

    try:
        yield handle
    except asyncio.CancelledError:
        await _record(db, doc_id, stage_name, "cancelled", job_kind, started, handle, message=None)
        raise
    except Exception as exc:
        msg = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        await _record(
            db, doc_id, stage_name, "failed", job_kind, started, handle, message=msg[:1000]
        )
        raise
    else:
        await _record(db, doc_id, stage_name, "completed", job_kind, started, handle, message=None)
        # Mark this stage done on the live current_job block.
        job = status.get("current_job") or {}
        done = list(job.get("stages_done") or [])
        if stage_name not in done:
            done.append(stage_name)
        job["stages_done"] = done
        status["current_job"] = job


async def _record(
    db: aiosqlite.Connection | None,
    doc_id: int | None,
    stage_name: str,
    event_status: str,
    job_kind: str,
    started_at: str,
    handle: _ProgressHandle,
    *,
    message: str | None,
) -> None:
    """Best-effort INSERT into document_stage_events. Logged but never raised."""
    if db is None or doc_id is None:
        return
    try:
        await db.execute(
            """INSERT INTO document_stage_events
               (document_id, stage, status, job_kind, message,
                page_current, page_total, started_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                stage_name,
                event_status,
                job_kind,
                message,
                handle.page_current or None,
                handle.page_total,
                started_at,
            ),
        )
        await db.commit()
    except Exception:
        logger.warning(
            "Failed to persist stage event (doc=%s stage=%s status=%s) — non-fatal",
            doc_id,
            stage_name,
            event_status,
            exc_info=True,
        )


async def record_stage(
    db: aiosqlite.Connection | None,
    doc_id: int | None,
    stage_name: str,
    event_status: str,
    job_kind: str,
    *,
    started_at: str | None = None,
    message: str | None = None,
    page_current: int | None = None,
    page_total: int | None = None,
) -> None:
    """One-shot stage recorder for legacy code that doesn't fit the context
    manager. Best-effort: failures are logged but never re-raised, so a hiccup
    on the events table never breaks an actual extraction run.

    Also flips the stage's entry into ``stages_done`` on the live current_job
    block when the event marks completion / skip — that's what drives the
    dashboard stepper's check marks.
    """
    if db is None or doc_id is None:
        return
    try:
        await db.execute(
            """INSERT INTO document_stage_events
               (document_id, stage, status, job_kind, message,
                page_current, page_total, started_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                stage_name,
                event_status,
                job_kind,
                message,
                page_current,
                page_total,
                started_at,
            ),
        )
        await db.commit()
    except Exception:
        logger.warning(
            "Failed to persist stage event (doc=%s stage=%s status=%s) — non-fatal",
            doc_id,
            stage_name,
            event_status,
            exc_info=True,
        )

    if event_status in ("completed", "skipped"):
        job = PIPELINE_STATE.pipeline_status.get("current_job")
        if isinstance(job, dict):
            done = list(job.get("stages_done") or [])
            if stage_name not in done:
                done.append(stage_name)
            job["stages_done"] = done


def begin_job(
    *,
    doc_id: int | None,
    filename: str | None,
    kind: str,
    stages_planned: list[str],
    providers: dict[str, str | None] | None = None,
) -> None:
    """Initialise ``pipeline_status['current_job']`` for a new job.

    Called at the start of ``process_file`` and ``reprocess_document`` so the
    dashboard's PipelineProgress widget knows what to render even before the
    first stage opens.

    ``providers`` is the resolved provider id per family — keys ``ocr``,
    ``llm``, ``vision`` (any may be absent or None when not applicable to the
    flow). When set, the dashboard surfaces them as model badges and
    ``stage()`` updates ``stage_provider`` to the active one as stages open.
    """
    PIPELINE_STATE.pipeline_status["current_job"] = {
        "doc_id": doc_id,
        "filename": filename,
        "kind": kind,
        "stage": None,
        "page_current": None,
        "page_total": None,
        "stages_planned": list(stages_planned),
        "stages_done": [],
        "started_at": datetime.utcnow().isoformat(timespec="seconds"),
        "providers": {k: v for k, v in (providers or {}).items() if v} or None,
        "stage_provider": None,
    }


def end_job() -> None:
    """Clear ``current_job`` once the worker finishes a unit of work."""
    PIPELINE_STATE.pipeline_status["current_job"] = None


def set_current_stage(
    stage_name: str | None,
    *,
    page_total: int | None = None,
    page_current: int | None = None,
) -> None:
    """Update the in-memory pointers to the currently executing stage.

    Code paths that don't fit the ``async with stage(...)`` context manager
    (the legacy reprocessor / processor branches that bracket their own
    DB writes manually) call this to keep ``current_job["stage"]`` in
    sync with the work they're actually doing. Without it the dashboard's
    live timeline shows zero stages until the first one completes,
    because synthesizeLiveGroup() needs ``stage`` set to render the
    in-flight phase. Also mirrors the legacy ``processing_step`` /
    ``processing_pages`` fields the older topbar chip still reads.
    """
    status = PIPELINE_STATE.pipeline_status
    status["processing_step"] = stage_name
    if page_total is not None:
        status["processing_pages"] = page_total
        status["processing_page_current"] = page_current or 0
    job = status.get("current_job")
    if isinstance(job, dict):
        job["stage"] = stage_name
        if page_total is not None:
            job["page_total"] = page_total
            job["page_current"] = page_current or 0
        elif stage_name is None:
            job["page_total"] = None
            job["page_current"] = None
        job["stage_provider"] = (
            _provider_for_stage(stage_name, job.get("providers")) if stage_name else None
        )
