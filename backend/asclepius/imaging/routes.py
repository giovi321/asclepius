"""Imaging API routes."""

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
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


_LIST_SORT_COLUMNS: dict[str, str] = {
    # Frontend sort key → SQL expression. Whitelist only — anything not
    # here falls back to ``study_date DESC``. Doctor + facility are
    # joined through documents → doctors / facilities so the sort lines
    # up with the canonical names shown in the UI. Study date now lives
    # on the parent ``documents.event_date`` (single source of truth).
    "modality":          "s.modality",
    "body_part":         "s.body_part",
    "study_date":        "d.event_date",
    "doctor":            "doc.name",
    "facility":          "f.name",
    "patient":           "p.display_name",
    "report_status":     "s.report_status",
    "date_added":        "d.created_at",
}


@router.get("")
async def list_imaging_studies(
    patient_id: int | None = None,
    modality: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    q: str | None = Query(default=None, description="Search across body part, study description, doctor name, facility name"),
    report_status: str | None = Query(default=None, pattern="^(placeholder|attached)$"),
    sort: str | None = None,
    order: str | None = Query(default=None, pattern="^(asc|desc)$"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List imaging studies. Mirrors the documents-list shape: search,
    filters, sort, paginated results with ``total`` count."""
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
    if report_status:
        conditions.append("s.report_status = ?")
        params.append(report_status)
    if date_from:
        conditions.append("d.event_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("d.event_date <= ?")
        params.append(date_to)
    if q:
        like = f"%{q}%"
        # Search is across imaging-specific text + the canonical doctor /
        # facility names that come from the parent documents row.
        conditions.append(
            "(s.body_part LIKE ? OR s.study_description LIKE ? "
            "OR doc.name LIKE ? OR f.name LIKE ?)"
        )
        params.extend([like, like, like, like])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    sort_sql = _LIST_SORT_COLUMNS.get(sort or "", "d.event_date")
    order_sql = "ASC" if (order or "desc").lower() == "asc" else "DESC"

    # Count total (unbounded) so the UI can paginate.
    count_cursor = await db.execute(
        f"""SELECT COUNT(*)
            FROM imaging_studies s
            LEFT JOIN documents d ON s.document_id = d.id
            LEFT JOIN patients p ON s.patient_id = p.id
            LEFT JOIN doctors doc ON s.doctor_id = doc.id
            LEFT JOIN facilities f ON s.facility_id = f.id
            {where}""",
        params,
    )
    total_row = await count_cursor.fetchone()
    total = total_row[0] if total_row else 0

    cursor = await db.execute(
        f"""SELECT s.*,
                  p.display_name as patient_name,
                  doc.name as doctor_name,
                  f.name as facility_name,
                  d.original_filename as report_filename,
                  d.file_path as report_file_path,
                  d.event_date as study_date,
                  d.created_at as date_added
           FROM imaging_studies s
           LEFT JOIN documents d ON s.document_id = d.id
           LEFT JOIN patients p ON s.patient_id = p.id
           LEFT JOIN doctors doc ON s.doctor_id = doc.id
           LEFT JOIN facilities f ON s.facility_id = f.id
           {where}
           ORDER BY {sort_sql} {order_sql}, s.id DESC
           LIMIT ? OFFSET ?""",
        params + [limit, offset],
    )
    rows = await cursor.fetchall()
    return {"items": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/{study_id}")
async def get_imaging_study(
    study_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        """SELECT s.*,
                  p.display_name as patient_name,
                  d.original_filename as report_filename,
                  d.file_path as report_file_path,
                  d.doc_type as report_doc_type,
                  d.event_date as study_date
           FROM imaging_studies s
           LEFT JOIN documents d ON s.document_id = d.id
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
    invert: bool = Query(default=False),
    upscale: int = Query(default=1, ge=1, le=8),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Serve a frame as PNG (default) or raw DICOM.

    ``wc`` and ``ww`` override the DICOM file's WindowCenter / WindowWidth
    so MRI users can adjust contrast / brightness from the viewer without
    re-decoding pixel data on the client. Both must be supplied together;
    otherwise the file's own VOI LUT is used (or a default min-max
    normalisation when none is present).

    ``upscale`` (1-4) bicubic-resamples the PNG to N× the source size before
    encoding. The viewer asks for ``upscale=2`` once the user zooms past
    ~1.5× and ``upscale=4`` past ~3×, trading bandwidth for sharpness so
    the canvas-scale fallback no longer pixelates.
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

        # Apply Modality LUT (RescaleSlope/RescaleIntercept) before windowing.
        # CT data is mandatory (Hounsfield Units); some MR vendors set them too.
        slope = float(getattr(ds, "RescaleSlope", 1) or 1)
        intercept = float(getattr(ds, "RescaleIntercept", 0) or 0)
        if slope != 1 or intercept != 0:
            pixel_array = pixel_array * slope + intercept

        # Decide window-level. Caller can supply ``wc`` and/or ``ww``; the
        # missing axis falls back to the DICOM file's own VOI tag, so a
        # single slider move still applies (previously both had to be sent
        # together for the override to win).
        file_wc: float | None = None
        file_ww: float | None = None
        if hasattr(ds, "WindowCenter") and hasattr(ds, "WindowWidth"):
            file_wc = float(ds.WindowCenter) if not isinstance(ds.WindowCenter, pydicom.multival.MultiValue) else float(ds.WindowCenter[0])
            file_ww = float(ds.WindowWidth) if not isinstance(ds.WindowWidth, pydicom.multival.MultiValue) else float(ds.WindowWidth[0])

        wc_val = wc if wc is not None else file_wc
        ww_val = ww if ww is not None else file_ww

        if wc_val is not None and ww_val is not None and ww_val > 0:
            # Map the user-chosen [wc-ww/2, wc+ww/2] window to [0, 255] —
            # everything below the window clamps to black, above to white.
            # Pre-0.9.12 the array was clipped and then re-normalised using
            # the clipped array's own min/max, which made the slider almost
            # a no-op (clipped min/max ≡ window bounds, so the math always
            # stretched the same range to 0-255). Using the window bounds
            # directly fixes the "no visible change" + "all black/white"
            # symptoms reported on MR studies.
            img_min = wc_val - ww_val / 2
            img_max = wc_val + ww_val / 2
            pixel_array = np.clip(pixel_array, img_min, img_max)
            pixel_array = (pixel_array - img_min) / (img_max - img_min) * 255
        else:
            # No window info — fall back to a min-max stretch so blank-tag
            # files still render with reasonable contrast.
            if pixel_array.max() != pixel_array.min():
                pixel_array = (pixel_array - pixel_array.min()) / (pixel_array.max() - pixel_array.min()) * 255

        pixel_array = pixel_array.astype(np.uint8)
        if invert:
            # Invert intensity post-windowing — mirrors the standard DICOM
            # viewer "invert" toggle. Cheap on a uint8 array.
            pixel_array = 255 - pixel_array

        img = PILImage.fromarray(pixel_array)
        if upscale > 1:
            new_size = (img.width * upscale, img.height * upscale)
            img = img.resize(new_size, resample=PILImage.BICUBIC)
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


@router.get("/{study_id}/series/{series_id}/frame/{index}/metadata")
async def get_frame_metadata(
    study_id: int,
    series_id: int,
    index: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Return the DICOM tags of a single frame as a JSON dict.

    Used by the viewer's "Metadata" panel — gives the user the full DICOM
    header without leaving the page. Pixel data and other large binary
    blobs are filtered out so the payload stays small (typically a few
    hundred tags). Tags whose value can't be represented as plain JSON
    are coerced to ``str(value)``.
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

    try:
        import pydicom
    except ImportError:
        raise HTTPException(status_code=500, detail="pydicom not installed")

    try:
        ds = pydicom.dcmread(str(frames[index]), stop_before_pixels=True)
    except Exception:
        raise HTTPException(status_code=500, detail="Could not read DICOM header")

    # Skip tags that aren't useful in a UI — pixel data, very large
    # blobs, file-meta separators. Everything else is converted to its
    # string repr (DICOM PN, dates, sequences all stringify cleanly).
    SKIP_KEYWORDS = {"PixelData", "FloatPixelData", "DoubleFloatPixelData"}
    items: list[dict] = []
    for elem in ds:
        kw = elem.keyword or ""
        if kw in SKIP_KEYWORDS:
            continue
        # Sequences (SQ): summarise as item count rather than dumping the
        # nested dataset, which would inflate the payload.
        if elem.VR == "SQ":
            try:
                count = len(elem.value)  # type: ignore[arg-type]
            except Exception:
                count = 0
            value: str | int | float | None = f"<sequence: {count} item(s)>"
        else:
            try:
                raw = elem.value
                if isinstance(raw, (bytes, bytearray, memoryview)):
                    value = f"<{len(bytes(raw))} bytes>"
                elif isinstance(raw, (int, float, str)):
                    value = raw
                else:
                    value = str(raw)
            except Exception:
                value = None
        items.append({
            "tag": str(elem.tag),
            "keyword": kw or None,
            "vr": elem.VR,
            "name": elem.name,
            "value": value,
        })
    return {"items": items, "count": len(items)}


# ── Bundle files (DICOMDIR, JPEG previews, etc.) ───────────────────


def _bundle_root_for_study(folder_path: str) -> str | None:
    """Return the imaging-bundles directory path for a given study folder.

    Study folder layouts handled:
      - 0.9.5+ layout: ``patients/{slug}/{year}/{study_folder}`` →
                       ``patients/{slug}/imaging-bundles``
      - legacy 0.9.4: ``patients/{slug}/{year}/imaging/{study_folder}`` →
                       ``patients/{slug}/imaging-bundles``
      - unclassified: ``unclassified/{year}/{study_folder}`` (or with
                       intermediate ``imaging/`` for legacy) →
                       ``unclassified/imaging-bundles``

    Returns None if the path does not match any of the above shapes.
    """
    parts = folder_path.split("/")
    if not parts:
        return None
    # Legacy ``imaging`` segment: trim it off when present.
    if "imaging" in parts:
        idx = parts.index("imaging")
        return "/".join(parts[:idx] + ["imaging-bundles"])
    # New layout: drop the year + study segments.
    # patients/{slug}/{year}/{study} → patients/{slug}/imaging-bundles
    # unclassified/{year}/{study}    → unclassified/imaging-bundles
    if parts[0] == "patients" and len(parts) >= 4:
        return f"{parts[0]}/{parts[1]}/imaging-bundles"
    if parts[0] == "unclassified" and len(parts) >= 3:
        return "unclassified/imaging-bundles"
    return None


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
    """Documents linked to this imaging study.

    The first item is ALWAYS the parent radiology report — even though
    technically it isn't a row in ``document_links`` (the imaging study
    is a child of that document). Surfacing it as a synthetic link
    means clinicians see the report in the same place as any other
    related document. The synthetic entry is marked with
    ``link_type='report'`` and ``link_id=null`` so the frontend doesn't
    offer an "unlink" affordance for it (you can't unlink a parent).
    """
    study = await _study_with_access(study_id, current_user, db)
    document_id = study["document_id"]

    items: list[dict] = []

    # Synthetic "report" entry for the parent document. We render it
    # whether or not the report PDF is actually attached — when it's a
    # placeholder the frontend already shows an *Upload PDF* affordance
    # at the slot above; here it just gives clinicians a navigation
    # entry to the document detail.
    if document_id:
        cursor = await db.execute(
            "SELECT id, original_filename, doc_type, event_date "
            "FROM documents WHERE id = ?",
            (document_id,),
        )
        report_row = await cursor.fetchone()
        if report_row:
            items.append({
                "link_id": None,
                "link_type": "report",
                "id": report_row["id"],
                "original_filename": report_row["original_filename"],
                "doc_type": report_row["doc_type"],
                "event_date": report_row["event_date"],
            })

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
        (document_id, document_id),
    )
    rows = await cursor.fetchall()
    items.extend(dict(r) for r in rows)
    return {"items": items}


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


class ImagingMetadataPatch(BaseModel):
    modality: str | None = None
    body_part: str | None = None
    study_description: str | None = None
    accession_number: str | None = None


_IMAGING_PATCH_FIELDS = {"modality", "body_part", "study_description", "accession_number"}


@router.patch("/{study_id}/metadata")
async def update_imaging_metadata(
    study_id: int,
    body: ImagingMetadataPatch,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Update imaging-specific metadata (modality, body part, accession,
    study description). Doctor / facility / event_date / patient are
    edited on the parent ``documents`` row via PATCH /api/documents/{id};
    those fields are NOT accepted here so the two endpoints can't drift.

    Every accepted field is recorded in ``extraction_corrections`` so the
    same correction-driven learning that documents use applies to
    imaging too — when the user fixes ``modality`` on one study the LLM
    sees the correction as a few-shot example for similar future studies.
    """
    study = await _study_with_access(study_id, current_user, db)
    document_id = study["document_id"]

    # Patient access ⇒ write access for now (mirror /api/documents PATCH).
    cursor = await db.execute(
        "SELECT modality, body_part, study_description, accession_number "
        "FROM imaging_studies WHERE id = ?",
        (study_id,),
    )
    before_row = await cursor.fetchone()
    before = dict(before_row) if before_row else {}

    updates: dict = body.model_dump(exclude_none=False)
    set_parts: list[str] = []
    params: list = []
    corrections: list[tuple[str, str | None, str | None]] = []
    for field, new_val in updates.items():
        if field not in _IMAGING_PATCH_FIELDS:
            continue
        # ``None`` clears the field; same convention as /documents PATCH.
        if new_val is None and field not in body.model_fields_set:
            continue
        old_val = before.get(field) if before else None
        if (old_val or None) == (new_val or None):
            continue
        set_parts.append(f"{field} = ?")
        params.append(new_val)
        corrections.append((field, old_val, new_val))

    if not set_parts:
        return {"status": "noop", "id": study_id}

    params.append(study_id)
    await db.execute(
        f"UPDATE imaging_studies SET {', '.join(set_parts)} WHERE id = ?",
        params,
    )

    # Self-learning: record the corrections against the parent document
    # so the existing few-shot pipeline picks them up.
    if document_id:
        for field, old_val, new_val in corrections:
            await db.execute(
                """INSERT INTO extraction_corrections
                   (document_id, field_name, llm_value, corrected_value, doc_type)
                   VALUES (?, ?, ?, ?, 'imaging_report')""",
                (document_id, f"imaging.{field}", old_val, new_val),
            )

    await db.commit()
    return {"status": "updated", "id": study_id, "fields": [c[0] for c in corrections]}


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


# ── Report attachment ─────────────────────────────────────────────


class AttachExistingReportRequest(BaseModel):
    document_id: int


@router.post("/{study_id}/report")
async def attach_imaging_report(
    study_id: int,
    request: Request,
    document_id: int | None = Query(default=None),
    file: UploadFile | None = File(default=None),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Attach a radiology report PDF to an imaging study.

    Two flows:
      - **Link existing**: pass ``?document_id=<id>`` (or JSON body
        ``{"document_id": <id>}``) — the study's parent document is
        repointed at that PDF; the placeholder is deleted.
      - **Upload new**: post a multipart ``file=<pdf>``. The PDF lands
        in the inbox like any other upload and is processed by the
        standard pipeline; on completion the placeholder is replaced
        by the new document.

    PDF-only is enforced for uploads. The caller must have write access
    to the study's patient.
    """
    from asclepius.documents.upload_routes import _detect_mime, _CHUNK
    from asclepius.util.paths import safe_filename, safe_vault_join, UnsafePathError
    from asclepius.config import get_config

    study = await _study_with_access(study_id, current_user, db)
    placeholder_doc_id = study["document_id"]

    # JSON body fallback for the link-existing flow.
    if document_id is None and file is None:
        try:
            body = await request.json()
            if isinstance(body, dict) and "document_id" in body:
                document_id = int(body["document_id"])
        except Exception:
            pass

    if document_id is None and file is None:
        raise HTTPException(status_code=400, detail="Provide either document_id or file")

    if document_id is not None:
        # Link existing — verify the target is a real PDF document the
        # caller has access to, then repoint imaging_studies.document_id.
        cursor = await db.execute(
            "SELECT id, patient_id, file_path, doc_type FROM documents WHERE id = ?",
            (document_id,),
        )
        target = await cursor.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Target document not found")
        if target["patient_id"]:
            role = await check_patient_access(db, current_user["id"], target["patient_id"])
            if not role:
                raise HTTPException(status_code=403, detail="No access to target document")
        # PDF-only on the report side. We accept by extension OR by
        # libmagic when the file actually exists in the vault.
        target_path = (target["file_path"] or "").lower()
        if not target_path.endswith(".pdf"):
            raise HTTPException(status_code=415, detail="Report document must be a PDF")
        # Repoint + remove the placeholder. We do the placeholder delete
        # AFTER the FK has been moved off it, otherwise the cascade would
        # take imaging_studies with it.
        await db.execute(
            "UPDATE imaging_studies SET document_id = ?, report_status = 'attached' WHERE id = ?",
            (document_id, study_id),
        )
        if placeholder_doc_id and placeholder_doc_id != document_id:
            cursor = await db.execute(
                "SELECT file_path, doc_type FROM documents WHERE id = ?",
                (placeholder_doc_id,),
            )
            old = await cursor.fetchone()
            # Only drop the OLD row if it really was a placeholder
            # (empty file_path and doc_type imaging_report). Refusing
            # silently for non-placeholders prevents accidental data loss.
            if old and not (old["file_path"] or "") and old["doc_type"] == "imaging_report":
                await db.execute("DELETE FROM documents WHERE id = ?", (placeholder_doc_id,))
        await db.commit()
        return {"status": "attached", "document_id": document_id}

    # Upload new — stream the PDF into the patient's inbox folder.
    config = get_config()
    user_id = int(current_user["id"])
    vault_root = Path(config.vault.root_path)
    patient_id = study["patient_id"]
    if patient_id:
        cursor = await db.execute("SELECT slug FROM patients WHERE id = ?", (patient_id,))
        prow = await cursor.fetchone()
        slug = prow[0] if prow else None
    else:
        slug = None
    inbox_subfolder = (slug and safe_filename(slug)) or f"user-{user_id}"
    try:
        inbox = safe_vault_join(vault_root, f"inbox/{inbox_subfolder}")
    except UnsafePathError:
        raise HTTPException(status_code=500, detail="Misconfigured vault")
    inbox.mkdir(parents=True, exist_ok=True)

    safe_name = safe_filename(file.filename or "report.pdf")
    if not safe_name.lower().endswith(".pdf"):
        safe_name = safe_name + ".pdf"
    try:
        dest = safe_vault_join(inbox, safe_name)
    except UnsafePathError as exc:
        raise HTTPException(status_code=400, detail=f"Unsafe filename: {exc}")
    counter = 1
    while dest.exists():
        stem = Path(safe_name).stem
        suffix = Path(safe_name).suffix
        dest = inbox / f"{stem}_{counter}{suffix}"
        counter += 1

    max_bytes = config.server.max_upload_bytes
    written = 0
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(status_code=413, detail="Upload exceeds size cap")
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    mime = _detect_mime(dest)
    if not mime.startswith("application/pdf"):
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=415, detail=f"Report must be PDF (got {mime or 'unknown'})")

    # Sidecar so the pipeline associates the PDF with this imaging
    # study after processing. The watcher reads .imaging_study_hint
    # alongside the existing patient/event/user hints.
    if patient_id:
        (dest.parent / f"{dest.name}.patient_hint").write_text(str(patient_id))
    (dest.parent / f"{dest.name}.user_hint").write_text(str(user_id))
    (dest.parent / f"{dest.name}.imaging_study_hint").write_text(str(study_id))

    return {
        "status": "queued",
        "filename": dest.name,
        "study_id": study_id,
        "message": "Report PDF queued for processing; it will be attached to this study automatically.",
    }
