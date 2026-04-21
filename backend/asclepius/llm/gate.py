"""Per-(credential, model) concurrency gate for all LLM/Vision calls.

Every LLM / Vision call is wrapped in :func:`model_slot`, which acquires a
semaphore keyed by ``(credential_id, model)``. The snapshot is exposed via
``/api/pipeline/status`` so the UI can show which models are busy and how
many requests are queued behind them.

The key is the *physical* model (credential + model name), not the provider
entry id — two entries that reference the same Ollama server + same model
share one queue, because they share the same backing resource.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Optional

logger = logging.getLogger(__name__)


_LOCK = asyncio.Lock()
_SEMS: dict[tuple[str, str], asyncio.Semaphore] = {}
_CAPS: dict[tuple[str, str], int] = {}
_STATS: dict[tuple[str, str], dict] = {}
# Human-readable label for each key, populated lazily from the config.
_LABELS: dict[tuple[str, str], dict] = {}


def _key(credential_id: str, model: str) -> tuple[str, str]:
    return (credential_id or "", model or "")


def _ensure_slot(credential_id: str, model: str, cap: int, *,
                 kind: str = "llm", credential_name: str = "") -> None:
    """Make sure a semaphore exists for this key with at least ``cap`` slots.

    If we're resizing upwards, swap in a new semaphore with the larger cap
    (the old one keeps running; pending waiters migrate naturally). We never
    shrink at runtime — shrinking a semaphore safely mid-flight is messy and
    the worst case (slightly higher concurrency than configured until the app
    restarts) is harmless.
    """
    key = _key(credential_id, model)
    current_cap = _CAPS.get(key, 0)
    if cap > current_cap:
        _SEMS[key] = asyncio.Semaphore(cap)
        _CAPS[key] = cap
    elif key not in _SEMS:
        _SEMS[key] = asyncio.Semaphore(cap)
        _CAPS[key] = cap
    _STATS.setdefault(key, {"in_flight": 0, "waiting": 0})
    # Update label on every register call so renames propagate.
    _LABELS[key] = {
        "kind": kind,
        "credential_id": credential_id or "",
        "credential_name": credential_name or "",
        "model": model or "",
    }


def register_model(credential_id: str, model: str, cap: int, *,
                   kind: str = "llm", credential_name: str = "") -> None:
    """Public entry point used when a provider is built.

    Callers don't need to await this (it's synchronous) — the lock is only
    used when we rebuild a semaphore, which happens inside ``_ensure_slot``
    via a non-blocking path. We rely on the GIL to keep dict writes atomic.
    """
    _ensure_slot(credential_id, model, max(1, cap),
                 kind=kind, credential_name=credential_name)


@contextlib.asynccontextmanager
async def model_slot(credential_id: str, model: str, cap: int = 2, *,
                     kind: str = "llm", credential_name: str = ""):
    """Acquire a slot for ``(credential_id, model)``. Caller is free to pass
    ``cap`` even if the slot already exists — it's only used on first sight
    or to grow the cap."""
    _ensure_slot(credential_id, model, max(1, cap),
                 kind=kind, credential_name=credential_name)
    key = _key(credential_id, model)
    sem = _SEMS[key]
    stats = _STATS[key]
    stats["waiting"] = stats.get("waiting", 0) + 1
    acquired = False
    try:
        await sem.acquire()
        acquired = True
        stats["waiting"] = max(0, stats["waiting"] - 1)
        stats["in_flight"] = stats.get("in_flight", 0) + 1
        try:
            yield
        finally:
            stats["in_flight"] = max(0, stats["in_flight"] - 1)
            sem.release()
    except BaseException:
        if not acquired:
            stats["waiting"] = max(0, stats["waiting"] - 1)
        raise


def snapshot(*, include_idle: bool = False) -> list[dict]:
    """Return the current per-model queue stats.

    By default only keys with in-flight or waiting requests are reported, so
    the UI doesn't get a row for every registered model when everything is
    idle. Pass ``include_idle=True`` to get them all.
    """
    out = []
    for key, stats in _STATS.items():
        in_flight = stats.get("in_flight", 0)
        waiting = stats.get("waiting", 0)
        if not include_idle and in_flight == 0 and waiting == 0:
            continue
        label = _LABELS.get(key, {})
        out.append({
            "kind": label.get("kind", "llm"),
            "credential_id": label.get("credential_id", key[0]),
            "credential_name": label.get("credential_name", ""),
            "model": label.get("model", key[1]),
            "in_flight": in_flight,
            "waiting": waiting,
            "cap": _CAPS.get(key, 0),
        })
    return out


def get_cap(credential_id: str, model: str) -> Optional[int]:
    """Return the effective cap for a key, or None if not registered."""
    return _CAPS.get(_key(credential_id, model))
