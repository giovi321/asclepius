"""Document file serving, rotation, and renaming routes.

All filesystem access here goes through :mod:`asclepius.util.paths` so that
user-controlled pieces (``doc.file_path``, ``doc.original_filename``, the
rename target) can never escape the configured vault root.
"""

import logging
import os
import tempfile
from pathlib import Path

import aiosqlite
import fitz
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import get_document
from asclepius.patients.service import check_patient_access
from asclepius.util.paths import UnsafePathError, safe_filename, safe_vault_join

logger = logging.getLogger(__name__)

router = APIRouter()


async def _require_write_access(
    db: aiosqlite.Connection,
    current_user: dict,
    doc: dict,
) -> None:
    """Raise 403 unless the caller may mutate this document.

    Allowed:
    - admins
    - the original uploader
    - users with ``owner``/``editor`` role on the document's patient
    """
    if current_user.get("role") == "admin":
        return
    if doc.get("uploaded_by_user_id") == current_user["id"]:
        return
    if doc.get("patient_id"):
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
        if role in ("owner", "editor"):
            return
    raise HTTPException(status_code=403, detail="Insufficient permissions")


def _resolve_vault_file(vault_root: Path, relative_path: str) -> Path:
    """Resolve ``relative_path`` under ``vault_root`` or raise 404/400.

    The DB column ``documents.file_path`` is always meant to be vault-
    relative. If something wrote an absolute path there, we refuse to serve
    it — better a broken link than an arbitrary-file-read primitive.
    """
    try:
        return safe_vault_join(vault_root, relative_path)
    except UnsafePathError as exc:
        logger.warning("Refusing to serve unsafe path %r: %s", relative_path, exc)
        raise HTTPException(status_code=400, detail="Invalid file path") from exc


class RenameRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


class RotateRequest(BaseModel):
    degrees: int = 90  # 90, 180, 270
    pages: list[int] | None = None  # None = all pages, or list of 1-based page numbers


@router.head("/{doc_id}/file")
async def head_file(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """HEAD probe used by the frontend to decide whether to render a file
    viewer at all. Returns the same status codes as the GET (404 when
    the file is missing on disk, 403 when the caller lacks access)."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if current_user.get("role") != "admin":
        allowed = False
        if doc["patient_id"]:
            role = await check_patient_access(db, current_user["id"], doc["patient_id"])
            allowed = bool(role)
        if not allowed and doc.get("uploaded_by_user_id") == current_user["id"]:
            allowed = True
        if not allowed:
            raise HTTPException(status_code=403, detail="No access")
    if not doc["file_path"]:
        raise HTTPException(status_code=404, detail="File not found on disk")
    config = get_config()
    vault_root = Path(config.vault.root_path)
    file_path = _resolve_vault_file(vault_root, doc["file_path"])
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return Response(status_code=200)


@router.get("/{doc_id}/file")
async def serve_file(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Stream the stored document file.

    Security invariants:
    - ``doc.file_path`` is resolved strictly under the configured vault root.
    - The outbound ``Content-Disposition`` filename is sanitised so a
      malicious filename cannot break out of the header.
    - Non-admins need either patient-level access or uploader identity.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if current_user.get("role") != "admin":
        allowed = False
        if doc["patient_id"]:
            role = await check_patient_access(db, current_user["id"], doc["patient_id"])
            allowed = bool(role)
        if not allowed and doc.get("uploaded_by_user_id") == current_user["id"]:
            allowed = True
        if not allowed:
            raise HTTPException(status_code=403, detail="No access")

    config = get_config()
    vault_root = Path(config.vault.root_path)
    file_path = _resolve_vault_file(vault_root, doc["file_path"])

    if not file_path.is_file():
        # Single controlled fallback: the inbox copy the pipeline may not
        # have moved yet. Still goes through ``safe_vault_join``.
        safe_name = safe_filename(doc["original_filename"])
        inbox_candidate = _resolve_vault_file(
            vault_root,
            f"inbox/{safe_name}",
        )
        if inbox_candidate.is_file():
            file_path = inbox_candidate
        else:
            raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        filename=safe_filename(doc["original_filename"]),
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@router.post("/{doc_id}/rotate")
async def rotate_document(
    doc_id: int,
    body: RotateRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Permanently rotate pages of a PDF document.

    - degrees: rotation angle (90, 180, 270)
    - pages: list of 1-based page numbers to rotate, or null/empty for all pages
    """
    if body.degrees not in (90, 180, 270):
        raise HTTPException(status_code=400, detail="Degrees must be 90, 180, or 270")

    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Rotation mutates the file — require editor/owner role on the patient
    # (or admin) to avoid a viewer being able to deface documents.
    await _require_write_access(db, current_user, doc)

    config = get_config()
    vault_root = Path(config.vault.root_path)
    file_path = _resolve_vault_file(vault_root, doc["file_path"])
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found on disk")

    if file_path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Rotation is only supported for PDF files")

    try:
        pdf = fitz.open(str(file_path))
        total_pages = len(pdf)

        if body.pages:
            for p in body.pages:
                if p < 1 or p > total_pages:
                    pdf.close()
                    raise HTTPException(
                        status_code=400,
                        detail=f"Page {p} is out of range (document has {total_pages} pages)",
                    )
            target_pages = [p - 1 for p in body.pages]
        else:
            target_pages = list(range(total_pages))

        for page_idx in target_pages:
            page = pdf[page_idx]
            page.set_rotation((page.rotation + body.degrees) % 360)

        # Full rewrite into a sibling temp file, then atomic replace. We
        # stay in the same directory so ``os.replace`` works across
        # filesystems (inside a single vault mount).
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf", dir=str(file_path.parent))
        try:
            os.close(tmp_fd)
            pdf.save(tmp_path, garbage=3, deflate=True)
            pdf.close()
            os.replace(tmp_path, str(file_path))
        except Exception:
            pdf.close()
            if Path(tmp_path).exists():
                Path(tmp_path).unlink()
            raise

        rotated_desc = f"pages {body.pages}" if body.pages else f"all {total_pages} pages"
        return {
            "status": "rotated",
            "document_id": doc_id,
            "degrees": body.degrees,
            "pages_rotated": len(target_pages),
            "total_pages": total_pages,
            "description": f"Rotated {rotated_desc} by {body.degrees} degrees",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rotate PDF: {str(e)}")


@router.post("/{doc_id}/rename")
async def rename_document(
    doc_id: int,
    body: RenameRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Rename a document's file on disk and in the database.

    The new filename is sanitised (no path separators, no ``..``, reserved
    names rejected) and the target path is verified to stay under the vault
    root. The file extension is locked to the original to prevent tricks
    like renaming ``scan.pdf`` into ``scan.html``.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    await _require_write_access(db, current_user, doc)

    raw_new = body.filename.strip()
    if not raw_new:
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    # Lock the extension to the original — prevents content-type confusion.
    # Exception: when the original has *no* extension at all (e.g. imaging
    # placeholders named "MR Brain (report pending)"), allow the user to
    # add one. There's nothing to confuse here — extension-less names are
    # display labels, not on-disk filenames the server serves.
    old_ext = Path(doc["original_filename"]).suffix.lower()
    new_ext = Path(raw_new).suffix.lower()
    if not new_ext:
        raw_new += old_ext
    elif old_ext and new_ext != old_ext:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot change file extension from {old_ext} to {new_ext}",
        )

    new_name = safe_filename(raw_new)
    if not new_name:
        raise HTTPException(status_code=400, detail="Invalid filename")

    config = get_config()
    vault_root = Path(config.vault.root_path)
    old_path = _resolve_vault_file(vault_root, doc["file_path"])

    if old_path.is_file():
        target = _resolve_vault_file(
            vault_root,
            str(Path(doc["file_path"]).parent / new_name),
        )
        # Disambiguate on collision: "foo.pdf" → "foo-2.pdf", "foo-3.pdf"…
        if target.exists() and target != old_path:
            stem = Path(new_name).stem
            ext_ = Path(new_name).suffix
            for n in range(2, 1000):
                candidate = target.parent / f"{stem}-{n}{ext_}"
                if not candidate.exists():
                    target = candidate
                    new_name = candidate.name
                    break
            else:
                raise HTTPException(status_code=409, detail="Could not find a free filename")
        old_path.rename(target)
        new_file_path = str(target.relative_to(vault_root.resolve()))
    else:
        new_file_path = doc["file_path"]

    await db.execute(
        "UPDATE documents SET original_filename = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_name, new_file_path, doc_id),
    )
    await db.commit()
    return await get_document(db, doc_id)


# ── Broken-file recovery ───────────────────────────────────────────


def _scan_vault_for_filename(vault_root: Path, filename: str, limit: int = 25) -> list[str]:
    """Walk the vault for files whose name matches ``filename`` and return
    vault-relative POSIX paths. Stops after ``limit`` matches.

    Match is case-insensitive and matches the basename only — exactly what
    a user would compare visually if they were hunting for a misplaced
    file. Inbox folders are skipped (those are pipeline staging, not
    final vault content).
    """
    target = filename.lower()
    matches: list[str] = []
    if not vault_root.exists():
        return matches
    skip_top = {"inbox", ".staging", "_staging"}
    for top in vault_root.iterdir():
        if not top.is_dir() or top.name in skip_top:
            continue
        for p in top.rglob("*"):
            if not p.is_file():
                continue
            if p.name.lower() == target:
                try:
                    matches.append(str(p.relative_to(vault_root)).replace("\\", "/"))
                except ValueError:
                    continue
                if len(matches) >= limit:
                    return matches
    return matches


@router.get("/{doc_id}/find-candidates")
async def find_candidate_files(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Look for files in the vault whose basename matches this document's
    ``original_filename``. Used by the document detail page to recover
    from a broken ``file_path`` (the file was moved or renamed outside
    the app). Returns vault-relative POSIX paths so the frontend can
    pass them straight back to ``POST /relink``.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if current_user.get("role") != "admin":
        allowed = False
        if doc["patient_id"]:
            role = await check_patient_access(db, current_user["id"], doc["patient_id"])
            allowed = bool(role)
        if not allowed and doc.get("uploaded_by_user_id") == current_user["id"]:
            allowed = True
        if not allowed:
            raise HTTPException(status_code=403, detail="No access")

    config = get_config()
    vault_root = Path(config.vault.root_path)
    raw_filename = doc.get("original_filename") or ""
    candidates = _scan_vault_for_filename(vault_root, raw_filename)
    # Drop the path the document already points at — it's broken by
    # definition; we want alternatives.
    current = (doc.get("file_path") or "").replace("\\", "/")
    candidates = [c for c in candidates if c != current]
    return {"candidates": candidates, "filename": raw_filename}


class RelinkRequest(BaseModel):
    vault_path: str = Field(min_length=1)


@router.post("/{doc_id}/relink")
async def relink_document(
    doc_id: int,
    body: RelinkRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Repoint a document at an existing vault file. Use case: the
    file was moved outside the app and the user picked the right path
    from ``find-candidates`` or the file browser. The new file is NOT
    re-processed; only ``documents.file_path`` is updated.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    config = get_config()
    vault_root = Path(config.vault.root_path)
    rel = body.vault_path.replace("\\", "/").lstrip("/")
    target = _resolve_vault_file(vault_root, rel)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Target file not found")

    # Final path is recorded relative to the vault root.
    new_rel = str(target.relative_to(vault_root.resolve())).replace("\\", "/")
    new_size = target.stat().st_size

    await db.execute(
        "UPDATE documents SET file_path = ?, file_size = ?, "
        "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_rel, new_size, doc_id),
    )
    await db.commit()
    return await get_document(db, doc_id)


@router.post("/{doc_id}/replace-file")
async def replace_document_file(
    doc_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Upload a fresh copy of a missing file. The file lands in the
    correct organised location (``patients/{slug}/{year}/...`` based on
    the document's ``event_date``), the document's ``file_path`` is
    updated, and the file is NOT re-processed (the document already has
    its OCR text, extraction, and child rows). Patient access checked.

    The file extension is locked to the document's ``original_filename``
    to prevent content-type confusion.
    """
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _require_write_access(db, current_user, doc)

    # Lock the extension to the original filename's extension.
    old_ext = Path(doc["original_filename"]).suffix.lower()
    incoming = (file.filename or "").lower()
    if old_ext and not incoming.endswith(old_ext):
        raise HTTPException(
            status_code=400,
            detail=f"Replacement file must have the same extension ({old_ext})",
        )

    # Compute the destination folder. Prefer the existing file_path's
    # parent (so the replacement lands next to where the doc thinks it
    # is); otherwise build a fresh organised path from the document's
    # patient slug + year-from-event-date.
    config = get_config()
    vault_root = Path(config.vault.root_path)
    existing = (doc.get("file_path") or "").replace("\\", "/")
    if existing:
        dest_dir_rel = "/".join(existing.split("/")[:-1])
    else:
        # Fall back to patients/{slug}/{year} (or unclassified).
        cursor = await db.execute(
            "SELECT slug FROM patients WHERE id = ?",
            (doc.get("patient_id"),),
        )
        row = await cursor.fetchone()
        slug = row[0] if row else None
        year = "unknown"
        ev = doc.get("event_date") or doc.get("issued_date") or doc.get("date_received")
        if ev and len(str(ev)) >= 4:
            year = str(ev)[:4]
        if slug:
            dest_dir_rel = f"patients/{slug}/{year}"
        else:
            dest_dir_rel = "unclassified"

    safe_name = safe_filename(doc["original_filename"])
    try:
        dest = safe_vault_join(vault_root, dest_dir_rel, safe_name)
    except UnsafePathError as exc:
        raise HTTPException(status_code=400, detail=f"Unsafe destination: {exc}")

    # Disambiguate on collision so we don't clobber a file the user
    # intended to keep.
    counter = 2
    base = dest
    while dest.exists():
        stem = base.stem
        suffix = base.suffix
        dest = base.parent / f"{stem}-{counter}{suffix}"
        counter += 1
        if counter > 1000:
            raise HTTPException(status_code=409, detail="Could not allocate filename")

    dest.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    max_bytes = config.server.max_upload_bytes
    chunk = 1024 * 1024
    try:
        with open(dest, "wb") as out:
            while True:
                buf = await file.read(chunk)
                if not buf:
                    break
                written += len(buf)
                if written > max_bytes:
                    raise HTTPException(status_code=413, detail="Upload exceeds size cap")
                out.write(buf)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise

    new_rel = str(dest.relative_to(vault_root.resolve())).replace("\\", "/")
    await db.execute(
        "UPDATE documents SET file_path = ?, file_size = ?, "
        "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_rel, written, doc_id),
    )
    await db.commit()
    return await get_document(db, doc_id)
