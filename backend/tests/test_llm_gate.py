"""Tests for the per-credential LLM/OCR/Vision concurrency gate.

Asclepius runs the FastAPI request handlers on the main event loop, and
the pipeline watcher on its own loop in a worker thread (see
``pipeline/watcher.py``). Both call into :mod:`asclepius.llm.gate` on the
same credential. Python 3.13 enforces that ``asyncio.Semaphore`` be used
only from the loop it was created on, so the gate must key its
semaphores by loop.
"""

from __future__ import annotations

import asyncio
import threading

import pytest

from asclepius.llm import gate


@pytest.mark.asyncio
async def test_slot_enter_exit_same_loop() -> None:
    """Baseline: entering then exiting a slot on one loop works and
    updates the per-(credential, kind) stats."""
    cred = "cred-same-loop"
    gate.register_credential(cred, cap=1, kind="llm", credential_name="Test")
    async with gate.credential_slot(cred, cap=1, kind="llm"):
        snap = {(r["credential_id"], r["kind"]): r for r in gate.snapshot()}
        assert snap[(cred, "llm")]["in_flight"] == 1
    # After exit, no active rows (include_idle=False is the default).
    assert (cred, "llm") not in {
        (r["credential_id"], r["kind"]) for r in gate.snapshot()
    }


def _run_in_fresh_loop(coro_factory) -> None:
    """Run ``coro_factory()`` on a brand-new event loop in the current
    thread. Each call gets its own loop — mimics how the pipeline worker
    thread runs inside ``asyncio.new_event_loop()``."""
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(coro_factory())
    finally:
        loop.close()


def test_slot_acquire_across_two_loops_same_credential() -> None:
    """A credential first used from loop A must still be usable from loop
    B without raising ``RuntimeError: <Semaphore> is bound to a different
    event loop``. Before the fix, loop B's slow-path acquire would crash
    whenever loop A had ever created the semaphore.
    """
    cred = "cred-cross-loop"

    async def use_on_loop() -> None:
        # Simulate real gate traffic: enter, yield, exit. Forces the
        # slow-path acquire on contention-free reuse, and the fast path
        # on the no-wait case — both must work on the new loop.
        for _ in range(2):
            async with gate.credential_slot(cred, cap=1, kind="llm"):
                await asyncio.sleep(0)

    # First loop — creates the semaphore.
    _run_in_fresh_loop(use_on_loop)
    # Second loop — must NOT reuse the first loop's semaphore.
    _run_in_fresh_loop(use_on_loop)

    # And again on a worker thread for good measure — matches how the
    # pipeline watcher runs.
    err: list[BaseException] = []

    def run_in_thread() -> None:
        try:
            _run_in_fresh_loop(use_on_loop)
        except BaseException as e:  # noqa: BLE001
            err.append(e)

    t = threading.Thread(target=run_in_thread)
    t.start()
    t.join(timeout=5)
    assert not err, f"cross-thread loop use raised: {err[0]!r}"


def test_cap_grows_without_breaking_other_loops() -> None:
    """Bumping the cap on loop A must not invalidate loop B's semaphore
    (other loops just pick up the new cap the next time they call
    ``_ensure_sem``)."""
    cred = "cred-grow"

    async def acquire_once() -> None:
        async with gate.credential_slot(cred, cap=1, kind="llm"):
            await asyncio.sleep(0)

    async def acquire_with_larger_cap() -> None:
        async with gate.credential_slot(cred, cap=4, kind="llm"):
            await asyncio.sleep(0)

    _run_in_fresh_loop(acquire_once)
    _run_in_fresh_loop(acquire_with_larger_cap)
    assert gate.get_cap(cred) == 4
    _run_in_fresh_loop(acquire_once)  # still works after the grow
