"""Per-credential concurrency gate for all LLM/Vision/OCR calls.

Every LLM / Vision / OCR call is wrapped in :func:`credential_slot`, which
acquires a semaphore keyed by ``credential_id`` — i.e. per *connection*,
not per model. That matches how the backing resource actually behaves:
one Ollama server has a fixed parallelism limit regardless of which
model happens to be loaded.

Counters and labels are keyed one level finer, on
``(credential_id, kind)``. Three simultaneous calls on the same Ollama
credential — say an LLM extraction, an LLM-vision OCR page, and a
Vision-LLM extraction — produce three separate rows in the snapshot
(and therefore three separate chips in the UI), even though they all
contend for the same semaphore's slots.

Why ``threading.Semaphore`` and not ``asyncio.Semaphore``: Asclepius runs
the FastAPI request handlers on the main event loop and the pipeline
watcher on its own loop in a worker thread. ``asyncio.Semaphore`` is
bound to a single loop, so a process-global asyncio semaphore would
crash when the worker loop tried to wait on it. We previously sidestepped
that by keying the semaphore per ``(loop_id, credential_id)`` — but that
meant the cap was enforced PER LOOP, not globally, so a reprocess on the
FastAPI loop and an upload on the worker loop could both hold cap=1 on
the same Ollama and stomp on each other. ``threading.Semaphore`` is
inherently thread-safe and loop-agnostic; we acquire it via the default
executor when the slot is contended, which gives us cancellation
semantics close to asyncio.Semaphore's.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import logging
import threading
from collections import Counter
from typing import Optional

logger = logging.getLogger(__name__)


# Concurrency cap: ONE semaphore per credential_id, shared across every
# event loop and worker thread in the process. ``threading.Semaphore``
# (not ``asyncio.Semaphore``) so the cap actually applies regardless of
# which loop is making the call.
_SEMS: dict[str, threading.Semaphore] = {}
_CAPS: dict[str, int] = {}
_SEMS_LOCK = threading.Lock()  # guards mutation of _SEMS / _CAPS


async def _acquire_semaphore(sem: threading.Semaphore) -> bool:
    """Acquire a threading.Semaphore from an async context.

    Fast path: try non-blocking. If a slot is free, we don't pay any
    executor / loop overhead — matches the no-contention performance of
    asyncio.Semaphore.

    Slow path: block in the default executor so the loop stays
    responsive. On task cancellation we wait for the executor to finish
    so we can release the slot we may have just been awarded — without
    that, a CancelledError mid-acquire leaks one cap slot.
    """
    if sem.acquire(blocking=False):
        return True

    loop = asyncio.get_running_loop()
    fut = loop.run_in_executor(None, sem.acquire)
    try:
        return await fut
    except asyncio.CancelledError:
        # The executor call can't be cancelled (the underlying threading
        # acquire has no timeout). Wait for it to settle so we can give
        # back any slot we accidentally won.
        try:
            awarded = await asyncio.shield(fut)
        except BaseException:
            awarded = False
        if awarded:
            sem.release()
        raise


# Counters + labels keyed per (credential_id, kind) so LLM / Vision / OCR
# can run on the same credential without stepping on each other's chip.
_STATS: dict[tuple[str, str], dict] = {}
_LABELS: dict[tuple[str, str], dict] = {}
_ACTIVE_MODELS: dict[tuple[str, str], Counter] = {}

# Reentrancy tracking. When a coroutine already holds a slot on a given
# ``(credential_id, kind)`` pair, a nested acquire on the same pair is a
# no-op — without this, provider wrappers that gate both the outer method
# (``extract``) and an inner helper it calls (``_generate``) would deadlock
# on a cap-1 credential. The set lives in a ContextVar so each asyncio
# task gets its own independent view.
_HELD_SLOTS: contextvars.ContextVar[frozenset[tuple[str, str]]] = contextvars.ContextVar(
    "_HELD_SLOTS", default=frozenset()
)


def _ensure_sem(credential_id: str, cap: int) -> threading.Semaphore:
    """Create the credential's semaphore (once) or top up its slots if the
    cap has grown since last call. Returns the live semaphore.

    Cap growth at runtime is rare — it only happens when a previously
    unseen credential is registered with a higher cap. Rather than
    swapping the semaphore (which would orphan in-flight holders), we
    just ``release()`` the difference, adding new slots to the existing
    instance.
    """
    cred = credential_id or ""
    cap = max(cap, 1)
    with _SEMS_LOCK:
        sem = _SEMS.get(cred)
        stored_cap = _CAPS.get(cred, 0)
        if sem is None:
            _SEMS[cred] = threading.Semaphore(cap)
            _CAPS[cred] = cap
            return _SEMS[cred]
        if cap > stored_cap:
            for _ in range(cap - stored_cap):
                sem.release()
            _CAPS[cred] = cap
        return sem


def _ensure_counters(credential_id: str, kind: str, *, credential_name: str = "") -> None:
    """Create the per-(credential, kind) stats + label entries if missing,
    and refresh the stored label so renames propagate."""
    sub = (credential_id or "", kind or "")
    _STATS.setdefault(sub, {"in_flight": 0, "waiting": 0})
    _ACTIVE_MODELS.setdefault(sub, Counter())
    _LABELS[sub] = {
        "kind": kind,
        "credential_id": credential_id or "",
        "credential_name": credential_name or "",
    }


def register_credential(
    credential_id: str, cap: int, *, kind: str = "llm", credential_name: str = ""
) -> None:
    """Register a (credential, kind) pair with the gate so its cap is
    visible even when no call is currently in flight. Safe to call
    repeatedly — acts as an upsert."""
    cap = max(1, cap)
    first_sem = (credential_id or "") not in _SEMS
    first_counters = (credential_id or "", kind or "") not in _STATS
    _ensure_sem(credential_id, cap)
    _ensure_counters(credential_id, kind, credential_name=credential_name)
    if first_sem or first_counters:
        logger.info(
            "gate.register: credential=%s name=%s kind=%s cap=%d",
            credential_id,
            credential_name,
            kind,
            cap,
        )


@contextlib.asynccontextmanager
async def credential_slot(
    credential_id: str,
    cap: int = 2,
    *,
    model: str = "",
    kind: str = "llm",
    credential_name: str = "",
):
    """Acquire a slot on ``credential_id`` (all kinds share the cap).

    Counters are tracked per ``(credential_id, kind)`` so a caller
    setting ``kind="ocr"`` is reported separately from ``kind="llm"``
    even when they share the same credential and therefore the same
    semaphore.
    """
    cap = max(1, cap)
    _ensure_sem(credential_id, cap)
    _ensure_counters(credential_id, kind, credential_name=credential_name)

    cred_key = credential_id or ""
    sub_key = (cred_key, kind or "")

    # Reentrancy guard: if the current asyncio task already holds this
    # exact (credential, kind) slot, pass through without touching the
    # semaphore or stats. Otherwise provider wrappers that gate both an
    # outer method (``extract``) and a helper it calls (``_generate``)
    # would deadlock on a cap-1 credential when the inner call blocks on
    # the semaphore its outer call already holds.
    held = _HELD_SLOTS.get()
    if sub_key in held:
        yield
        return

    sem = _ensure_sem(cred_key, cap)
    stats = _STATS[sub_key]
    active = _ACTIVE_MODELS[sub_key]
    stats["waiting"] = stats.get("waiting", 0) + 1
    acquired = False
    token = None
    try:
        await _acquire_semaphore(sem)
        acquired = True
        token = _HELD_SLOTS.set(held | {sub_key})
        try:
            stats["waiting"] = max(0, stats["waiting"] - 1)
            stats["in_flight"] = stats.get("in_flight", 0) + 1
            if model:
                active[model] += 1
            logger.info(
                "gate.enter: credential=%s kind=%s model=%s in_flight=%d waiting=%d",
                credential_id,
                kind,
                model,
                stats["in_flight"],
                stats["waiting"],
            )
            yield
        finally:
            stats["in_flight"] = max(0, stats["in_flight"] - 1)
            if model and active.get(model, 0) > 0:
                active[model] -= 1
                if active[model] <= 0:
                    active.pop(model, None)
            sem.release()
            if token is not None:
                _HELD_SLOTS.reset(token)
            logger.info(
                "gate.exit: credential=%s kind=%s model=%s in_flight=%d waiting=%d",
                credential_id,
                kind,
                model,
                stats["in_flight"],
                stats["waiting"],
            )
    except BaseException:
        if not acquired:
            stats["waiting"] = max(0, stats["waiting"] - 1)
        raise


def snapshot(*, include_idle: bool = False) -> list[dict]:
    """Return one row per active (credential, kind). When
    ``include_idle`` is False (default), only rows with in-flight or
    waiting requests are reported.

    Every row's ``cap`` is the credential's shared semaphore size — so
    if three kinds run on the same credential with cap=2, every row
    shows ``cap=2`` and the UI can reason about them independently while
    still telling the user the physical limit they share.
    """
    out = []
    for sub_key, stats in _STATS.items():
        in_flight = stats.get("in_flight", 0)
        waiting = stats.get("waiting", 0)
        if not include_idle and in_flight == 0 and waiting == 0:
            continue
        cred_id, _kind = sub_key
        label = _LABELS.get(sub_key, {})
        active = _ACTIVE_MODELS.get(sub_key, Counter())
        models = sorted(active.keys())
        out.append(
            {
                "kind": label.get("kind", "llm"),
                "credential_id": label.get("credential_id", cred_id),
                "credential_name": label.get("credential_name", ""),
                "models": models,
                "model": models[0] if models else "",
                "in_flight": in_flight,
                "waiting": waiting,
                "cap": _CAPS.get(cred_id, 0),
            }
        )
    return out


def get_cap(credential_id: str) -> Optional[int]:
    """Return the effective cap for a credential, or None if not
    registered."""
    return _CAPS.get(credential_id or "")
