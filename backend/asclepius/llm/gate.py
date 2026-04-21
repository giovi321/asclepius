"""Per-credential concurrency gate for all LLM/Vision calls.

Every LLM / Vision call is wrapped in :func:`credential_slot`, which
acquires a semaphore keyed by ``credential_id`` — i.e. per *connection*,
not per model. This matches how the backing resource actually behaves:
one Ollama server has a fixed parallelism limit regardless of which
model happens to be loaded.

The snapshot keeps the currently-running model name as a label so the UI
can still show "llama3.1 running on Home Ollama", even though the queue
itself is shared across all models on that credential.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import Counter
from typing import Optional

logger = logging.getLogger(__name__)


_SEMS: dict[str, asyncio.Semaphore] = {}
_CAPS: dict[str, int] = {}
# Active in-flight and waiting counters per credential.
_STATS: dict[str, dict] = {}
# Human-readable labels per credential.
_LABELS: dict[str, dict] = {}
# Currently in-flight models per credential — a Counter so two simultaneous
# calls to the same model are reflected correctly.
_ACTIVE_MODELS: dict[str, Counter] = {}


def _ensure_slot(credential_id: str, cap: int, *,
                 kind: str = "llm", credential_name: str = "") -> None:
    """Make sure a semaphore exists for this credential with at least
    ``cap`` slots. Grows upwards; never shrinks at runtime (the worst case
    of a slight over-allocation until restart is preferable to the race
    conditions shrinking would introduce mid-flight).
    """
    key = credential_id or ""
    current_cap = _CAPS.get(key, 0)
    if cap > current_cap:
        _SEMS[key] = asyncio.Semaphore(cap)
        _CAPS[key] = cap
    elif key not in _SEMS:
        _SEMS[key] = asyncio.Semaphore(cap)
        _CAPS[key] = cap
    _STATS.setdefault(key, {"in_flight": 0, "waiting": 0})
    _ACTIVE_MODELS.setdefault(key, Counter())
    _LABELS[key] = {
        "kind": kind,
        "credential_id": credential_id or "",
        "credential_name": credential_name or "",
    }


def register_credential(credential_id: str, cap: int, *,
                        kind: str = "llm", credential_name: str = "") -> None:
    """Register a credential with the gate so its cap is visible even when
    no call is currently in flight. Safe to call repeatedly — acts as an
    upsert."""
    _ensure_slot(credential_id, max(1, cap),
                 kind=kind, credential_name=credential_name)


@contextlib.asynccontextmanager
async def credential_slot(credential_id: str, cap: int = 2, *,
                          model: str = "",
                          kind: str = "llm",
                          credential_name: str = ""):
    """Acquire a slot on ``credential_id``. ``cap`` is only honoured on
    first sight or to grow the cap — use :func:`register_credential` when
    configuration changes so the number is picked up promptly.

    On any exit (return, exception, cancellation) the in_flight counter,
    active-model counter, and semaphore are all released. All the
    per-acquire bookkeeping lives inside a single try/finally so there is
    no window where a counter can be leaked.
    """
    _ensure_slot(credential_id, max(1, cap),
                 kind=kind, credential_name=credential_name)
    key = credential_id or ""
    sem = _SEMS[key]
    stats = _STATS[key]
    active = _ACTIVE_MODELS[key]
    stats["waiting"] = stats.get("waiting", 0) + 1
    acquired = False
    try:
        await sem.acquire()
        acquired = True
        # Everything that mutates stats/active lives inside the try below
        # so a single finally block owns cleanup — no leak window between
        # the increment and the yield.
        try:
            stats["waiting"] = max(0, stats["waiting"] - 1)
            stats["in_flight"] = stats.get("in_flight", 0) + 1
            if model:
                active[model] += 1
            yield
        finally:
            stats["in_flight"] = max(0, stats["in_flight"] - 1)
            if model and active.get(model, 0) > 0:
                active[model] -= 1
                if active[model] <= 0:
                    active.pop(model, None)
            sem.release()
    except BaseException:
        # Only fired when we never entered the inner try (cancellation
        # during sem.acquire()). No slot held; just undo the waiting bump.
        if not acquired:
            stats["waiting"] = max(0, stats["waiting"] - 1)
        raise


def snapshot(*, include_idle: bool = False) -> list[dict]:
    """Return one row per active credential. When ``include_idle`` is False
    (default), only credentials with in-flight or waiting requests show up.

    Each row includes the list of models currently in flight so the UI can
    render ``Home Ollama · llama3.1 + qwen2.5 · 2/4``.
    """
    out = []
    for key, stats in _STATS.items():
        in_flight = stats.get("in_flight", 0)
        waiting = stats.get("waiting", 0)
        if not include_idle and in_flight == 0 and waiting == 0:
            continue
        label = _LABELS.get(key, {})
        active = _ACTIVE_MODELS.get(key, Counter())
        models = sorted(active.keys())
        out.append({
            "kind": label.get("kind", "llm"),
            "credential_id": label.get("credential_id", key),
            "credential_name": label.get("credential_name", ""),
            "models": models,
            "model": models[0] if models else "",
            "in_flight": in_flight,
            "waiting": waiting,
            "cap": _CAPS.get(key, 0),
        })
    return out


def get_cap(credential_id: str) -> Optional[int]:
    """Return the effective cap for a credential, or None if not
    registered."""
    return _CAPS.get(credential_id or "")
