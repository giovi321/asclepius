"""OTP generation, verification, and the share-level failure lockout.

``verify_otp`` is the OTP trust boundary: its attempt-counting, expiry,
and burn-on-stale-state logic is moved here verbatim. Do not make it
atomic or change the attempt logic here — that is a separate change.
"""

from __future__ import annotations

import hmac

import aiosqlite

from asclepius.share.tokens import (
    generate_otp_code,
    hash_token,
    in_minutes,
    utcnow_iso,
)

# ── OTP ──────────────────────────────────────────────────────────


class OtpCooldownError(Exception):
    """Raised by :func:`issue_otp` when an email-delivery share asks for
    a new OTP before the configured cooldown has elapsed. Carries the
    number of seconds the caller should wait before retrying so the
    public endpoint can surface a useful ``Retry-After`` value."""

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(f"OTP resend cooldown active; retry in {retry_after_seconds}s")
        self.retry_after_seconds = max(1, retry_after_seconds)


async def _last_otp_age_seconds(db: aiosqlite.Connection, share_id: int) -> int | None:
    """Seconds since the most recent (consumed or not) OTP for the share.

    Returns ``None`` if no OTP has ever been issued. Used for the
    email-resend cooldown check; we deliberately measure against any OTP
    (not only unconsumed ones) so that a quick consume + re-request
    cycle still respects the cooldown.
    """
    cursor = await db.execute(
        """SELECT CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER)
             FROM document_share_otps
            WHERE share_id = ?
            ORDER BY id DESC LIMIT 1""",
        (share_id,),
    )
    row = await cursor.fetchone()
    if not row or row[0] is None:
        return None
    return int(row[0])


async def issue_otp(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    ttl_minutes: int,
    delivery: str = "manual",
    cooldown_seconds: int = 0,
) -> str:
    """Generate, store, and return a fresh OTP code.

    Older unconsumed codes for this share are invalidated so only one
    pending code is ever live — prevents accidental verification of a
    code the admin already discarded.

    When ``delivery == 'email'`` the plaintext code is NOT persisted in
    ``otp_clear`` — the doctor receives it by mail and the admin's
    read-back path (``/active-otp``) returns ``None``. Closes the
    "rogue admin reads the OTP they just emailed" hole.

    When ``cooldown_seconds > 0`` and the previous OTP for this share
    is younger than that threshold, raises :class:`OtpCooldownError`.
    The check is skipped for ``cooldown_seconds == 0`` (current default
    for the manual flow, which has its own per-IP rate limit upstream).
    """
    if cooldown_seconds > 0:
        last_age = await _last_otp_age_seconds(db, share_id)
        if last_age is not None and last_age < cooldown_seconds:
            raise OtpCooldownError(cooldown_seconds - last_age)

    await db.execute(
        """UPDATE document_share_otps
              SET consumed_at = CURRENT_TIMESTAMP, otp_clear = NULL
            WHERE share_id = ? AND consumed_at IS NULL""",
        (share_id,),
    )
    code = generate_otp_code()
    stored_clear: str | None = None if delivery == "email" else code
    await db.execute(
        """INSERT INTO document_share_otps
              (share_id, otp_hash, otp_clear, expires_at)
           VALUES (?, ?, ?, ?)""",
        (share_id, hash_token(code), stored_clear, in_minutes(ttl_minutes)),
    )
    await db.commit()
    return code


# ── Share-level consecutive-failure lockout ──────────────────────


async def bump_consecutive_failures(db: aiosqlite.Connection, share_id: int) -> int:
    """Increment the per-share failure counter and return the new value.

    Used by the verify-OTP path to drive the share-level lockout: when
    the counter hits ``share.share_lockout_after_failed`` the caller
    revokes the share.
    """
    await db.execute(
        """UPDATE document_shares
              SET consecutive_otp_failures = COALESCE(consecutive_otp_failures, 0) + 1
            WHERE id = ?""",
        (share_id,),
    )
    await db.commit()
    cursor = await db.execute(
        "SELECT consecutive_otp_failures FROM document_shares WHERE id = ?",
        (share_id,),
    )
    row = await cursor.fetchone()
    return int((row[0] if row and row[0] is not None else 0))


async def reset_consecutive_failures(db: aiosqlite.Connection, share_id: int) -> None:
    """Zero the per-share failure counter — call on successful verify."""
    await db.execute(
        """UPDATE document_shares
              SET consecutive_otp_failures = 0
            WHERE id = ? AND consecutive_otp_failures != 0""",
        (share_id,),
    )
    await db.commit()


async def count_email_otps_today(db: aiosqlite.Connection, share_id: int) -> int:
    """Count ``otp_email_sent`` audit rows for this share in the last 24 h.

    Used to enforce ``share.email_otp_daily_cap``. SQLite's
    ``datetime('now','-1 day')`` and ``document_share_audit.created_at``
    are both in UTC, so no timezone gymnastics are needed.
    """
    cursor = await db.execute(
        """SELECT COUNT(*) FROM document_share_audit
            WHERE share_id = ?
              AND action = 'otp_email_sent'
              AND created_at >= datetime('now', '-1 day')""",
        (share_id,),
    )
    row = await cursor.fetchone()
    return int(row[0] if row and row[0] is not None else 0)


async def verify_otp(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    code: str,
    max_attempts: int,
) -> bool:
    """Verify a code and mark it consumed on success.

    Returns True iff the code matches a non-expired, non-consumed row whose
    attempt count is below the cap. Every call (success or failure)
    increments ``attempts`` so a correct code presented after the cap also
    rejects.
    """
    cursor = await db.execute(
        """SELECT id, otp_hash, expires_at, attempts, consumed_at
             FROM document_share_otps
            WHERE share_id = ?
              AND consumed_at IS NULL
            ORDER BY id DESC LIMIT 1""",
        (share_id,),
    )
    row = await cursor.fetchone()
    if not row:
        return False
    otp_id, otp_hash, expires_at, attempts, consumed_at = row
    now = utcnow_iso()
    if expires_at < now or attempts >= max_attempts or consumed_at is not None:
        # Burn the row regardless — no replay through stale state.
        await db.execute(
            """UPDATE document_share_otps
                  SET consumed_at = CURRENT_TIMESTAMP, otp_clear = NULL
                WHERE id = ?""",
            (otp_id,),
        )
        await db.commit()
        return False

    await db.execute(
        """UPDATE document_share_otps
              SET attempts = attempts + 1
            WHERE id = ?""",
        (otp_id,),
    )
    await db.commit()

    if not hmac.compare_digest(hash_token(code), otp_hash):
        return False

    await db.execute(
        """UPDATE document_share_otps
              SET consumed_at = CURRENT_TIMESTAMP, otp_clear = NULL
            WHERE id = ?""",
        (otp_id,),
    )
    await db.commit()
    return True


async def get_active_otp_clear(db: aiosqlite.Connection, share_id: int) -> dict | None:
    """For the admin audit panel: return the live OTP code (if any) for a
    share, alongside its expiry. Returns ``None`` once the code is
    consumed or expired."""
    cursor = await db.execute(
        """SELECT otp_clear, expires_at, attempts
             FROM document_share_otps
            WHERE share_id = ?
              AND consumed_at IS NULL
              AND otp_clear IS NOT NULL
              AND expires_at > ?
            ORDER BY id DESC LIMIT 1""",
        (share_id, utcnow_iso()),
    )
    row = await cursor.fetchone()
    if not row:
        return None
    return {
        "code": row[0],
        "expires_at": row[1],
        "attempts": row[2],
    }
