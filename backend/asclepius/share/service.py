"""Share/OTP/session helpers.

Token and OTP code generation, hashing, lookup, and audit-log writes. All
state-changing functions take an ``aiosqlite.Connection`` and commit before
returning so the caller never has to remember.
"""

from __future__ import annotations

import hashlib
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
) -> tuple[int, str]:
    """Insert a share + its document membership rows. Returns (share_id, raw_token).

    The raw token is returned to the caller exactly once and never stored
    in plaintext — only its sha256 lives in ``token_hash``.
    """
    raw_token = generate_share_token()
    cursor = await db.execute(
        """INSERT INTO document_shares
              (token_hash, patient_id, created_by_user_id,
               recipient_label, recipient_contact, contact_kind, expires_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?)""",
        (
            hash_token(raw_token),
            patient_id,
            created_by_user_id,
            recipient_label,
            recipient_contact,
            expires_at_iso,
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


async def issue_otp(
    db: aiosqlite.Connection,
    *,
    share_id: int,
    ttl_minutes: int,
) -> str:
    """Generate, store, and return a fresh OTP code.

    Older unconsumed codes for this share are invalidated so only one
    pending code is ever live — prevents accidental verification of a
    code the admin already discarded.
    """
    await db.execute(
        """UPDATE document_share_otps
              SET consumed_at = CURRENT_TIMESTAMP, otp_clear = NULL
            WHERE share_id = ? AND consumed_at IS NULL""",
        (share_id,),
    )
    code = generate_otp_code()
    await db.execute(
        """INSERT INTO document_share_otps
              (share_id, otp_hash, otp_clear, expires_at)
           VALUES (?, ?, ?, ?)""",
        (share_id, hash_token(code), code, in_minutes(ttl_minutes)),
    )
    await db.commit()
    return code


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

    if hash_token(code) != otp_hash:
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
    """Create a share session row. Returns (session_id, expires_at_iso)."""
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


async def revoke_session(db: aiosqlite.Connection, session_id: str) -> None:
    await db.execute(
        """UPDATE document_share_sessions
              SET revoked_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revoked_at IS NULL""",
        (session_id,),
    )
    await db.commit()


def session_active(session: dict) -> bool:
    if session.get("revoked_at") or session.get("share_revoked_at"):
        return False
    now = utcnow_iso()
    if session.get("expires_at") and session["expires_at"] < now:
        return False
    if session.get("share_expires_at") and session["share_expires_at"] < now:
        return False
    return True


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


async def list_shares_for_patient(db: aiosqlite.Connection, patient_id: int) -> list[dict]:
    cursor = await db.execute(
        """SELECT sh.id, sh.patient_id, sh.recipient_label, sh.recipient_contact,
                  sh.contact_kind, sh.expires_at, sh.revoked_at, sh.created_at,
                  u.username AS created_by_username,
                  (SELECT COUNT(*) FROM document_share_documents dsd
                    WHERE dsd.share_id = sh.id) AS document_count
             FROM document_shares sh
             JOIN users u ON u.id = sh.created_by_user_id
            WHERE sh.patient_id = ?
            ORDER BY sh.id DESC""",
        (patient_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]
