"""Lab results API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access

router = APIRouter()


@router.get("")
async def list_lab_results(
    patient_id: int | None = None,
    test_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(default=100, le=500),
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

    query = f"""
        SELECT lr.*, nlt.canonical_display as test_name_canonical,
               nlt.unit_preferred, nlt.category,
               p.display_name as patient_name
        FROM lab_results lr
        LEFT JOIN norm_lab_tests nlt ON lr.norm_lab_test_id = nlt.id
        LEFT JOIN patients p ON lr.patient_id = p.id
        {where}
        ORDER BY lr.test_date DESC, lr.id DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return {"items": [dict(r) for r in rows]}


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
