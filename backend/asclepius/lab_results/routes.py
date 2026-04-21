"""Lab results API routes."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access

router = APIRouter()

logger = logging.getLogger(__name__)


class LabResultUpdate(BaseModel):
    test_name_original: str | None = None
    value: float | None = None
    value_text: str | None = None
    unit: str | None = None
    reference_range_low: float | None = None
    reference_range_high: float | None = None
    is_abnormal: bool | None = None
    sample_type: str | None = None
    panel_name: str | None = None
    test_date: str | None = None
    norm_lab_test_id: int | None = None


class LabResultCreate(BaseModel):
    document_id: int
    test_name_original: str
    value: float | None = None
    value_text: str | None = None
    unit: str | None = None
    reference_range_low: float | None = None
    reference_range_high: float | None = None
    is_abnormal: bool | None = None
    sample_type: str | None = None
    panel_name: str | None = None
    test_date: str | None = None
    norm_lab_test_id: int | None = None


# Whitelist columns the PATCH may touch — everything below maps 1:1 to a real
# column on lab_results. Keeps the f-string UPDATE safe.
_EDITABLE = {
    "test_name_original", "value", "value_text", "unit",
    "reference_range_low", "reference_range_high", "is_abnormal",
    "sample_type", "panel_name", "test_date", "norm_lab_test_id",
}


async def _get_lab_result(db: aiosqlite.Connection, result_id: int) -> dict | None:
    cursor = await db.execute(
        "SELECT * FROM lab_results WHERE id = ?", (result_id,)
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


@router.get("")
async def list_lab_results(
    patient_id: int | None = None,
    test_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(default=500, le=2000),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    if patient_id:
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access")

    conditions = []
    params: list = []

    if patient_id:
        conditions.append("lr.patient_id = ?")
        params.append(patient_id)
    else:
        conditions.append(
            "lr.patient_id IN (SELECT patient_id FROM user_patient_access WHERE user_id = ?)"
        )
        params.append(current_user["id"])

    if test_name:
        conditions.append(
            "(lr.test_name_original LIKE ? OR nlt.canonical_display LIKE ?)"
        )
        params.extend([f"%{test_name}%", f"%{test_name}%"])
    if date_from:
        conditions.append("lr.test_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("lr.test_date <= ?")
        params.append(date_to)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    # JOIN the source document so the frontend can link back to it, and pull
    # canonical_code so the chart picker can group rows by canonical test.
    query = f"""
        SELECT lr.*,
               nlt.canonical_display as test_name_canonical,
               nlt.canonical_code,
               nlt.unit_preferred,
               nlt.category,
               p.display_name as patient_name,
               d.original_filename as document_filename,
               d.doc_type as document_doc_type,
               d.doc_date as document_doc_date,
               (d.id IS NULL) as document_missing
        FROM lab_results lr
        LEFT JOIN norm_lab_tests nlt ON lr.norm_lab_test_id = nlt.id
        LEFT JOIN patients p ON lr.patient_id = p.id
        LEFT JOIN documents d ON lr.document_id = d.id
        {where}
        ORDER BY lr.test_date DESC, lr.id DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/orphans")
async def list_orphan_lab_results(
    patient_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Lab results whose document_id no longer points to an existing document.

    Scoped to patients the current user has access to (same rule as the list
    endpoint). Explicit patient_id narrows the result further.
    """
    conditions = ["d.id IS NULL"]
    params: list = []

    if patient_id:
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access")
        conditions.append("lr.patient_id = ?")
        params.append(patient_id)
    else:
        conditions.append(
            "lr.patient_id IN (SELECT patient_id FROM user_patient_access WHERE user_id = ?)"
        )
        params.append(current_user["id"])

    query = f"""
        SELECT lr.*, nlt.canonical_display as test_name_canonical,
               p.display_name as patient_name
        FROM lab_results lr
        LEFT JOIN norm_lab_tests nlt ON lr.norm_lab_test_id = nlt.id
        LEFT JOIN patients p ON lr.patient_id = p.id
        LEFT JOIN documents d ON lr.document_id = d.id
        WHERE {" AND ".join(conditions)}
        ORDER BY lr.test_date DESC, lr.id DESC
    """
    cursor = await db.execute(query, params)
    return {"items": [dict(r) for r in await cursor.fetchall()]}


@router.get("/timeline")
async def lab_timeline(
    patient_id: int,
    test_name: str,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get time-series data for a specific test for charting."""
    role = await check_patient_access(db, current_user["id"], patient_id)
    if not role:
        raise HTTPException(status_code=403, detail="No access")

    cursor = await db.execute(
        """SELECT lr.test_date, lr.value, lr.value_text, lr.unit,
                  lr.reference_range_low, lr.reference_range_high, lr.is_abnormal,
                  nlt.canonical_display
           FROM lab_results lr
           LEFT JOIN norm_lab_tests nlt ON lr.norm_lab_test_id = nlt.id
           WHERE lr.patient_id = ?
             AND (lr.test_name_original LIKE ? OR nlt.canonical_display LIKE ?
                  OR nlt.canonical_code = ?)
           ORDER BY lr.test_date ASC""",
        (patient_id, f"%{test_name}%", f"%{test_name}%", test_name),
    )
    rows = await cursor.fetchall()
    return {"data": [dict(r) for r in rows]}


@router.post("")
async def create_lab_result(
    body: LabResultCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Create a lab result tied to a document.

    Patient is derived from the document so the caller can't attach a lab row
    to another patient's document. The document must already have a patient.
    """
    cursor = await db.execute(
        "SELECT patient_id FROM documents WHERE id = ?", (body.document_id,)
    )
    doc = await cursor.fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    patient_id = doc["patient_id"]
    if not patient_id:
        raise HTTPException(
            status_code=400,
            detail="Document has no patient assigned — set the patient before adding lab results",
        )

    if current_user.get("role") != "admin":
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access")
        if role == "viewer":
            raise HTTPException(status_code=403, detail="Viewers cannot create lab results")

    test_name = (body.test_name_original or "").strip()
    if not test_name:
        raise HTTPException(status_code=400, detail="test_name_original is required")

    try:
        cursor = await db.execute(
            """INSERT INTO lab_results
               (document_id, patient_id, test_name_original, norm_lab_test_id,
                value, value_text, unit, reference_range_low, reference_range_high,
                is_abnormal, sample_type, panel_name, test_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (body.document_id, patient_id, test_name, body.norm_lab_test_id,
             body.value, body.value_text, body.unit,
             body.reference_range_low, body.reference_range_high,
             body.is_abnormal, body.sample_type, body.panel_name,
             body.test_date),
        )
        await db.commit()
    except Exception as e:
        logger.exception("Failed to create lab result on doc %d", body.document_id)
        raise HTTPException(status_code=500, detail=f"Create failed: {e}") from e

    return await _get_lab_result(db, cursor.lastrowid)


@router.patch("/{result_id}")
async def update_lab_result(
    result_id: int,
    body: LabResultUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    row = await _get_lab_result(db, result_id)
    if not row:
        raise HTTPException(status_code=404, detail="Lab result not found")

    if current_user.get("role") != "admin":
        role = await check_patient_access(db, current_user["id"], row["patient_id"])
        if not role:
            raise HTTPException(status_code=403, detail="No access")
        if role == "viewer":
            raise HTTPException(status_code=403, detail="Viewers cannot edit lab results")

    updates = {}
    for field in body.model_fields_set:
        if field in _EDITABLE:
            updates[field] = getattr(body, field)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [result_id]
        await db.execute(
            f"UPDATE lab_results SET {set_clause} WHERE id = ?", values
        )
        await db.commit()
    except Exception as e:
        logger.exception("Failed to update lab result %d", result_id)
        raise HTTPException(status_code=500, detail=f"Update failed: {e}") from e

    return await _get_lab_result(db, result_id)


@router.delete("/{result_id}")
async def delete_lab_result(
    result_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    row = await _get_lab_result(db, result_id)
    if not row:
        raise HTTPException(status_code=404, detail="Lab result not found")

    if current_user.get("role") != "admin":
        role = await check_patient_access(db, current_user["id"], row["patient_id"])
        if not role:
            raise HTTPException(status_code=403, detail="No access")
        if role == "viewer":
            raise HTTPException(status_code=403, detail="Viewers cannot delete lab results")

    await db.execute("DELETE FROM lab_results WHERE id = ?", (result_id,))
    await db.commit()
    return {"ok": True}
