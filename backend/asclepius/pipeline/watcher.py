"""File system watcher for inbox directory."""

import asyncio
import logging
import os
import threading
from pathlib import Path
from queue import PriorityQueue, Empty

from watchdog.events import FileSystemEventHandler, FileCreatedEvent
from watchdog.observers import Observer

from asclepius.config import AppConfig

logger = logging.getLogger(__name__)

# Extensions the pipeline handles
SUPPORTED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif",
    ".dcm", ".dicom", ".iso",
}


class InboxHandler(FileSystemEventHandler):
    """Handles new files appearing in the inbox directory."""

    def __init__(self, queue: PriorityQueue):
        self.queue = queue

    def on_created(self, event: FileCreatedEvent) -> None:
        if event.is_directory:
            return

        path = Path(event.src_path)

        # Skip hidden files and temp files
        if path.name.startswith(".") or path.name.startswith("~"):
            return

        # Check extension
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            logger.debug("Skipping unsupported file: %s", path.name)
            return

        logger.info("New file detected: %s", path.name)
        # Use file size as priority — smaller files processed first
        try:
            file_size = os.path.getsize(event.src_path)
        except OSError:
            file_size = 0
        self.queue.put((file_size, str(path)))


def _pipeline_worker(config: AppConfig, queue: PriorityQueue) -> None:
    """Worker thread that processes files. Runs in its own thread with its own event loop."""
    import asyncio

    async def _run():
        from asclepius.pipeline.processor import process_file

        while True:
            try:
                _priority, file_path = queue.get(timeout=2)
            except Empty:
                continue

            try:
                logger.info("Pipeline worker processing: %s", Path(file_path).name)
                await process_file(file_path, config)
            except Exception:
                logger.exception("Pipeline error for: %s", file_path)
            finally:
                queue.task_done()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    except Exception:
        logger.exception("Pipeline worker crashed")
    finally:
        loop.close()


async def start_watcher(config: AppConfig) -> None:
    """Start the file watcher and pipeline worker thread.

    The pipeline runs in a SEPARATE THREAD with its own event loop,
    so it never blocks the main web server event loop.
    """
    inbox_path = config.vault.inbox_path
    Path(inbox_path).mkdir(parents=True, exist_ok=True)

    # Thread-safe priority queue (not asyncio.Queue) — smaller files first
    queue: PriorityQueue[tuple[int, str]] = PriorityQueue()

    # Start pipeline worker in a daemon thread
    worker = threading.Thread(
        target=_pipeline_worker,
        args=(config, queue),
        daemon=True,
        name="pipeline-worker",
    )
    worker.start()
    logger.info("Pipeline worker thread started")

    # Start file watcher
    handler = InboxHandler(queue)
    observer = Observer()
    observer.schedule(handler, inbox_path, recursive=True)
    observer.start()
    logger.info("File watcher started on %s", inbox_path)

    # Scan for existing files in inbox
    for f in Path(inbox_path).iterdir():
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS and not f.name.startswith("."):
            logger.info("Queuing existing inbox file: %s", f.name)
            try:
                file_size = f.stat().st_size
            except OSError:
                file_size = 0
            queue.put((file_size, str(f)))

    # Keep the coroutine alive (so the task isn't garbage collected)
    try:
        while True:
            await asyncio.sleep(60)
    except asyncio.CancelledError:
        observer.stop()
        observer.join()
        logger.info("File watcher stopped")
