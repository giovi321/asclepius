"""File system watcher for inbox directory."""

import asyncio
import logging
import os
import threading
from pathlib import Path
from queue import PriorityQueue, Empty

from watchdog.events import (
    FileCreatedEvent,
    FileMovedEvent,
    FileSystemEventHandler,
)
from watchdog.observers import Observer

from asclepius.config import AppConfig

logger = logging.getLogger(__name__)

# Extensions the pipeline handles. ``.bin`` is reserved for opaque files
# extracted from a zip upload (DICOMDIR, LOCKFILE, VERSION etc.) — they are
# stored alongside the imaging study but not OCR/LLM-processed.
SUPPORTED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif",
    ".dcm", ".dicom", ".iso", ".bin",
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

        # Use file size as priority — smaller files processed first
        try:
            file_size = os.path.getsize(src_path)
        except OSError:
            file_size = 0

        # Reflect the new queue entry in pipeline_status so the topbar
        # shows a non-zero queue depth between processing ticks. Without
        # this the counter only ever decrements (in process_file) and
        # stays clamped at 0 forever.
        from asclepius.pipeline.processor import pipeline_status
        pipeline_status["queue_depth"] = pipeline_status.get("queue_depth", 0) + 1
        queued_files = pipeline_status.setdefault("queued_files", [])
        queued_files.append({"filename": path.name, "size": file_size})
        # Cap the visible list so a 1000-file zip doesn't grow the snapshot
        # without bound; the depth counter is the source of truth.
        if len(queued_files) > 50:
            del queued_files[: len(queued_files) - 50]

        self.queue.put((file_size, str(path)))

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


def _pipeline_worker(config: AppConfig, queue: PriorityQueue, app_state=None) -> None:
    """Worker thread that processes files. Runs in its own thread with its own event loop."""
    import asyncio

    async def _run():
        from asclepius.pipeline.processor import process_file, ProviderUnreachableError
        from asclepius.pipeline.inbox_sweep import sweep_inbox
        import aiosqlite as _aiosqlite

        consecutive_provider_failures = 0
        idle_ticks_since_sweep = 0

        while True:
            try:
                _priority, file_path = queue.get(timeout=2)
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
                    except Exception:
                        logger.debug("Inbox idle sweep failed (non-fatal)", exc_info=True)
                continue
            # Picked up a file → reset idle counter so we don't sweep
            # mid-batch.
            idle_ticks_since_sweep = 0

            try:
                logger.info("Pipeline worker processing: %s", Path(file_path).name)
                await process_file(file_path, config)
                consecutive_provider_failures = 0  # success resets counter
            except ProviderUnreachableError as e:
                consecutive_provider_failures += 1
                logger.error("Provider unreachable (%d/%d): %s — %s",
                             consecutive_provider_failures, AUTO_STOP_THRESHOLD,
                             Path(file_path).name, e)
                if consecutive_provider_failures >= AUTO_STOP_THRESHOLD:
                    logger.warning(
                        "All providers appear unreachable after %d consecutive failures. "
                        "Auto-pausing pipeline.", AUTO_STOP_THRESHOLD)
                    if app_state is not None:
                        app_state.pipeline_auto_stopped = True
                        app_state.pipeline_auto_stop_reason = (
                            f"Auto-paused after {AUTO_STOP_THRESHOLD} consecutive provider failures"
                        )
                    # Put the file back in the queue so it's retried on restart
                    try:
                        file_size = os.path.getsize(file_path)
                    except OSError:
                        file_size = 0
                    queue.put((file_size, file_path))
                    break  # stop worker loop
            except Exception:
                logger.exception("Pipeline error for: %s", file_path)
            except BaseException:
                logger.exception("Pipeline critical error for: %s", file_path)
            finally:
                try:
                    queue.task_done()
                except ValueError:
                    pass  # task_done called too many times
                # Always reset pipeline status
                from asclepius.pipeline.processor import pipeline_status
                pipeline_status["processing"] = None
                pipeline_status["processing_step"] = None
                pipeline_status["processing_doc_id"] = None
                # Walk up the inbox tree from the file we just handled and
                # rmdir any empty directories. Without this, every zip
                # upload leaves an empty ``inbox/{slug}/{zip_stem}/`` shell
                # behind once its frames are processed. Stop at the inbox
                # root itself.
                try:
                    inbox_root = Path(config.vault.inbox_path).resolve()
                    parent = Path(file_path).parent.resolve()
                    while inbox_root in parent.parents:
                        try:
                            parent.rmdir()
                        except OSError:
                            # Not empty (or already gone) — stop walking up.
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


async def start_watcher(config: AppConfig, app_state=None) -> None:
    """Start the file watcher and pipeline worker thread.

    The pipeline runs in a SEPARATE THREAD with its own event loop,
    so it never blocks the main web server event loop.
    """
    inbox_path = config.vault.inbox_path
    Path(inbox_path).mkdir(parents=True, exist_ok=True)

    # Thread-safe priority queue (not asyncio.Queue) — smaller files first
    queue: PriorityQueue[tuple[int, str]] = PriorityQueue()

    # Reset auto-stop state on start
    if app_state is not None:
        app_state.pipeline_auto_stopped = False
        app_state.pipeline_auto_stop_reason = ""

    # Start pipeline worker in a daemon thread
    worker = threading.Thread(
        target=_pipeline_worker,
        args=(config, queue, app_state),
        daemon=True,
        name="pipeline-worker",
    )
    worker.start()
    logger.info("Pipeline worker thread started")

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
            queue.put((file_size, str(f)))

    # Keep the coroutine alive and periodically check for scheduled documents
    try:
        while True:
            await asyncio.sleep(60)
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
                            queue.put((file_size, str(full_path)))
                        else:
                            # Try inbox path
                            inbox_path = Path(config.vault.inbox_path) / Path(file_path).name
                            if inbox_path.exists():
                                try:
                                    file_size = inbox_path.stat().st_size
                                except OSError:
                                    file_size = 0
                                queue.put((file_size, str(inbox_path)))
                            else:
                                logger.warning("Scheduled document %d file not found: %s", doc_id, file_path)
                    if rows:
                        await db.commit()
                        logger.info("Re-queued %d scheduled document(s)", len(rows))
            except Exception:
                logger.exception("Error checking scheduled documents")
    except asyncio.CancelledError:
        observer.stop()
        observer.join()
        logger.info("File watcher stopped")
