"""Tiny in-memory rate limiter for the login endpoint.

We deliberately avoid pulling in a Redis dependency — a self-hosted
single-process deployment can rely on a per-process dict. If you scale the
app horizontally, swap this for ``slowapi`` + Redis.

The limiter is keyed by ``(client_ip, username)`` so an attacker cannot lock
out a legitimate user from a different IP, and so credential-stuffing across
many usernames from one IP still hits the limit.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

_attempts: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_lock = Lock()


def check_and_record(
    ip: str,
    username: str,
    *,
    max_attempts: int,
    window_seconds: int,
    record: bool = True,
) -> bool:
    """Return True if the attempt is allowed; optionally record it.

    Callers typically call with ``record=True`` on *failed* login only, so
    that successful logins do not eat into the budget.
    """
    now = time.monotonic()
    key = (ip or "unknown", username.lower().strip())
    cutoff = now - window_seconds
    with _lock:
        bucket = _attempts[key]
        # Drop expired entries.
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= max_attempts:
            return False
        if record:
            bucket.append(now)
        return True


def clear(ip: str, username: str) -> None:
    """Forget failed attempts for a key — call on successful login."""
    key = (ip or "unknown", username.lower().strip())
    with _lock:
        _attempts.pop(key, None)
