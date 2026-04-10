"""Imaging API routes."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access

router = APIRouter()


@router.get("")
async def list_imaging_studies(
    patient_id: int | None = None,
    modality: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    conditions = []
    params: list = []

    if patient_id:
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access")
        conditions.append("s.patient_id = ?")
        params.append(patient_id)
    else:
        conditions.append(
            "s.patient_id IN (SELECT patient_id FROM user_patient_access WHERE user_id = ?)"
        )
        params.append(current_user["id"])

    if modality:
        conditions.append("s.modality = ?")
        params.append(modality)
    if date_from:
        conditions.append("s.study_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("s.study_date <= ?")
        params.append(date_to)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    cursor = await db.execute(
        f"""SELECT s.*, p.display_name as patient_name
            FROM imaging_studies s
            LEFT JOIN patients p ON s.patient_id = p.id
            {where}
            ORDER BY s.study_date DESC""",
        params,
    )
    rows = await cursor.fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/{study_id}")
async def get_imaging_study(
    study_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        """SELECT s.*, p.display_name as patient_name
           FROM imaging_studies s
           LEFT JOIN patients p ON s.patient_id = p.id
           WHERE s.id = ?""",
        (study_id,),
    )
    study = await cursor.fetchone()
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")

    study = dict(study)

    if study["patient_id"]:
        role = await check_patient_access(db, current_user["id"], study["patient_id"])
        if not role:
            raise HTTPException(status_code=403, detail="No access")

    # Get series
    cursor = await db.execute(
        "SELECT * FROM imaging_series WHERE study_id = ? ORDER BY series_number",
        (study_id,),
    )
    series = [dict(r) for r in await cursor.fetchall()]
    study["series"] = series

    return study


@router.get("/{study_id}/series/{series_id}/frames")
async def list_frames(
    study_id: int,
    series_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "SELECT folder_path FROM imaging_series WHERE id = ? AND study_id = ?",
        (series_id, study_id),
    )
    series = await cursor.fetchone()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    config = get_config()
    series_path = Path(config.vault.root_path) / series[0]

    if not series_path.exists():
        return {"frames": []}

    frames = sorted(
        [f.name for f in series_path.iterdir() if f.suffix.lower() in {".dcm", ".dicom"}]
    )
    return {"frames": frames, "count": len(frames)}


@router.get("/{study_id}/series/{series_id}/frame/{index}")
async def get_frame(
    study_id: int,
    series_id: int,
    index: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "SELECT folder_path FROM imaging_series WHERE id = ? AND study_id = ?",
        (series_id, study_id),
    )
    series = await cursor.fetchone()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    config = get_config()
    series_path = Path(config.vault.root_path) / series[0]
    frames = sorted(
        [f for f in series_path.iterdir() if f.suffix.lower() in {".dcm", ".dicom"}]
    )

    if index < 0 or index >= len(frames):
        raise HTTPException(status_code=404, detail="Frame not found")

    return FileResponse(
        path=str(frames[index]),
        media_type="application/dicom",
    )
