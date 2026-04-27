"""Imaging API routes."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access

router = APIRouter()


async def _study_with_access(
    study_id: int,
    current_user: dict,
    db: aiosqlite.Connection,
) -> dict:
    cursor = await db.execute(
        "SELECT id, document_id, patient_id, folder_path "
        "FROM imaging_studies WHERE id = ?",
        (study_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Study not found")
    study = dict(row)
    if study["patient_id"]:
        role = await check_patient_access(db, current_user["id"], study["patient_id"])
        if not role:
            raise HTTPException(status_code=403, detail="No access")
    return study


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
    wc: float | None = Query(default=None),
    ww: float | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Serve a frame as PNG (default) or raw DICOM.

    ``wc`` and ``ww`` override the DICOM file's WindowCenter / WindowWidth
    so MRI users can adjust contrast / brightness from the viewer without
    re-decoding pixel data on the client. Both must be supplied together;
    otherwise the file's own VOI LUT is used (or a default min-max
    normalisation when none is present).
    """
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

        # Decide window-level. Caller-supplied wc+ww win; otherwise fall
        # back to the file's WindowCenter/WindowWidth tags.
        if wc is not None and ww is not None and ww > 0:
            wc_val: float | None = wc
            ww_val: float | None = ww
        elif hasattr(ds, "WindowCenter") and hasattr(ds, "WindowWidth"):
            wc_val = float(ds.WindowCenter) if not isinstance(ds.WindowCenter, pydicom.multival.MultiValue) else float(ds.WindowCenter[0])
            ww_val = float(ds.WindowWidth) if not isinstance(ds.WindowWidth, pydicom.multival.MultiValue) else float(ds.WindowWidth[0])
        else:
            wc_val = None
            ww_val = None

        if wc_val is not None and ww_val is not None:
            img_min = wc_val - ww_val / 2
            img_max = wc_val + ww_val / 2
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


# ── Bundle files (DICOMDIR, JPEG previews, etc.) ───────────────────


def _bundle_root_for_study(folder_path: str) -> str | None:
    """Return the imaging-bundles directory path for a given study folder.

    Study folder layout: ``patients/{slug}/{year}/imaging/{study_folder}``.
    Bundle layout:        ``patients/{slug}/imaging-bundles``.
    Returns None if the path does not match the expected shape.
    """
    parts = folder_path.split("/")
    if "imaging" not in parts:
        return None
    idx = parts.index("imaging")
    return "/".join(parts[:idx] + ["imaging-bundles"])


@router.get("/{study_id}/bundle-files")
async def list_bundle_files(
    study_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List the auxiliary files (DICOMDIR, JPEG previews, LOCKFILE, etc.)
    that came in the same zip bundle as this study's DICOM frames.

    Returns ``[{name, size, kind}]`` entries the UI can render and link to
    via the ``GET .../bundle-file/{name}`` route.
    """
    study = await _study_with_access(study_id, current_user, db)
    folder_path = study["folder_path"] or ""
    bundle_root = _bundle_root_for_study(folder_path)
    if not bundle_root:
        return {"items": []}

    config = get_config()
    bundle_path = Path(config.vault.root_path) / bundle_root
    if not bundle_path.exists():
        return {"items": []}

    items: list[dict] = []
    for sub in bundle_path.iterdir():
        if sub.is_dir():
            for f in sub.iterdir():
                if f.is_file():
                    items.append({
                        "name": f"{sub.name}/{f.name}",
                        "size": f.stat().st_size,
                        "kind": _kind_for_extension(f.suffix.lower()),
                    })
        elif sub.is_file():
            items.append({
                "name": sub.name,
                "size": sub.stat().st_size,
                "kind": _kind_for_extension(sub.suffix.lower()),
            })
    items.sort(key=lambda i: i["name"])
    return {"items": items}


def _kind_for_extension(ext: str) -> str:
    if ext in {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".gif", ".bmp"}:
        return "image"
    if ext == ".pdf":
        return "pdf"
    if ext in {".dcm", ".dicom"}:
        return "dicom"
    return "other"


@router.get("/{study_id}/bundle-file/{name:path}")
async def get_bundle_file(
    study_id: int,
    name: str,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Download a bundle file by name (the same string returned by the
    list endpoint). Path traversal is rejected via ``safe_vault_join``."""
    from asclepius.util.paths import UnsafePathError, safe_vault_join

    study = await _study_with_access(study_id, current_user, db)
    folder_path = study["folder_path"] or ""
    bundle_root = _bundle_root_for_study(folder_path)
    if not bundle_root:
        raise HTTPException(status_code=404, detail="No bundle for this study")

    config = get_config()
    bundle_path = Path(config.vault.root_path) / bundle_root
    try:
        target = safe_vault_join(bundle_path, *name.split("/"))
    except UnsafePathError:
        raise HTTPException(status_code=400, detail="Unsafe filename")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=str(target), filename=target.name)


# ── Linked documents (radiology reports, etc.) ─────────────────────


class LinkRequest(BaseModel):
    target_document_id: int
    link_type: str = "imaging_for"


@router.get("/{study_id}/links")
async def list_imaging_links(
    study_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Documents linked to this imaging study (e.g. a radiology report PDF)."""
    study = await _study_with_access(study_id, current_user, db)
    cursor = await db.execute(
        """SELECT dl.id AS link_id, dl.link_type, d.id, d.original_filename,
                  d.doc_type, d.event_date
           FROM document_links dl
           JOIN documents d ON d.id = dl.target_document_id
           WHERE dl.source_document_id = ?
           UNION
           SELECT dl.id AS link_id, dl.link_type, d.id, d.original_filename,
                  d.doc_type, d.event_date
           FROM document_links dl
           JOIN documents d ON d.id = dl.source_document_id
           WHERE dl.target_document_id = ?""",
        (study["document_id"], study["document_id"]),
    )
    rows = await cursor.fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/{study_id}/links", status_code=201)
async def add_imaging_link(
    study_id: int,
    body: LinkRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Link an existing document (e.g. a radiology report) to this study."""
    study = await _study_with_access(study_id, current_user, db)
    cursor = await db.execute(
        "SELECT patient_id FROM documents WHERE id = ?",
        (body.target_document_id,),
    )
    target = await cursor.fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="Target document not found")
    target_patient = target[0]
    if target_patient:
        role = await check_patient_access(db, current_user["id"], target_patient)
        if not role:
            raise HTTPException(status_code=403, detail="No access to target")
    try:
        cursor = await db.execute(
            """INSERT INTO document_links
               (source_document_id, target_document_id, link_type)
               VALUES (?, ?, ?)""",
            (study["document_id"], body.target_document_id, body.link_type),
        )
        link_id = cursor.lastrowid
        await db.commit()
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="Link already exists")
    return {"id": link_id, "status": "linked"}


@router.delete("/{study_id}/links/{link_id}")
async def remove_imaging_link(
    study_id: int,
    link_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Remove a document_links row. Validates the link belongs to this study."""
    study = await _study_with_access(study_id, current_user, db)
    cursor = await db.execute(
        "SELECT source_document_id, target_document_id FROM document_links "
        "WHERE id = ?",
        (link_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Link not found")
    if study["document_id"] not in (row[0], row[1]):
        raise HTTPException(status_code=400, detail="Link not attached to this study")
    await db.execute("DELETE FROM document_links WHERE id = ?", (link_id,))
    await db.commit()
    return {"status": "deleted"}
