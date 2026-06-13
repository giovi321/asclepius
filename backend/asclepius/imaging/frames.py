"""DICOM frame resolution and PNG rendering helpers (no FastAPI routing).

These were lifted verbatim out of ``routes.py``; the only consolidation is
``_resolve_frame``, which folds the repeated access-check + folder-resolve +
sort + bounds-check that the by-index frame endpoints all performed.
"""

from pathlib import Path

from fastapi import HTTPException

import aiosqlite
from asclepius.authz import require_patient_access
from asclepius.config import get_config

# DICOM file extensions used when scanning a series folder for frames.
DICOM_EXTS = {".dcm", ".dicom"}


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
        await require_patient_access(db, patient_id, current_user)
    return row["folder_path"]


def _sorted_frames(series_path: Path) -> list[Path]:
    """Return the series folder's DICOM frame files, sorted by name."""
    return sorted([f for f in series_path.iterdir() if f.suffix.lower() in DICOM_EXTS])


async def _resolve_frame(
    study_id: int,
    series_id: int,
    index: int,
    current_user: dict,
    db: aiosqlite.Connection,
) -> Path:
    """Resolve a single frame file: access + folder + sort + bounds.

    Shared by ``get_frame``, ``get_frame_metadata`` and ``get_frame_window``,
    all of which previously inlined the identical access-check, folder-exists
    (404 "Frame not found"), sort, and bounds-check (404 "Frame not found")
    sequence. Returns the resolved frame ``Path``.
    """
    folder = await _series_folder_with_access(study_id, series_id, current_user, db)
    config = get_config()
    series_path = Path(config.vault.root_path) / folder
    if not series_path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")
    frames = _sorted_frames(series_path)
    if index < 0 or index >= len(frames):
        raise HTTPException(status_code=404, detail="Frame not found")
    return frames[index]
