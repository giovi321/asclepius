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


async def _series_folder_with_access(
    study_id: int,
    series_id: int,
    current_user: dict,
    db: aiosqlite.Connection,
) -> str:
    """Resolve the series folder after enforcing patient access.

    Both ``list_frames`` and ``get_frame`` need the same lookup + access
    check. Without the access check any authenticated user could fetch
    DICOM frames for any patient by guessing study/series IDs.
    """
    cursor = await db.execute(
        """SELECT se.folder_path AS folder_path, st.patient_id AS patient_id
           FROM imaging_series se
           JOIN imaging_studies st ON se.study_id = st.id
           WHERE se.id = ? AND se.study_id = ?""",
        (series_id, study_id),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Series not found")

    patient_id = row["patient_id"]
    if patient_id:
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access")
    return row["folder_path"]


@router.get("/{study_id}/series/{series_id}/frames")
async def list_frames(
    study_id: int,
    series_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    folder = await _series_folder_with_access(study_id, series_id, current_user, db)

    config = get_config()
    series_path = Path(config.vault.root_path) / folder

    if not series_path.exists():
        return {"frames": [], "count": 0}

    frames = sorted(
        [f.name for f in series_path.iterdir() if f.suffix.lower() in {".dcm", ".dicom"}]
    )
    return {"frames": frames, "count": len(frames)}


@router.get("/{study_id}/series/{series_id}/frame/{index}")
async def get_frame(
    study_id: int,
    series_id: int,
    index: int,
    format: str = Query(default="png", pattern="^(png|dicom)$"),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    folder = await _series_folder_with_access(study_id, series_id, current_user, db)

    config = get_config()
    series_path = Path(config.vault.root_path) / folder
    if not series_path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")
    frames = sorted(
        [f for f in series_path.iterdir() if f.suffix.lower() in {".dcm", ".dicom"}]
    )

    if index < 0 or index >= len(frames):
        raise HTTPException(status_code=404, detail="Frame not found")

    if format == "dicom":
        return FileResponse(
            path=str(frames[index]),
            media_type="application/dicom",
        )

    # Convert DICOM to PNG for browser display
    try:
        import pydicom
        from PIL import Image as PILImage
        import numpy as np
        import io

        ds = pydicom.dcmread(str(frames[index]))
        pixel_array = ds.pixel_array.astype(float)

        # Apply windowing if available
        if hasattr(ds, "WindowCenter") and hasattr(ds, "WindowWidth"):
            wc = float(ds.WindowCenter) if not isinstance(ds.WindowCenter, pydicom.multival.MultiValue) else float(ds.WindowCenter[0])
            ww = float(ds.WindowWidth) if not isinstance(ds.WindowWidth, pydicom.multival.MultiValue) else float(ds.WindowWidth[0])
            img_min = wc - ww / 2
            img_max = wc + ww / 2
            pixel_array = np.clip(pixel_array, img_min, img_max)

        # Normalize to 0-255
        if pixel_array.max() != pixel_array.min():
            pixel_array = (pixel_array - pixel_array.min()) / (pixel_array.max() - pixel_array.min()) * 255
        pixel_array = pixel_array.astype(np.uint8)

        img = PILImage.fromarray(pixel_array)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        from fastapi.responses import StreamingResponse
        return StreamingResponse(buf, media_type="image/png")

    except Exception:
        # Fallback: serve raw DICOM
        return FileResponse(
            path=str(frames[index]),
            media_type="application/dicom",
        )
