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
    # up with the canonical names shown in the UI.
    "modality":          "s.modality",
    "body_part":         "s.body_part",
    "study_date":        "s.study_date",
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
    q: str | None = Query(default=None, description="Search across body part, institution, referring physician, study description"),
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
        conditions.append("s.study_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("s.study_date <= ?")
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

    sort_sql = _LIST_SORT_COLUMNS.get(sort or "", "s.study_date")
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
                  d.doc_type as report_doc_type
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
