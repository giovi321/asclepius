"""Document file serving, rotation, and renaming routes.

All filesystem access here goes through :mod:`asclepius.util.paths` so that
user-controlled pieces (``doc.file_path``, ``doc.original_filename``, the
rename target) can never escape the configured vault root.
"""

import logging
import os
import shutil
import tempfile
from pathlib import Path

import aiosqlite
import fitz
from fastapi import APIRouter, Depends, HTTPException
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
    db: aiosqlite.Connection, current_user: dict, doc: dict,
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
            vault_root, f"inbox/{safe_name}",
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
                        detail=f"Page {p} is out of range (document has {total_pages} pages)"
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

        rotated_desc = (
            f"pages {body.pages}" if body.pages
            else f"all {total_pages} pages"
        )
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
    old_ext = Path(doc["original_filename"]).suffix.lower()
    new_ext = Path(raw_new).suffix.lower()
    if not new_ext:
        raw_new += old_ext
    elif new_ext != old_ext:
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
