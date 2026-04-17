"""Document file serving, rotation, and renaming routes."""

import logging
import re
import shutil
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.documents.service import get_document
from asclepius.patients.service import check_patient_access

logger = logging.getLogger(__name__)

router = APIRouter()


class RenameRequest(BaseModel):
    filename: str


class RotateRequest(BaseModel):
    degrees: int = 90  # 90, 180, 270
    pages: list[int] | None = None  # None = all pages, or list of 1-based page numbers


@router.get("/{doc_id}/file")
async def serve_file(
    doc_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc["patient_id"]:
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
        if not role:
            raise HTTPException(status_code=403, detail="No access")

    config = get_config()
    vault_root = Path(config.vault.root_path)
    file_path = vault_root / doc["file_path"]

    # Primary path check
    if not file_path.exists():
        # Try absolute path (file_path might already be absolute)
        abs_path = Path(doc["file_path"])
        if abs_path.is_absolute() and abs_path.exists():
            file_path = abs_path
        else:
            # Fallback: look in inbox with original_filename
            inbox_path = Path(config.vault.inbox_path) / doc["original_filename"]
            if inbox_path.exists():
                file_path = inbox_path
            else:
                # Last resort: search vault root for the original filename
                for candidate in vault_root.rglob(doc["original_filename"]):
                    file_path = candidate
                    break
                else:
                    raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        filename=doc["original_filename"],
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

    config = get_config()
    cursor = await db.execute(
        "SELECT file_path, patient_id FROM documents WHERE id = ?", (doc_id,)
    )
    doc = await cursor.fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(config.vault.root_path) / doc[0]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    if file_path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Rotation is only supported for PDF files")

    import fitz
    try:
        pdf = fitz.open(str(file_path))
        total_pages = len(pdf)

        if body.pages:
            # Validate page numbers
            for p in body.pages:
                if p < 1 or p > total_pages:
                    pdf.close()
                    raise HTTPException(
                        status_code=400,
                        detail=f"Page {p} is out of range (document has {total_pages} pages)"
                    )
            target_pages = [p - 1 for p in body.pages]  # Convert to 0-based
        else:
            target_pages = list(range(total_pages))

        for page_idx in target_pages:
            page = pdf[page_idx]
            page.set_rotation((page.rotation + body.degrees) % 360)

        # Full rewrite (not incremental) to ensure rotation is properly persisted
        # Save to temp file then replace, to avoid corruption on failure
        import tempfile, shutil
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf", dir=str(file_path.parent))
        try:
            import os
            os.close(tmp_fd)
            pdf.save(tmp_path, garbage=3, deflate=True)
            pdf.close()
            shutil.move(tmp_path, str(file_path))
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
    """Rename a document's file on disk and in the database."""
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    new_name = body.filename.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    # Ensure the extension is preserved
    old_ext = Path(doc["original_filename"]).suffix.lower()
    new_ext = Path(new_name).suffix.lower()
    if not new_ext:
        new_name += old_ext
    elif new_ext != old_ext:
        raise HTTPException(status_code=400, detail=f"Cannot change file extension from {old_ext} to {new_ext}")

    # Sanitize filename
    stem = Path(new_name).stem
    ext = Path(new_name).suffix
    stem = re.sub(r'[^\w\-. ]', '-', stem)
    stem = re.sub(r'-+', '-', stem).strip('-')
    new_name = f"{stem}{ext}"

    # Rename file on disk if it exists
    config = get_config()
    vault_root = Path(config.vault.root_path)
    old_path = vault_root / doc["file_path"]

    if old_path.exists():
        new_path = old_path.parent / new_name
        # Auto-disambiguate on collision so bulk "regenerate filename" on related
        # documents (same doctor/type/date → same AI slug) doesn't fail for every
        # duplicate. Only kicks in when the target already exists and isn't us.
        if new_path.exists() and new_path != old_path:
            stem = Path(new_name).stem
            ext_ = Path(new_name).suffix
            n = 2
            while True:
                candidate = old_path.parent / f"{stem}-{n}{ext_}"
                if not candidate.exists():
                    new_path = candidate
                    new_name = candidate.name
                    break
                n += 1
                if n > 999:
                    raise HTTPException(status_code=409, detail="Could not find a free filename")
        old_path.rename(new_path)
        new_file_path = str(new_path.relative_to(vault_root))
    else:
        new_file_path = doc["file_path"]

    await db.execute(
        "UPDATE documents SET original_filename = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_name, new_file_path, doc_id),
    )
    await db.commit()
    return await get_document(db, doc_id)
