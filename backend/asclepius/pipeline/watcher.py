"""File system watcher for inbox directory."""

import asyncio
import itertools
import logging
import os
import threading
from pathlib import Path
from queue import PriorityQueue, Empty
from typing import Any

from watchdog.events import (
    FileCreatedEvent,
    FileMovedEvent,
    FileSystemEventHandler,
)
from watchdog.observers import Observer

from asclepius.config import AppConfig

logger = logging.getLogger(__name__)


# Monotonic tiebreaker for queue tuples — without it, two jobs that share a
# priority would compare on the payload dict, which raises TypeError. The
# counter is process-global, which is fine because one worker reads it.
_JOB_SEQ = itertools.count()


def enqueue_job(
    queue: PriorityQueue,
    kind: str,
    payload: dict[str, Any],
    priority: int,
    *,
    queued_label: str | None = None,
    queued_doc_id: int | None = None,
    queued_providers: dict[str, str | None] | None = None,
) -> None:
    """Enqueue a unit of work for the pipeline worker.

    ``kind`` is ``"upload"`` (file_path payload), ``"reprocess"`` (doc_id +
    mode + provider overrides), or ``"translate"`` (doc_id + optional
    llm_provider_id). All flow through the SAME single-threaded
    worker, which is what enforces the "max 1 doc at a time" invariant — the
    earlier ``asyncio.create_task(reprocess_document(...))`` from the API
    handler ran in the FastAPI loop and bypassed the queue entirely, which is
    why a reprocess could double up with a fresh upload on the same Ollama
    server.

    ``priority`` is min-heap: 0 jumps the line, file-size for uploads keeps the
    "smaller files first" behaviour. Reprocess clicks default to 0.

    ``queued_providers`` previews which OCR / LLM / Vision provider IDs the
    job will use (keys: ``ocr``, ``llm``, ``vision``) so the dashboard can
    render model badges before the worker picks the job up. Uploads leave
    this unset because providers are resolved per-page after extraction.
    """
    # Clear any stale cooperative-cancel marker for this doc before
    # enqueueing. Without this, a previously-cancelled doc would have its
    # NEW reprocess / translate / ai_edit / region-translate job silently
    # skipped by the worker (cancel marker outlives the job that earned
    # it), leaving documents.status stuck on "pending" with no progress.
    # Clicking Reprocess is an explicit "do this again" — the prior cancel
    # no longer applies.
    if queued_doc_id is not None:
        from asclepius.pipeline.processor import cancelled_docs

        cancelled_docs.discard(queued_doc_id)

    seq = next(_JOB_SEQ)
    queue.put((priority, seq, kind, payload))

    # Mirror into pipeline_status so the topbar / dashboard reflect the queued
    # work without having to introspect the queue itself.
    from asclepius.pipeline.processor import pipeline_status

    pipeline_status["queue_depth"] = pipeline_status.get("queue_depth", 0) + 1
    queued_files = pipeline_status.setdefault("queued_files", [])
    label = queued_label or payload.get("file_path", "") or f"doc#{queued_doc_id}"
    queued_files.append(
        {
            "filename": Path(label).name if label else "(unknown)",
            "size": payload.get("file_size", 0),
        }
    )
    if len(queued_files) > 50:
        del queued_files[: len(queued_files) - 50]

    providers = {k: v for k, v in queued_providers.items() if v} if queued_providers else None
    queued_jobs = pipeline_status.setdefault("queued_jobs", [])
    queued_jobs.append(
        {
            "kind": kind,
            "label": Path(label).name if label else "(unknown)",
            "doc_id": queued_doc_id,
            "providers": providers or None,
        }
    )
    if len(queued_jobs) > 50:
        del queued_jobs[: len(queued_jobs) - 50]


# Extensions the pipeline handles. ``.bin`` is reserved for opaque files
# extracted from a zip upload (DICOMDIR, LOCKFILE, VERSION etc.) — they are
# stored alongside the imaging study but not OCR/LLM-processed.
SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".tiff",
    ".tif",
    ".dcm",
    ".dicom",
    ".iso",
    ".bin",
}


class InboxHandler(FileSystemEventHandler):
    """Handles new files appearing in the inbox directory."""

    def __init__(self, queue: PriorityQueue, inbox_root: Path | None = None):
        self.queue = queue
        self.inbox_root = inbox_root

    def _display_path(self, path: Path) -> str:
        """Path string used in log lines: the path relative to the inbox
        root when possible, full path otherwise. The basename alone hides
        which subfolder the event came from, which matters when the same
        zip is uploaded twice and produces ``…-1/`` siblings with
        identical leaf filenames."""
        if self.inbox_root is not None:
            try:
                return str(path.relative_to(self.inbox_root))
            except ValueError:
                pass
        return str(path)

    def _enqueue(self, src_path: str) -> None:
        path = Path(src_path)

        # Skip hidden files and temp files
        if path.name.startswith(".") or path.name.startswith("~"):
            return

        # Check extension
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            logger.debug("Skipping unsupported file: %s", self._display_path(path))
            return

        logger.info("New file detected: %s", self._display_path(path))

        # Wait for the file to finish being written. The previous code slept
        # a flat 2 s; for files extracted from a zip the writer has already
        # closed by the time the create event fires, so a size-stability
        # poll usually exits in ~200 ms. Cap the total wait at 2 s so a
        # genuinely slow uploader still works.
        import time

        deadline = time.monotonic() + 2.0
        prev_size = -1
        while time.monotonic() < deadline:
            if not path.exists():
                logger.warning("File disappeared before processing: %s", path.name)
                return
            try:
                cur_size = path.stat().st_size
            except OSError:
                time.sleep(0.05)
                continue
            if cur_size > 0 and cur_size == prev_size:
                break
            prev_size = cur_size
            time.sleep(0.1)

        # Final existence check after the wait loop.
        if not path.exists():
            logger.warning("File disappeared before processing: %s", path.name)
            return

        # Use file size as priority — smaller files processed first.
        try:
            file_size = os.path.getsize(src_path)
        except OSError:
            file_size = 0

        enqueue_job(
            self.queue,
            "upload",
            {"file_path": str(path), "file_size": file_size},
            priority=file_size,
            queued_label=str(path),
        )

    def on_created(self, event: FileCreatedEvent) -> None:
        if event.is_directory:
            return
        self._enqueue(event.src_path)

    def on_moved(self, event: FileMovedEvent) -> None:
        # A rename inside the watched tree (or a move into it) shows up as
        # ``moved`` rather than ``created``. We enqueue based on the
        # destination so renamed files (e.g. an extracted DICOM frame
        # being given its ``.dcm`` extension) still reach the pipeline.
        if event.is_directory:
            return
        self._enqueue(event.dest_path)


AUTO_STOP_THRESHOLD = 5  # consecutive provider failures before auto-stopping


def _spawn_worker(config: AppConfig, queue: PriorityQueue, app_state) -> threading.Thread:
    """Start the pipeline worker daemon thread and stash a reference on
    app_state so the watchdog in ``start_watcher`` can detect when it
    dies and respawn it."""
    worker = threading.Thread(
        target=_pipeline_worker,
        args=(config, queue, app_state),
        daemon=True,
        name="pipeline-worker",
    )
    worker.start()
    if app_state is not None:
        app_state.pipeline_worker = worker
    logger.info("Pipeline worker thread started")
    return worker


def _pipeline_worker(config: AppConfig, queue: PriorityQueue, app_state=None) -> None:
    """Worker thread that processes files. Runs in its own thread with its own event loop."""
    import asyncio

    async def _run():
        from asclepius.pipeline.processor import (
            process_file,
            ProviderUnreachableError,
            reprocess_document,
        )
        from asclepius.pipeline.translator import translate_document
        from asclepius.pipeline.region_translator import translate_region
        from asclepius.pipeline.inbox_sweep import sweep_inbox
        import aiosqlite as _aiosqlite

        consecutive_provider_failures = 0
        idle_ticks_since_sweep = 0

        while True:
            try:
                _priority, _seq, kind, payload = queue.get(timeout=2)
            except Empty:
                # Run the inbox sweep after a stretch of idle ticks (~30s)
                # so duplicate / orphan files left behind by a crashed
                # process get cleaned up without a restart. The sweep
                # is a fast no-op when the inbox is empty.
                idle_ticks_since_sweep += 1
                if idle_ticks_since_sweep >= 15:
                    idle_ticks_since_sweep = 0
                    try:
                        async with _aiosqlite.connect(config.database.path) as _db:
                            _db.row_factory = _aiosqlite.Row
                            await sweep_inbox(
                                inbox_root=Path(config.vault.inbox_path),
                                vault_root=Path(config.vault.root_path),
                                db=_db,
                            )
                    except BaseException:
                        # CancelledError inherits from BaseException in
                        # Python 3.8+, and we've seen aiosqlite.connect
                        # raise it intermittently from inside this thread's
                        # private loop. ``except Exception`` would let it
                        # escape, killing the worker thread and silently
                        # stalling every subsequent reprocess / translate.
                        logger.warning("Inbox idle sweep failed (non-fatal)", exc_info=True)
                continue
            # Picked up a file → reset idle counter so we don't sweep
            # mid-batch.
            idle_ticks_since_sweep = 0

            file_path = payload.get("file_path") if kind == "upload" else None
            label = file_path or f"doc#{payload.get('doc_id')}"
            doc_kind = kind in ("reprocess", "translate", "translate_region", "ai_edit")

            # Pop the matching entry off pipeline_status.queued_jobs so the
            # frontend's queued list reflects the worker actually picking
            # this one up.
            from asclepius.pipeline.processor import pipeline_status

            queued_jobs = pipeline_status.get("queued_jobs") or []
            for i, entry in enumerate(queued_jobs):
                if (
                    entry.get("kind") == kind
                    and entry.get("doc_id") == payload.get("doc_id")
                    and (doc_kind or entry.get("label") == Path(file_path or "").name)
                ):
                    del queued_jobs[i]
                    break

            # Honour cancels that arrived while the job was still queued.
            # The /documents/{id}/cancel endpoint sets cancelled_docs and
            # the document's status to "cancelled" immediately; without
            # this guard the worker would still pop and start the job
            # before the cooperative-cancel checkpoints fire.
            from asclepius.pipeline.processor import cancelled_docs as _cancelled_docs

            queued_doc_id = payload.get("doc_id")
            if doc_kind and queued_doc_id is not None and queued_doc_id in _cancelled_docs:
                logger.info(
                    "Pipeline worker skipping cancelled queued %s: doc=%d",
                    kind,
                    queued_doc_id,
                )
                _cancelled_docs.discard(queued_doc_id)
                # Decrement queue_depth so the dashboard counter reconciles.
                from asclepius.pipeline.processor import pipeline_status as _ps

                _ps["queue_depth"] = max(0, _ps.get("queue_depth", 0) - 1)
                # Belt-and-braces: ensure the document isn't left wedged in
                # "pending" / "processing". The /cancel endpoint normally
                # sets status="cancelled" before the worker pops, but if the
                # caller forgot (or the marker was stale from a prior cycle)
                # the UI would otherwise keep rendering a Queued chip with
                # no worker behind it. Best-effort — failures here only
                # affect cosmetics.
                try:
                    import aiosqlite as _aiosqlite

                    async with _aiosqlite.connect(config.database.path) as _db:
                        await _db.execute(
                            """UPDATE documents
                               SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                               WHERE id = ? AND status IN ('pending', 'processing')""",
                            (queued_doc_id,),
                        )
                        await _db.commit()
                except BaseException:
                    # See the inbox-sweep handler above for why this is
                    # ``BaseException`` and not ``Exception``.
                    logger.warning(
                        "Failed to reset doc status after cancel-skip (doc=%d)",
                        queued_doc_id,
                        exc_info=True,
                    )
                continue

            try:
                if kind == "reprocess":
                    logger.info(
                        "Pipeline worker processing reprocess: doc=%d mode=%s",
                        payload["doc_id"],
                        payload.get("mode", "both"),
                    )
                    await reprocess_document(
                        payload["doc_id"],
                        config,
                        mode=payload.get("mode", "both"),
                        llm_provider_id=payload.get("llm_provider_id"),
                        ocr_provider_id=payload.get("ocr_provider_id"),
                        vision_provider_id=payload.get("vision_provider_id"),
                        resolved_providers=payload.get("resolved_providers"),
                    )
                elif kind == "translate":
                    logger.info(
                        "Pipeline worker processing translate: doc=%d",
                        payload["doc_id"],
                    )
                    await translate_document(
                        payload["doc_id"],
                        config,
                        llm_provider_id=payload.get("llm_provider_id"),
                        resolved_providers=payload.get("resolved_providers"),
                        target_language=payload.get("target_language"),
                    )
                elif kind == "translate_region":
                    logger.info(
                        "Pipeline worker processing region translate: doc=%d region=%d",
                        payload["doc_id"],
                        payload["region_row_id"],
                    )
                    await translate_region(
                        payload["doc_id"],
                        config,
                        region_row_id=payload["region_row_id"],
                        page=payload["page"],
                        bbox=payload["bbox"],
                        ocr_provider_id=payload.get("ocr_provider_id"),
                        llm_provider_id=payload.get("llm_provider_id"),
                        resolved_providers=payload.get("resolved_providers"),
                        target_language=payload.get("target_language"),
                        share_id=payload.get("share_id"),
                    )
                elif kind == "ai_edit":
                    logger.info(
                        "Pipeline worker processing ai_edit: doc=%d pages=%s",
                        payload["doc_id"],
                        payload.get("requested_pages"),
                    )
                    from asclepius.pipeline.ai_edit import ai_edit_document

                    await ai_edit_document(
                        payload["doc_id"],
                        config,
                        requested_pages=payload["requested_pages"],
                        page_count=payload["page_count"],
                        ocr_provider_id=payload.get("ocr_provider_id"),
                        llm_provider_id=payload.get("llm_provider_id"),
                        re_run_ocr=payload.get("re_run_ocr", False),
                        instruction=payload.get("instruction", ""),
                    )
                else:
                    logger.info("Pipeline worker processing: %s", Path(file_path).name)
                    await process_file(file_path, config)
                consecutive_provider_failures = 0  # success resets counter
            except ProviderUnreachableError as e:
                consecutive_provider_failures += 1
                logger.error(
                    "Provider unreachable (%d/%d): %s — %s",
                    consecutive_provider_failures,
                    AUTO_STOP_THRESHOLD,
                    label,
                    e,
                )
                if consecutive_provider_failures >= AUTO_STOP_THRESHOLD:
                    logger.warning(
                        "All providers appear unreachable after %d consecutive failures. "
                        "Auto-pausing pipeline.",
                        AUTO_STOP_THRESHOLD,
                    )
                    if app_state is not None:
                        app_state.pipeline_auto_stopped = True
                        app_state.pipeline_auto_stop_reason = (
                            f"Auto-paused after {AUTO_STOP_THRESHOLD} consecutive provider failures"
                        )
                    # Put the job back so it's retried on restart.
                    enqueue_job(queue, kind, payload, priority=payload.get("file_size", 0))
                    break  # stop worker loop
            except Exception:
                logger.exception("Pipeline error for: %s", label)
            except BaseException:
                logger.exception("Pipeline critical error for: %s", label)
            finally:
                try:
                    queue.task_done()
                except ValueError:
                    pass  # task_done called too many times
                # Always reset pipeline status
                from asclepius.pipeline.processor import pipeline_status
                from asclepius.pipeline.stage_events import end_job

                pipeline_status["processing"] = None
                pipeline_status["processing_step"] = None
                pipeline_status["processing_doc_id"] = None
                end_job()
                # For uploads, walk up the inbox tree and rmdir any empty
                # directories left behind by zip extraction.
                if file_path:
                    try:
                        inbox_root = Path(config.vault.inbox_path).resolve()
                        parent = Path(file_path).parent.resolve()
                        while inbox_root in parent.parents:
                            try:
                                parent.rmdir()
                            except OSError:
                                break
                            parent = parent.parent
                    except Exception:
                        pass

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    except Exception:
        logger.exception("Pipeline worker crashed")
    finally:
        loop.close()


async def start_translate_worker(config: AppConfig, app_state=None) -> None:
    """Spawn a pipeline worker without the inbox observer or scheduled-doc
    sweeper. Used by the share-only container so doctor translate jobs
    have a local worker to consume them.

    The full ``start_watcher`` cannot run in share mode because both
    containers would race on the same inbox directory and re-ingest each
    other's files. A translate-only worker is in-process by design — the
    doctor's translate request enqueues onto ``app_state.pipeline_queue``
    and the worker thread we spawn here drains it.
    """
    queue: PriorityQueue = PriorityQueue()
    if app_state is not None:
        app_state.pipeline_queue = queue
        app_state.pipeline_auto_stopped = False
        app_state.pipeline_auto_stop_reason = ""

    _spawn_worker(config, queue, app_state)
    logger.info("Translate worker started (share mode)")

    # Watchdog: respawn the worker if its thread dies. Same logic as the
    # full watcher's liveness check, minus the file-watcher rebind.
    try:
        while True:
            await asyncio.sleep(5)
            cur_worker = getattr(app_state, "pipeline_worker", None) if app_state else None
            if cur_worker is not None and not cur_worker.is_alive():
                logger.warning(
                    "Translate worker thread died unexpectedly — respawning",
                )
                from asclepius.pipeline.processor import pipeline_status as _ps

                _ps["queue_depth"] = 0
                _ps["queued_jobs"] = []
                _ps["queued_files"] = []
                _ps["processing"] = None
                _ps["processing_step"] = None
                _ps["processing_doc_id"] = None
                _ps["processing_pages"] = None
                _ps["processing_page_current"] = None
                _ps["current_job"] = None
                new_queue: PriorityQueue = PriorityQueue()
                if app_state is not None:
                    app_state.pipeline_queue = new_queue
                _spawn_worker(config, new_queue, app_state)
                queue = new_queue
    except asyncio.CancelledError:
        logger.info("Translate worker stopped")


async def start_watcher(config: AppConfig, app_state=None) -> None:
    """Start the file watcher and pipeline worker thread.

    The pipeline runs in a SEPARATE THREAD with its own event loop,
    so it never blocks the main web server event loop.
    """
    inbox_path = config.vault.inbox_path
    Path(inbox_path).mkdir(parents=True, exist_ok=True)

    # Thread-safe priority queue (not asyncio.Queue) — smaller files first.
    # Tuples: (priority:int, seq:int, kind:str, payload:dict). The seq breaks
    # ties without comparing payload dicts. Both upload and reprocess flow
    # through this queue — that's what enforces "max 1 doc at a time".
    queue: PriorityQueue = PriorityQueue()
    if app_state is not None:
        app_state.pipeline_queue = queue

    # Reset auto-stop state on start
    if app_state is not None:
        app_state.pipeline_auto_stopped = False
        app_state.pipeline_auto_stop_reason = ""

    # Start pipeline worker in a daemon thread. The watchdog below
    # reads back the reference via app_state.pipeline_worker.
    _spawn_worker(config, queue, app_state)

    # Start file watcher
    handler = InboxHandler(queue, inbox_root=Path(inbox_path))
    observer = Observer()
    observer.schedule(handler, inbox_path, recursive=True)
    observer.start()
    logger.info("File watcher started on %s", inbox_path)

    # First: sweep the inbox for files that are already ingested
    # somewhere under the vault. This catches duplicates a previous
    # process left behind (e.g. crash after copy, before unlink) so
    # they don't get re-queued and re-processed below.
    try:
        import aiosqlite as _aiosqlite
        from asclepius.pipeline.inbox_sweep import sweep_inbox

        async with _aiosqlite.connect(config.database.path) as _db:
            _db.row_factory = _aiosqlite.Row
            await _db.execute("PRAGMA foreign_keys=ON")
            await sweep_inbox(
                inbox_root=Path(inbox_path),
                vault_root=Path(config.vault.root_path),
                db=_db,
            )
    except Exception:
        logger.warning("Inbox sweep failed at startup (non-fatal)", exc_info=True)

    # Scan for existing files in inbox — rglob to reach per-upload
    # subfolders (inbox/{patient-slug}/, inbox/user-{id}/, …). The
    # watchdog Observer above is already recursive so new files in
    # those subfolders are picked up automatically.
    for f in Path(inbox_path).rglob("*"):
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS and not f.name.startswith("."):
            logger.info("Queuing existing inbox file: %s", f.relative_to(inbox_path))
            try:
                file_size = f.stat().st_size
            except OSError:
                file_size = 0
            enqueue_job(
                queue,
                "upload",
                {"file_path": str(f), "file_size": file_size},
                priority=file_size,
                queued_label=str(f),
            )

    # Keep the coroutine alive: every 5s we check the worker is still up
    # (so a silent death from a transient async hiccup gets recovered
    # automatically, not stranded until the next backend restart) and
    # every ~60s we sweep for scheduled documents that have come due.
    schedule_tick = 0
    try:
        while True:
            await asyncio.sleep(5)
            schedule_tick += 1

            # Worker liveness watchdog. The worker thread is daemon so a
            # crash leaves no trace beyond the traceback in stderr, and
            # subsequent enqueues silently sit in an orphaned queue. We
            # spawn a fresh worker AND a fresh queue (the old PriorityQueue
            # is unreachable to FastAPI handlers anyway, since they read
            # ``app_state.pipeline_queue``). Stale ``queued_jobs`` /
            # ``queue_depth`` are reset so the dashboard reflects the
            # actual state of the new queue (empty).
            cur_worker = getattr(app_state, "pipeline_worker", None)
            if cur_worker is not None and not cur_worker.is_alive():
                logger.warning("Pipeline worker thread died unexpectedly — respawning")
                from asclepius.pipeline.processor import pipeline_status as _ps

                _ps["queue_depth"] = 0
                _ps["queued_jobs"] = []
                _ps["queued_files"] = []
                _ps["processing"] = None
                _ps["processing_step"] = None
                _ps["processing_doc_id"] = None
                _ps["processing_pages"] = None
                _ps["processing_page_current"] = None
                _ps["current_job"] = None
                new_queue: PriorityQueue = PriorityQueue()
                if app_state is not None:
                    app_state.pipeline_queue = new_queue
                # Also point the watchdog Observer at the new queue so
                # newly-dropped inbox files reach the new worker.
                handler.queue = new_queue
                _spawn_worker(config, new_queue, app_state)
                queue = new_queue

            if schedule_tick < 12:
                continue
            schedule_tick = 0

            # Check for scheduled documents whose process_at time has passed
            try:
                import aiosqlite

                async with aiosqlite.connect(config.database.path) as db:
                    await db.execute("PRAGMA journal_mode=WAL")
                    cursor = await db.execute(
                        "SELECT id, file_path FROM documents WHERE status = 'scheduled' AND process_at <= DATETIME('now')"
                    )
                    rows = await cursor.fetchall()
                    for row in rows:
                        doc_id, file_path = row
                        logger.info("Scheduled document %d is due, re-queuing", doc_id)
                        await db.execute(
                            "UPDATE documents SET status = 'pending', process_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                            (doc_id,),
                        )
                        # Try to re-queue the file for processing
                        vault_root = Path(config.vault.root_path)
                        full_path = vault_root / file_path
                        if full_path.exists():
                            try:
                                file_size = full_path.stat().st_size
                            except OSError:
                                file_size = 0
                            enqueue_job(
                                queue,
                                "upload",
                                {"file_path": str(full_path), "file_size": file_size},
                                priority=file_size,
                                queued_label=str(full_path),
                            )
                        else:
                            # Try inbox path
                            inbox_path_for_doc = (
                                Path(config.vault.inbox_path) / Path(file_path).name
                            )
                            if inbox_path_for_doc.exists():
                                try:
                                    file_size = inbox_path_for_doc.stat().st_size
                                except OSError:
                                    file_size = 0
                                enqueue_job(
                                    queue,
                                    "upload",
                                    {"file_path": str(inbox_path_for_doc), "file_size": file_size},
                                    priority=file_size,
                                    queued_label=str(inbox_path_for_doc),
                                )
                            else:
                                logger.warning(
                                    "Scheduled document %d file not found: %s", doc_id, file_path
                                )
                    if rows:
                        await db.commit()
                        logger.info("Re-queued %d scheduled document(s)", len(rows))
            except Exception:
                logger.exception("Error checking scheduled documents")
    except asyncio.CancelledError:
        observer.stop()
        observer.join()
        logger.info("File watcher stopped")
