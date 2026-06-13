"""Share-row CRUD, lookup, the doc-field projection, and admin listing.

The doctor-facing document projection (:func:`share_documents`) is the
trust boundary: it defines exactly which document fields the doctor side
can read. It is moved here verbatim — do not alter the SELECT shape.
"""

from __future__ import annotations

import aiosqlite

from asclepius.share.tokens import generate_share_token, hash_token, utcnow_iso

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


async def add_share_documents(
    db: aiosqlite.Connection, share_id: int, document_ids: list[int]
) -> dict:
    """Add documents to an existing share, skipping any already present.

    The caller is responsible for confirming each id belongs to the
    share's patient (the admin route does this, mirroring share
    creation). Returns ``{added, already_present}`` so the UI can give an
    honest count — useful when the admin re-adds a selection that
    overlaps what's already shared.
    """
    cursor = await db.execute(
        "SELECT document_id FROM document_share_documents WHERE share_id = ?",
        (share_id,),
    )
    existing = {row[0] for row in await cursor.fetchall()}
    to_add = [d for d in document_ids if d not in existing]
    if to_add:
        await db.executemany(
            """INSERT OR IGNORE INTO document_share_documents
                  (share_id, document_id) VALUES (?, ?)""",
            [(share_id, doc_id) for doc_id in to_add],
        )
        await db.commit()
    return {"added": len(to_add), "already_present": len(document_ids) - len(to_add)}


async def delete_share(db: aiosqlite.Connection, share_id: int) -> None:
    """Hard-delete a share and everything that hangs off it.

    The membership / OTP / session / queue child tables all declare
    ``ON DELETE CASCADE`` against ``document_shares(id)``, so deleting the
    parent row removes them too (``get_db`` opens connections with
    ``PRAGMA foreign_keys=ON``). The audit table is intentionally
    FK-less — audit rows must survive their subject in general — so we
    clear this share's audit rows explicitly before dropping the row.

    Distinct from :func:`revoke_share`, which only flips ``revoked_at``
    and keeps the row for the dashboard. This is the "remove it from the
    database entirely" path the admin reaches via the purge endpoint.
    """
    await db.execute(
        "DELETE FROM document_share_audit WHERE share_id = ?",
        (share_id,),
    )
    await db.execute(
        "DELETE FROM document_shares WHERE id = ?",
        (share_id,),
    )
    await db.commit()


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

# LEFT JOIN users/patients (not INNER): a share whose creating user was
# deleted while FK enforcement was off — common for rows predating the
# revoke feature — would otherwise drop out of the listing entirely,
# leaving the admin unable to see or delete it. With LEFT JOIN the row
# still appears (``created_by_username`` / ``patient_name`` simply come
# back NULL) so it can be purged from the dashboard.
_SHARE_LIST_JOINS = """LEFT JOIN users u ON u.id = sh.created_by_user_id
                        LEFT JOIN patients p ON p.id = sh.patient_id
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
