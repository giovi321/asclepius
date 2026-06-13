"""Token/OTP code generation, hashing, and time helpers.

Leaf module: depends on nothing else in the share package, so the other
share modules can import it freely without risking a circular import.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

# ── Hash helpers ─────────────────────────────────────────────────


def hash_token(raw: str) -> str:
    """SHA-256 of a token or OTP code. Stored side; raw is never persisted
    (except briefly for OTPs in ``otp_clear`` so the admin can read it back)."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate_share_token() -> str:
    """32 bytes of URL-safe randomness — what goes in the share URL."""
    return secrets.token_urlsafe(32)


def generate_otp_code() -> str:
    """6-digit numeric OTP, zero-padded.

    ``secrets.randbelow`` is the right primitive for unbiased random in a
    range. ``zfill(6)`` guarantees a stable display width.
    """
    return f"{secrets.randbelow(1_000_000):06d}"


def generate_session_id() -> str:
    return secrets.token_urlsafe(32)


def generate_queue_token() -> str:
    """Cookie token handed to a doctor waiting for a busy share's slot.

    Stored hashed (sha256) so a DB read does not yield a usable cookie.
    """
    return secrets.token_urlsafe(32)


# ── Time helpers ─────────────────────────────────────────────────


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def in_minutes(minutes: int) -> str:
    return (datetime.utcnow() + timedelta(minutes=minutes)).isoformat(timespec="seconds")


def in_days(days: int) -> str:
    return (datetime.utcnow() + timedelta(days=days)).isoformat(timespec="seconds")
