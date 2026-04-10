"""File system watcher for inbox directory."""

import asyncio
import logging
from pathlib import Path

from watchdog.events import FileSystemEventHandler, FileCreatedEvent
from watchdog.observers import Observer

from asclepius.config import AppConfig

logger = logging.getLogger(__name__)

# Extensions the pipeline handles
SUPPORTED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif",
    ".dcm", ".dicom", ".iso",
}

# Global queue for processing
file_queue: asyncio.Queue[str] = asyncio.Queue()


class InboxHandler(FileSystemEventHandler):
    """Handles new files appearing in the inbox directory."""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

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
        # Schedule with a delay to let file finish writing
        self.loop.call_later(2.0, self._enqueue, str(path))

    def _enqueue(self, file_path: str) -> None:
        asyncio.run_coroutine_threadsafe(
            file_queue.put(file_path), self.loop
        )


async def start_watcher(config: AppConfig) -> None:
    """Start the file watcher and processing loop."""
    from asclepius.pipeline.processor import process_file

    inbox_path = config.vault.inbox_path
    Path(inbox_path).mkdir(parents=True, exist_ok=True)

    loop = asyncio.get_event_loop()
    handler = InboxHandler(loop)
    observer = Observer()
    observer.schedule(handler, inbox_path, recursive=True)
    observer.start()

    logger.info("File watcher started on %s", inbox_path)

    # Also scan for existing files in inbox
    for f in Path(inbox_path).iterdir():
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS and not f.name.startswith("."):
            await file_queue.put(str(f))

    try:
        while True:
            file_path = await file_queue.get()
            try:
                await process_file(file_path, config)
            except Exception:
                logger.exception("Error processing file: %s", file_path)
            file_queue.task_done()
    except asyncio.CancelledError:
        observer.stop()
        observer.join()
        logger.info("File watcher stopped")
