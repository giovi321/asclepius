"""In-memory rate limiters for the share surface.

Two buckets:

- ``otp_request_allowed`` — caps OTP requests per (token, ip) so a
  malicious actor with a leaked share URL cannot flood the SMS/email
  delivery (or, in v1, the admin's audit panel).
- ``translate_allowed`` — caps doctor-translate requests per session
  (debounce) and per share (rolling-hour cost cap).

Single-process only. If the deployment is ever scaled horizontally,
swap these for Redis-backed equivalents — the call signatures are kept
narrow on purpose so swapping is mechanical.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

# ── OTP request limiter ──────────────────────────────────────────

_OTP_MAX_PER_HOUR_PER_IP = 10
_OTP_MAX_PER_HOUR_PER_TOKEN = 6

_otp_buckets_ip: dict[str, deque[float]] = defaultdict(deque)
_otp_buckets_token: dict[str, deque[float]] = defaultdict(deque)
_otp_lock = Lock()


def otp_request_allowed(token_hash: str, ip: str) -> bool:
    """Return True iff this IP and this token are still under their hour
    quota. Records the attempt only if allowed — a rejected request must
    not consume budget, otherwise an attacker can keep the ceiling pinned."""
    now = time.monotonic()
    cutoff = now - 3600
    with _otp_lock:
        ip_bucket = _otp_buckets_ip[ip or "unknown"]
        while ip_bucket and ip_bucket[0] < cutoff:
            ip_bucket.popleft()
        token_bucket = _otp_buckets_token[token_hash]
        while token_bucket and token_bucket[0] < cutoff:
            token_bucket.popleft()
        if len(ip_bucket) >= _OTP_MAX_PER_HOUR_PER_IP:
            return False
        if len(token_bucket) >= _OTP_MAX_PER_HOUR_PER_TOKEN:
            return False
        ip_bucket.append(now)
        token_bucket.append(now)
        return True


# ── Translate limiter ────────────────────────────────────────────

# Per-session: the last translate timestamp. Used for the debounce.
_translate_last_per_session: dict[str, float] = {}
# Per-share rolling hour: a deque of timestamps trimmed on each call.
_translate_per_share: dict[int, deque[float]] = defaultdict(deque)
_translate_lock = Lock()


def translate_allowed(
    *,
    session_id: str,
    share_id: int,
    debounce_seconds: int,
    per_share_per_hour: int,
) -> tuple[bool, int]:
    """Return ``(allowed, retry_after_seconds)``.

    ``retry_after_seconds`` is meaningful only when ``allowed`` is False;
    callers surface it via the ``Retry-After`` header so the doctor's UI
    can show a useful "try again in Ns" hint.
    """
    now = time.monotonic()
    with _translate_lock:
        # Per-session debounce.
        last = _translate_last_per_session.get(session_id)
        if last is not None and now - last < debounce_seconds:
            return False, max(1, int(debounce_seconds - (now - last)))

        # Per-share rolling-hour cap.
        bucket = _translate_per_share[share_id]
        cutoff = now - 3600
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= per_share_per_hour:
            wait = int(3600 - (now - bucket[0])) + 1
            return False, max(1, wait)

        bucket.append(now)
        _translate_last_per_session[session_id] = now
        return True, 0


def translate_headroom(
    *,
    session_id: str,
    share_id: int,
    debounce_seconds: int,
    per_share_per_hour: int,
) -> dict:
    """Snapshot of remaining quota — for the doctor dashboard's hint."""
    now = time.monotonic()
    with _translate_lock:
        bucket = _translate_per_share.get(share_id, deque())
        cutoff = now - 3600
        used = sum(1 for t in bucket if t >= cutoff)
        last = _translate_last_per_session.get(session_id, 0.0)
        debounce_left = max(0, int(debounce_seconds - (now - last))) if last else 0
    return {
        "per_share_per_hour": per_share_per_hour,
        "used_in_last_hour": used,
        "remaining_in_last_hour": max(0, per_share_per_hour - used),
        "debounce_seconds_remaining": debounce_left,
    }
