"""PATCH endpoints for child records (encounters, medications).

These rows are extracted from a parent document but the user can fix them
inline on the document detail page. Mirrors the pattern used by
``imaging/routes.py:update_imaging_metadata``: each accepted field is also
recorded in ``extraction_corrections`` so the few-shot retrieval picks up the
correction next time we re-process a similar doc.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import aiosqlite
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.auth.session import get_current_user
from asclepius.authz import require_document_access
from asclepius.db.connection import get_db
from asclepius.documents.service import get_document
from asclepius.normalization.resolver import (
    AliasCache,
    resolve_diagnosis,
    resolve_medication,
    resolve_specialty,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _row_with_doc(
    db: aiosqlite.Connection,
    table: str,
    row_id: int,
) -> tuple[dict, dict]:
    """Fetch a child row + its parent document, with row-not-found handling."""
    cursor = await db.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"{table[:-1].title()} not found")
    rec = dict(row)
    doc = await get_document(db, rec["document_id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Parent document missing")
    return rec, doc


async def _require_doc_write(
    db: aiosqlite.Connection,
    current_user: dict,
    doc: dict,
) -> None:
    """Write-access check for child-record edits/deletes.

    Delegates to the canonical :func:`asclepius.authz.require_document_access`
    with ``write=True``. This intentionally tightens the old behavior: the
    previous copy accepted *any* patient grant, which let viewers edit and
    delete encounters / medications. Viewers are now rejected; admins, the
    uploader, and owner/editor grants are allowed.
    """
    await require_document_access(db, doc, current_user, write=True)


# ── Encounters ─────────────────────────────────────────────────────


class EncounterPatch(BaseModel):
    diagnosis_original: str | None = Field(default=None, max_length=500)
    diagnosis_code: str | None = Field(default=None, max_length=40)
    specialty_original: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=5000)
    findings: str | None = Field(default=None, max_length=5000)


_ENCOUNTER_TEXT_FIELDS = {
    "diagnosis_original",
    "diagnosis_code",
    "notes",
    "findings",
}


@router.patch("/encounters/{encounter_id}")
async def update_encounter(
    encounter_id: int,
    body: EncounterPatch,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Edit an encounter's diagnosis / specialty / notes inline.

    ``diagnosis_original`` and ``specialty_original`` resolve to canonical
    norm_* ids on the same row so the detail-view join (which displays via
    ``norm_*`` tables) reflects the change.
    """
    rec, doc = await _row_with_doc(db, "encounters", encounter_id)
    await _require_doc_write(db, current_user, doc)

    set_parts: list[str] = []
    params: list = []
    corrections: list[tuple[str, str | None, str | None]] = []
    cache = AliasCache()

    for field in body.model_fields_set:
        new_val = getattr(body, field)
        if isinstance(new_val, str):
            new_val = new_val.strip() or None

        if field in _ENCOUNTER_TEXT_FIELDS:
            old_val = rec.get(field)
            if (old_val or None) == (new_val or None):
                continue
            set_parts.append(f"{field} = ?")
            params.append(new_val)
            corrections.append((field, old_val, new_val))
            # Resolve diagnosis_original to norm_diagnosis_id so the display
            # join updates in lockstep.
            if field == "diagnosis_original":
                norm_id = await resolve_diagnosis(db, cache, new_val) if new_val else None
                set_parts.append("norm_diagnosis_id = ?")
                params.append(norm_id)

        elif field == "specialty_original":
            old_specialty = rec.get("norm_specialty_id")
            norm_id = await resolve_specialty(db, cache, new_val) if new_val else None
            if (old_specialty or None) == (norm_id or None):
                continue
            set_parts.append("norm_specialty_id = ?")
            params.append(norm_id)
            corrections.append(("specialty_original", None, new_val))

    if not set_parts:
        return {"status": "noop", "id": encounter_id}

    params.append(encounter_id)
    await db.execute(
        f"UPDATE encounters SET {', '.join(set_parts)} WHERE id = ?",
        params,
    )
    for field, old_val, new_val in corrections:
        await db.execute(
            """INSERT INTO extraction_corrections
               (document_id, field_name, llm_value, corrected_value, doc_type)
               VALUES (?, ?, ?, ?, ?)""",
            (
                rec["document_id"],
                f"encounter.{field}",
                old_val,
                new_val,
                doc.get("doc_type") or "encounter",
            ),
        )
    await db.commit()

    await audit_log(
        db,
        current_user["id"],
        "encounter.update",
        "encounter",
        encounter_id,
        {"fields": [c[0] for c in corrections]},
        get_client_ip(request),
    )
    return {"status": "updated", "id": encounter_id, "fields": [c[0] for c in corrections]}


@router.delete("/encounters/{encounter_id}")
async def delete_encounter(
    encounter_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Remove an encounter row. The parent document is left untouched —
    only this single extracted record is dropped."""
    rec, doc = await _row_with_doc(db, "encounters", encounter_id)
    await _require_doc_write(db, current_user, doc)
    await db.execute("DELETE FROM encounters WHERE id = ?", (encounter_id,))
    await db.commit()
    await audit_log(
        db,
        current_user["id"],
        "encounter.delete",
        "encounter",
        encounter_id,
        {"document_id": rec.get("document_id")},
        get_client_ip(request),
    )
    return {"status": "deleted", "id": encounter_id}


# ── Medications ────────────────────────────────────────────────────


class MedicationPatch(BaseModel):
    active_ingredient_original: str | None = Field(default=None, max_length=200)
    brand_name: str | None = Field(default=None, max_length=200)
    dosage: str | None = Field(default=None, max_length=120)
    form: str | None = Field(default=None, max_length=80)
    frequency: str | None = Field(default=None, max_length=120)
    duration: str | None = Field(default=None, max_length=120)
    quantity: str | None = Field(default=None, max_length=40)


_MEDICATION_TEXT_FIELDS = {
    "active_ingredient_original",
    "brand_name",
    "dosage",
    "form",
    "frequency",
    "duration",
    "quantity",
}


@router.patch("/medications/{medication_id}")
async def update_medication(
    medication_id: int,
    body: MedicationPatch,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Edit a medication row inline. ``active_ingredient_original`` resolves
    to ``norm_medication_id`` so future extractions pick up the alias."""
    rec, doc = await _row_with_doc(db, "medications", medication_id)
    await _require_doc_write(db, current_user, doc)

    set_parts: list[str] = []
    params: list = []
    corrections: list[tuple[str, str | None, str | None]] = []
    cache = AliasCache()

    for field in body.model_fields_set:
        if field not in _MEDICATION_TEXT_FIELDS:
            continue
        new_val = getattr(body, field)
        if isinstance(new_val, str):
            new_val = new_val.strip() or None
        old_val = rec.get(field)
        if (old_val or None) == (new_val or None):
            continue
        set_parts.append(f"{field} = ?")
        params.append(new_val)
        corrections.append((field, old_val, new_val))
        if field == "active_ingredient_original":
            norm_id = await resolve_medication(db, cache, new_val) if new_val else None
            set_parts.append("norm_medication_id = ?")
            params.append(norm_id)

    if not set_parts:
        return {"status": "noop", "id": medication_id}

    params.append(medication_id)
    await db.execute(
        f"UPDATE medications SET {', '.join(set_parts)} WHERE id = ?",
        params,
    )
    for field, old_val, new_val in corrections:
        await db.execute(
            """INSERT INTO extraction_corrections
               (document_id, field_name, llm_value, corrected_value, doc_type)
               VALUES (?, ?, ?, ?, ?)""",
            (
                rec["document_id"],
                f"medication.{field}",
                old_val,
                new_val,
                doc.get("doc_type") or "prescription",
            ),
        )
    await db.commit()

    await audit_log(
        db,
        current_user["id"],
        "medication.update",
        "medication",
        medication_id,
        {"fields": [c[0] for c in corrections]},
        get_client_ip(request),
    )
    return {"status": "updated", "id": medication_id, "fields": [c[0] for c in corrections]}


@router.delete("/medications/{medication_id}")
async def delete_medication(
    medication_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Remove a medication row. The parent document is left untouched."""
    rec, doc = await _row_with_doc(db, "medications", medication_id)
    await _require_doc_write(db, current_user, doc)
    await db.execute("DELETE FROM medications WHERE id = ?", (medication_id,))
    await db.commit()
    await audit_log(
        db,
        current_user["id"],
        "medication.delete",
        "medication",
        medication_id,
        {"document_id": rec.get("document_id")},
        get_client_ip(request),
    )
    return {"status": "deleted", "id": medication_id}
