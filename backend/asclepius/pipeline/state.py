"""In-memory pipeline state.

Wraps the three mutable globals that used to live at module-scope in
:mod:`asclepius.pipeline.processor` (status dict, cancellation set,
in-flight-task registry) in a single dataclass so callers can pass one
object around. Module-level aliases on :mod:`processor` keep the legacy
``pipeline_status`` / ``cancelled_docs`` / ``_running_tasks`` spellings
working for the 6+ call sites that still reach in directly.

There is a single process-wide instance, :data:`PIPELINE_STATE`, because
the pipeline is a singleton worker per process — no per-request state
has any reason to diverge from it.
"""

from __future__ import annotations

from asyncio import Task
from dataclasses import dataclass, field
from typing import Any


def _initial_status() -> dict[str, Any]:
    return {
        "queue_depth": 0,
        "processing": None,
        "processing_step": None,  # 'ocr', 'llm_extraction', 'organizing'
        "processing_doc_id": None,
        "processing_pages": None,
        "processing_page_current": None,
        "last_processed": None,
        "total_processed": 0,
        "total_errors": 0,
        "recent_errors": [],
        "queued_files": [],  # list of {filename, size} in queue
        # Richer view of the in-flight unit of work. Populated by ``begin_job``
        # in stage_events.py at the start of process_file / reprocess_document
        # and cleared by ``end_job`` once the worker iteration finishes. The
        # dashboard's PipelineProgress widget renders this directly.
        "current_job": None,
        # Mirror of the queue contents for the UI. Each entry is
        # {kind: "upload"|"reprocess", label: str, doc_id: int|None}.
        "queued_jobs": [],
    }


@dataclass
class PipelineState:
    """Mutable state the pipeline worker needs across steps.

    - ``pipeline_status``: the UI-visible progress / counters dict.
    - ``cancelled_docs``: document ids the user asked to cancel; checked
      cooperatively between pipeline steps.
    - ``running_tasks``: registry of in-flight asyncio tasks by doc id,
      so an incoming cancel can hard-cancel the ``await`` a worker is
      currently suspended on.
    """

    pipeline_status: dict[str, Any] = field(default_factory=_initial_status)
    cancelled_docs: set[int] = field(default_factory=set)
    running_tasks: dict[int, Task] = field(default_factory=dict)

    def register_running_task(self, doc_id: int, task: Task) -> None:
        """Record the asyncio task handling ``doc_id`` so ``cancel_running_task``
        can interrupt it. Safe to call multiple times - the latest task wins."""
        self.running_tasks[doc_id] = task

    def unregister_running_task(self, doc_id: int, task: Task | None = None) -> None:
        """Drop the registered task for ``doc_id``. If ``task`` is given, only
        unregister when it matches (prevents a stale entry from clobbering a
        newer reprocess that ran after)."""
        current = self.running_tasks.get(doc_id)
        if current is None:
            return
        if task is not None and current is not task:
            return
        self.running_tasks.pop(doc_id, None)

    def cancel_running_task(self, doc_id: int) -> bool:
        """Cancel the registered asyncio task for ``doc_id``. Returns True
        when a task was found and cancel was issued, False otherwise. The
        task's own finalizers (gate release, DB commit, status update) run
        before the CancelledError propagates out."""
        task = self.running_tasks.get(doc_id)
        if task is None or task.done():
            return False
        task.cancel()
        return True


# Singleton. Imported by processor.py, which re-exports the individual
# attributes under their historical names for backward compatibility.
PIPELINE_STATE = PipelineState()
