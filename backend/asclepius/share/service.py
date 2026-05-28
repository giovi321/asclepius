"""Share/OTP/session helpers.

Token and OTP code generation, hashing, lookup, and audit-log writes. All
state-changing functions take an ``aiosqlite.Connection`` and commit before
returning so the caller never has to remember.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta

import aiosqlite

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


# ── Audit ────────────────────────────────────────────────────────


async def write_audit(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    action: str,
    session_id: str | None = None,
    document_id: int | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
    detail: dict | None = None,
) -> None:
    """Append a row to ``document_share_audit``. Best-effort; never raises."""
    try:
        await db.execute(
            """INSERT INTO document_share_audit
                  (share_id, session_id, action, document_id,
                   client_ip, user_agent, detail)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                share_id,
                session_id,
                action,
                document_id,
                client_ip,
                (user_agent or "")[:500] or None,
                json.dumps(detail) if detail else None,
            ),
        )
        await db.commit()
    except Exception:
        # An audit write must never break the user-facing path.
        pass


# ── Share row helpers ────────────────────────────────────────────


async def get_share_by_token(db: aiosqlite.Connection, raw_token: str) -> dict | None:
    """Resolve a raw URL token to its share row (active or not).

    Callers must check ``revoked_at`` and ``expires_at`` themselves; this
    helper just performs the constant-time hash lookup.
    """
    if not raw_token:
        return None
    cursor = await db.execute(
        """SELECT * FROM document_shares WHERE token_hash = ?""",
        (hash_token(raw_token),),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


async def get_share_by_id(db: aiosqlite.Connection, share_id: int) -> dict | None:
    cursor = await db.execute(
        """SELECT * FROM document_shares WHERE id = ?""",
        (share_id,),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


def is_share_active(share: dict) -> bool:
    """True iff the share is neither revoked nor past its expiry."""
    if share.get("revoked_at"):
        return False
    expires_at = share.get("expires_at")
    if expires_at and expires_at < utcnow_iso():
        return False
    return True


async def share_documents(db: aiosqlite.Connection, share_id: int) -> list[dict]:
    """Documents the share grants access to (subset of one patient's docs).

    Returns the same JOINed shape used by the regular document detail
    page so reusing display components on the doctor side is a one-liner.
    """
    cursor = await db.execute(
        """SELECT d.*,
                  doc.name AS doctor_name,
                  f.name AS facility_name,
                  ns.canonical_display AS specialty_canonical_display,
                  COALESCE(ns.canonical_display, d.specialty_original) AS specialty_display
           FROM document_share_documents dsd
           JOIN documents d ON d.id = dsd.document_id
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           LEFT JOIN norm_specialties ns ON d.norm_specialty_id = ns.id
           WHERE dsd.share_id = ?
           ORDER BY COALESCE(d.event_date, d.issued_date, d.created_at) DESC,
                    d.id DESC""",
        (share_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]


async def share_has_document(db: aiosqlite.Connection, share_id: int, document_id: int) -> bool:
    cursor = await db.execute(
        """SELECT 1 FROM document_share_documents
            WHERE share_id = ? AND document_id = ?""",
        (share_id, document_id),
    )
    return (await cursor.fetchone()) is not None


async def create_share(
    db: aiosqlite.Connection,
    *,
    patient_id: int,
    document_ids: list[int],
    recipient_label: str,
    recipient_contact: str,
    expires_at_iso: str,
    created_by_user_id: int,
    default_ocr_provider_id: str | None = None,
    default_llm_provider_id: str | None = None,
    otp_delivery: str = "manual",
) -> tuple[int, str]:
    """Insert a share + its document membership rows. Returns (share_id, raw_token).

    The raw token is returned to the caller exactly once. Provider
    defaults are stored on the share row so doctor-side translate calls
    can use them without the doctor seeing a provider picker.

    ``otp_delivery`` chooses how the doctor receives each OTP:
    ``'manual'`` keeps the legacy admin-reads-it-back flow; ``'email'``
    causes the public ``request-otp`` endpoint to send the code via SMTP
    to ``recipient_contact`` and to NEVER persist the plaintext code on
    the OTP row (so even a rogue admin cannot read it back).
    """
    if otp_delivery not in ("manual", "email"):
        raise ValueError(f"Invalid otp_delivery: {otp_delivery!r}")
    raw_token = generate_share_token()
    cursor = await db.execute(
        """INSERT INTO document_shares
              (token_hash, token_clear, patient_id, created_by_user_id,
               recipient_label, recipient_contact, contact_kind, expires_at,
               default_ocr_provider_id, default_llm_provider_id,
               otp_delivery)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            hash_token(raw_token),
            raw_token,
            patient_id,
            created_by_user_id,
            recipient_label,
            recipient_contact,
            otp_delivery,  # contact_kind mirrors delivery for backward compat
            expires_at_iso,
            default_ocr_provider_id or None,
            default_llm_provider_id or None,
            otp_delivery,
        ),
    )
    share_id = cursor.lastrowid
    if document_ids:
        await db.executemany(
            """INSERT OR IGNORE INTO document_share_documents
                  (share_id, document_id) VALUES (?, ?)""",
            [(share_id, doc_id) for doc_id in document_ids],
        )
    await db.commit()
    return share_id, raw_token


async def revoke_share(db: aiosqlite.Connection, share_id: int) -> None:
    """Mark a share revoked. Idempotent. Existing sessions are also revoked."""
    await db.execute(
        """UPDATE document_shares
              SET revoked_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revoked_at IS NULL""",
        (share_id,),
    )
    await db.execute(
        """UPDATE document_share_sessions
              SET revoked_at = CURRENT_TIMESTAMP
            WHERE share_id = ? AND revoked_at IS NULL""",
        (share_id,),
    )
    await db.commit()


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


# ── Sessions ─────────────────────────────────────────────────────


async def create_session(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    ttl_minutes: int,
    client_ip: str | None,
    user_agent: str | None,
) -> tuple[str, str]:
    """Create a share session row. Returns (session_id, expires_at_iso).

    ``last_seen_at`` defaults to ``CURRENT_TIMESTAMP`` at the schema
    level, so a fresh session starts the idle clock at zero.
    """
    sid = generate_session_id()
    expires_at = in_minutes(ttl_minutes)
    await db.execute(
        """INSERT INTO document_share_sessions
              (id, share_id, expires_at, client_ip, user_agent)
           VALUES (?, ?, ?, ?, ?)""",
        (sid, share_id, expires_at, client_ip, (user_agent or "")[:500] or None),
    )
    await db.commit()
    return sid, expires_at


async def get_session(db: aiosqlite.Connection, session_id: str) -> dict | None:
    cursor = await db.execute(
        """SELECT s.*, sh.patient_id, sh.recipient_label, sh.expires_at AS share_expires_at,
                  sh.revoked_at AS share_revoked_at
             FROM document_share_sessions s
             JOIN document_shares sh ON sh.id = s.share_id
            WHERE s.id = ?""",
        (session_id,),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


async def touch_session(db: aiosqlite.Connection, session_id: str) -> None:
    """Bump ``last_seen_at`` so the idle-timeout clock resets.

    Called on every authenticated share-side request (and on the
    explicit heartbeat ping while the page is visible). Cheap: keyed
    on the session PK and writes a single column.
    """
    await db.execute(
        """UPDATE document_share_sessions
              SET last_seen_at = CURRENT_TIMESTAMP
            WHERE id = ?""",
        (session_id,),
    )
    await db.commit()


async def revoke_session(db: aiosqlite.Connection, session_id: str) -> None:
    await db.execute(
        """UPDATE document_share_sessions
              SET revoked_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revoked_at IS NULL""",
        (session_id,),
    )
    await db.commit()


def session_active(session: dict, *, idle_timeout_minutes: int | None = None) -> bool:
    """True iff the session is alive: not revoked, not past TTL, share still
    valid, and (if ``idle_timeout_minutes`` is given) not idle.

    The idle check uses ``last_seen_at`` as the floor, falling back to
    ``created_at`` for legacy rows that pre-date the column.
    """
    if session.get("revoked_at") or session.get("share_revoked_at"):
        return False
    now = utcnow_iso()
    if session.get("expires_at") and session["expires_at"] < now:
        return False
    if session.get("share_expires_at") and session["share_expires_at"] < now:
        return False
    if idle_timeout_minutes is not None and idle_timeout_minutes > 0:
        last = session.get("last_seen_at") or session.get("created_at")
        if last:
            # SQLite ``CURRENT_TIMESTAMP`` emits ``2026-05-03 15:29:52``
            # (space separator) while Python's ``isoformat`` uses a ``T``.
            # Normalise both sides before lexicographic compare or the
            # space-vs-T ASCII difference makes a freshly-touched session
            # look older than a 10-minute-old cutoff.
            last_norm = last.replace(" ", "T")
            cutoff = (datetime.utcnow() - timedelta(minutes=idle_timeout_minutes)).isoformat(
                timespec="seconds"
            )
            if last_norm < cutoff:
                return False
    return True


async def get_active_session_for_share(
    db: aiosqlite.Connection,
    share_id: int,
    *,
    idle_timeout_minutes: int,
) -> dict | None:
    """Return the live session row for this share, if any.

    A session is "live" when it is not revoked, not past TTL, and was
    seen within the idle window. Used to enforce the
    one-session-per-share invariant: a second device verifying an OTP
    while this returns non-None gets a queue token instead of a
    session, and ``/claim`` waits for it to return None.
    """
    cursor = await db.execute(
        """SELECT s.*, sh.expires_at AS share_expires_at,
                  sh.revoked_at AS share_revoked_at
             FROM document_share_sessions s
             JOIN document_shares sh ON sh.id = s.share_id
            WHERE s.share_id = ?
              AND s.revoked_at IS NULL
            ORDER BY s.created_at DESC""",
        (share_id,),
    )
    rows = [dict(r) for r in await cursor.fetchall()]
    for row in rows:
        if session_active(row, idle_timeout_minutes=idle_timeout_minutes):
            return row
    return None


# ── Single-session queue ─────────────────────────────────────────


async def enqueue_for_share(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    ttl_minutes: int,
    client_ip: str | None,
    user_agent: str | None,
) -> tuple[str, str]:
    """Mint a queue token for a doctor waiting on a busy share.

    Returns ``(raw_token, expires_at_iso)``. The raw token goes in the
    ``asclepius_share_queue`` cookie; only its sha256 lives in the DB so
    a database read does not yield a usable cookie.
    """
    raw = generate_queue_token()
    expires_at = in_minutes(ttl_minutes)
    await db.execute(
        """INSERT INTO document_share_session_queue
              (id, share_id, expires_at, client_ip, user_agent)
           VALUES (?, ?, ?, ?, ?)""",
        (
            hash_token(raw),
            share_id,
            expires_at,
            client_ip,
            (user_agent or "")[:500] or None,
        ),
    )
    await db.commit()
    return raw, expires_at


async def get_queue_entry(db: aiosqlite.Connection, raw_token: str) -> dict | None:
    """Resolve a queue cookie value to its row (active or not)."""
    if not raw_token:
        return None
    cursor = await db.execute(
        """SELECT q.*, sh.recipient_label, sh.revoked_at AS share_revoked_at,
                  sh.expires_at AS share_expires_at
             FROM document_share_session_queue q
             JOIN document_shares sh ON sh.id = q.share_id
            WHERE q.id = ?""",
        (hash_token(raw_token),),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


def queue_entry_active(entry: dict) -> bool:
    """True iff the queue row is still usable: parent share alive and not
    past the queue token's own TTL."""
    if entry.get("share_revoked_at"):
        return False
    now = utcnow_iso()
    if entry.get("share_expires_at") and entry["share_expires_at"] < now:
        return False
    if entry.get("expires_at") and entry["expires_at"] < now:
        return False
    return True


async def delete_queue_entry(db: aiosqlite.Connection, raw_token: str) -> None:
    """Idempotent delete keyed by hashed cookie value."""
    if not raw_token:
        return
    await db.execute(
        "DELETE FROM document_share_session_queue WHERE id = ?",
        (hash_token(raw_token),),
    )
    await db.commit()


async def purge_expired_queue(db: aiosqlite.Connection) -> None:
    """Drop queue rows past their TTL. Cheap inline GC so the table does
    not grow unboundedly; called from /claim and verify-otp."""
    await db.execute(
        "DELETE FROM document_share_session_queue WHERE expires_at < ?",
        (utcnow_iso(),),
    )
    await db.commit()


# ── Admin-side session/queue listing and termination ──────────────


async def list_active_sessions_for_share(
    db: aiosqlite.Connection,
    share_id: int,
    *,
    idle_timeout_minutes: int,
) -> list[dict]:
    """List non-revoked, not-past-TTL sessions for the share, with
    metadata the admin needs (IP, UA, timestamps).

    The cookie-equivalent ``id`` column is intentionally NOT returned —
    we expose ``rowid`` instead so the admin's terminate action can key
    on a stable handle that does not double as an authentication token.
    Each row carries an ``is_idle`` flag computed against
    ``idle_timeout_minutes`` so the UI can flag dead-but-not-revoked
    sessions (the queue treats those as free slots).
    """
    now_iso = utcnow_iso()
    cursor = await db.execute(
        """SELECT s.rowid AS rowid, s.share_id, s.expires_at, s.last_seen_at,
                  s.client_ip, s.user_agent, s.created_at
             FROM document_share_sessions s
            WHERE s.share_id = ?
              AND s.revoked_at IS NULL
              AND s.expires_at > ?
            ORDER BY s.created_at DESC""",
        (share_id, now_iso),
    )
    rows = [dict(r) for r in await cursor.fetchall()]
    if idle_timeout_minutes > 0:
        cutoff = (datetime.utcnow() - timedelta(minutes=idle_timeout_minutes)).isoformat(
            timespec="seconds"
        )
        for row in rows:
            last = row.get("last_seen_at") or row.get("created_at")
            row["is_idle"] = bool(last and last.replace(" ", "T") < cutoff)
    else:
        for row in rows:
            row["is_idle"] = False
    return rows


async def revoke_session_by_rowid(db: aiosqlite.Connection, share_id: int, rowid: int) -> bool:
    """Mark a single session revoked, scoped to ``share_id`` so an admin
    cannot accidentally kill a session belonging to another share.
    Returns True iff a row was actually updated (idempotent on retries).
    """
    cursor = await db.execute(
        """UPDATE document_share_sessions
              SET revoked_at = CURRENT_TIMESTAMP
            WHERE rowid = ? AND share_id = ? AND revoked_at IS NULL""",
        (rowid, share_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def list_queued_for_share(db: aiosqlite.Connection, share_id: int) -> list[dict]:
    """List queue rows still usable (not past TTL) for this share."""
    now_iso = utcnow_iso()
    cursor = await db.execute(
        """SELECT q.rowid AS rowid, q.share_id, q.expires_at, q.client_ip,
                  q.user_agent, q.created_at
             FROM document_share_session_queue q
            WHERE q.share_id = ?
              AND q.expires_at > ?
            ORDER BY q.created_at ASC""",
        (share_id, now_iso),
    )
    return [dict(r) for r in await cursor.fetchall()]


async def delete_queue_entry_by_rowid(db: aiosqlite.Connection, share_id: int, rowid: int) -> bool:
    """Drop a queue entry by rowid, scoped to ``share_id``. Returns True
    iff a row was actually deleted.
    """
    cursor = await db.execute(
        """DELETE FROM document_share_session_queue
            WHERE rowid = ? AND share_id = ?""",
        (rowid, share_id),
    )
    await db.commit()
    return cursor.rowcount > 0


# ── Audit listing for admin ──────────────────────────────────────


async def list_audit(db: aiosqlite.Connection, share_id: int, limit: int = 200) -> list[dict]:
    cursor = await db.execute(
        """SELECT id, action, session_id, document_id, client_ip, user_agent,
                  detail, created_at
             FROM document_share_audit
            WHERE share_id = ?
            ORDER BY id DESC
            LIMIT ?""",
        (share_id, limit),
    )
    rows: list[dict] = []
    for r in await cursor.fetchall():
        item = dict(r)
        # Best-effort: parse stored JSON detail back into a dict for clients.
        if item.get("detail"):
            try:
                item["detail"] = json.loads(item["detail"])
            except json.JSONDecodeError:
                pass
        rows.append(item)
    return rows


# ── Admin listing ────────────────────────────────────────────────

# Listing columns + JOINs kept in one place because the patient-scoped and
# user-scoped variants share the same shape. We aggregate audit access
# counts via a LEFT JOIN against a pre-grouped subquery rather than three
# correlated SELECTs per row: the subquery touches the audit table once
# and the JOIN is keyed on the same indexed share_id, so cost is O(N)
# rather than O(N * audit_rows_per_share). On a busy install this is the
# difference between a snappy dashboard and a multi-second wait.
_SHARE_LIST_COLUMNS = """sh.id, sh.patient_id, sh.token_clear,
                          sh.recipient_label, sh.recipient_contact,
                          sh.contact_kind, sh.otp_delivery,
                          sh.expires_at, sh.revoked_at, sh.created_at,
                          sh.default_ocr_provider_id, sh.default_llm_provider_id,
                          u.username AS created_by_username,
                          p.display_name AS patient_name,
                          COALESCE(dc.cnt, 0) AS document_count,
                          COALESCE(ac.cnt, 0) AS access_count,
                          ac.last_at AS last_accessed_at"""

_SHARE_LIST_JOINS = """JOIN users u ON u.id = sh.created_by_user_id
                        JOIN patients p ON p.id = sh.patient_id
                        LEFT JOIN (
                          SELECT share_id, COUNT(*) AS cnt
                          FROM document_share_documents
                          GROUP BY share_id
                        ) dc ON dc.share_id = sh.id
                        LEFT JOIN (
                          SELECT share_id,
                                 COUNT(*) AS cnt,
                                 MAX(created_at) AS last_at
                          FROM document_share_audit
                          WHERE action IN ('view_doc', 'view_file', 'translate')
                          GROUP BY share_id
                        ) ac ON ac.share_id = sh.id"""


async def list_shares_for_patient(db: aiosqlite.Connection, patient_id: int) -> list[dict]:
    cursor = await db.execute(
        f"""SELECT {_SHARE_LIST_COLUMNS}
             FROM document_shares sh
             {_SHARE_LIST_JOINS}
            WHERE sh.patient_id = ?
            ORDER BY sh.id DESC""",
        (patient_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]


async def list_shares_for_user(db: aiosqlite.Connection, current_user: dict) -> list[dict]:
    """Every share the caller may manage.

    Admins see all shares regardless of patient. Non-admins see shares
    for the patients they own (mirrors the permission gate used at share
    creation time).
    """
    if current_user.get("role") == "admin":
        cursor = await db.execute(
            f"""SELECT {_SHARE_LIST_COLUMNS}
                 FROM document_shares sh
                 {_SHARE_LIST_JOINS}
                ORDER BY sh.id DESC"""
        )
    else:
        cursor = await db.execute(
            f"""SELECT {_SHARE_LIST_COLUMNS}
                 FROM document_shares sh
                 {_SHARE_LIST_JOINS}
                 JOIN user_patient_access upa
                   ON upa.patient_id = sh.patient_id
                  AND upa.user_id = ?
                  AND upa.role = 'owner'
                ORDER BY sh.id DESC""",
            (current_user["id"],),
        )
    return [dict(r) for r in await cursor.fetchall()]
