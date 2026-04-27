"""Vault file browser API routes."""

import logging
import shutil
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db

logger = logging.getLogger(__name__)
router = APIRouter()


def _build_tree(
    root: Path,
    base: Path,
    db_filename: str,
    path_filter=None,
) -> list[dict]:
    """Recursively build a directory tree.

    `path_filter`, if given, is called with the *relative* POSIX path (e.g.
    "patients/mario-rossi") of each candidate entry and should return True to
    include it. Directories that filter False are omitted outright; files are
    checked too, but the root level is what does most of the work for us.
    """
    entries = []
    try:
        items = sorted(root.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        return entries

    for item in items:
        # Skip the SQLite database file and its WAL/SHM files
        if item.name == db_filename or item.name.endswith(("-wal", "-shm", "-journal")):
            continue
        # Skip hidden files
        if item.name.startswith("."):
            continue
        # Skip hint files used by the pipeline
        if item.name.endswith((".patient_hint", ".event_hint")):
            continue

        relative = str(item.relative_to(base)).replace("\\", "/")

        if path_filter is not None and not path_filter(relative, item.is_dir()):
            continue

        if item.is_dir():
            children = _build_tree(item, base, db_filename, path_filter)
            entries.append({
                "name": item.name,
                "type": "dir",
                "path": relative,
                "size": 0,
                "children": children,
            })
        else:
            try:
                size = item.stat().st_size
            except OSError:
                size = 0
            entries.append({
                "name": item.name,
                "type": "file",
                "path": relative,
                "size": size,
                "children": [],
            })

    return entries


async def _build_user_scope(db: aiosqlite.Connection, user: dict) -> dict:
    """Compute which vault subtrees the user may see.

    Returns {"admin": True} for admins (no filter); otherwise the set of
    patient slugs the user has access to + the user's own id (used to scope
    inbox / unclassified subfolders).
    """
    if user.get("role") == "admin":
        return {"admin": True}

    cursor = await db.execute(
        """SELECT p.slug FROM user_patient_access upa
           JOIN patients p ON p.id = upa.patient_id
           WHERE upa.user_id = ?""",
        (user["id"],),
    )
    patient_slugs = {row[0] for row in await cursor.fetchall() if row[0]}
    return {
        "admin": False,
        "patient_slugs": patient_slugs,
        "user_id": int(user["id"]),
    }


def _make_path_filter(scope: dict):
    """Build a path filter closure that enforces the per-user scope."""
    if scope.get("admin"):
        return None  # no filter — admins see everything

    patient_slugs: set[str] = scope["patient_slugs"]
    user_id: int = scope["user_id"]
    user_slug = f"user-{user_id}"

    def allow(rel_path: str, _is_dir: bool) -> bool:
        parts = rel_path.split("/") if rel_path else []
        if not parts:
            return True
        top = parts[0]
        # patients/<slug>/... — show only slugs the user has access to.
        if top == "patients":
            if len(parts) == 1:
                return True
            return parts[1] in patient_slugs
        # inbox/user-<id>/... — show only the user's own subfolder.
        if top == "inbox":
            if len(parts) == 1:
                return True
            return parts[1] == user_slug
        # Same rule for unclassified/.
        if top == "unclassified":
            if len(parts) == 1:
                return True
            return parts[1] == user_slug
        # Anything else at the root (legacy siblings, operator dumps, etc.)
        # is admin-only.
        return False

    return allow


@router.get("/tree")
async def get_vault_tree(
    path: str | None = Query(default=None, description="Subtree path relative to vault root"),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get the vault directory structure as a browsable tree."""
    config = get_config()
    vault_root = Path(config.vault.root_path)

    if not vault_root.exists():
        raise HTTPException(status_code=404, detail="Vault directory not found")

    # Determine the database filename to skip it
    db_path = Path(config.database.path)
    db_filename = db_path.name

    scope = await _build_user_scope(db, current_user)
    path_filter = _make_path_filter(scope)

    if path:
        target = vault_root / path
        # Security: ensure the path is within the vault
        try:
            target.resolve().relative_to(vault_root.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="Path is outside the vault")
        if not target.exists():
            raise HTTPException(status_code=404, detail="Path not found")
        if not target.is_dir():
            raise HTTPException(status_code=400, detail="Path is not a directory")
        # Non-admins may only descend into paths that the filter would have
        # allowed at the root level. Check the relative path against the filter.
        relative = str(target.relative_to(vault_root)).replace("\\", "/")
        if path_filter is not None and not path_filter(relative, True):
            raise HTTPException(status_code=403, detail="You don't have access to this path")
        children = _build_tree(target, vault_root, db_filename, path_filter)
        return {
            "name": target.name,
            "type": "dir",
            "path": relative,
            "size": 0,
            "children": children,
        }

    children = _build_tree(vault_root, vault_root, db_filename, path_filter)
    return {
        "name": vault_root.name,
        "type": "dir",
        "path": "",
        "size": 0,
        "children": children,
    }


@router.delete("/file")
async def delete_vault_file(
    path: str = Query(..., description="File path relative to vault root"),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a file from the vault and its matching document record."""
    config = get_config()
    vault_root = Path(config.vault.root_path)
    file_path = vault_root / path

    # Security: ensure the path is within the vault
    try:
        file_path.resolve().relative_to(vault_root.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path is outside the vault")

    # Ditto for access scope — non-admins can only touch their own subtree.
    scope = await _build_user_scope(db, current_user)
    path_filter = _make_path_filter(scope)
    normalized_for_check = path.replace("\\", "/").lstrip("/")
    if path_filter is not None and not path_filter(normalized_for_check, False):
        raise HTTPException(status_code=403, detail="You don't have access to this path")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if file_path.is_dir():
        raise HTTPException(status_code=400, detail="Cannot delete directories. Delete files individually.")

    # Normalize path for DB lookup (use forward slashes)
    normalized_path = path.replace("\\", "/")

    # Delete the file from disk
    file_path.unlink()

    # Delete matching document record from DB if one exists
    deleted_doc_id = None
    cursor = await db.execute(
        "SELECT id FROM documents WHERE file_path = ?",
        (normalized_path,),
    )
    row = await cursor.fetchone()
    if row:
        deleted_doc_id = row[0]
        await db.execute("DELETE FROM documents WHERE id = ?", (deleted_doc_id,))
        await db.commit()

    return {
        "status": "deleted",
        "path": normalized_path,
        "document_id": deleted_doc_id,
    }


class MoveRequest(BaseModel):
    from_path: str
    to_path: str


@router.post("/move")
async def move_vault_file(
    body: MoveRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Move a file (or imaging study folder) within the vault and keep the
    matching document record's ``file_path`` in sync.

    Use case: a file was misclassified by date / event and the user wants
    to drag it into the right folder without losing the document reference
    (so document-detail links, OCR cache, lab results etc. all keep
    working). The DB row is updated atomically with the disk move; if the
    destination already exists or the access check fails the move is
    rejected.
    """
    config = get_config()
    vault_root = Path(config.vault.root_path)

    src_rel = body.from_path.replace("\\", "/").lstrip("/")
    dst_rel = body.to_path.replace("\\", "/").lstrip("/")
    if not src_rel or not dst_rel:
        raise HTTPException(status_code=400, detail="Both from_path and to_path are required")
    if src_rel == dst_rel:
        return {"status": "noop", "path": dst_rel}

    src = vault_root / src_rel
    dst = vault_root / dst_rel

    # Security: both paths must stay inside the vault.
    try:
        src.resolve().relative_to(vault_root.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Source is outside the vault")
    # ``dst`` may not exist yet — resolve its parent instead.
    try:
        dst_parent = (dst.parent.resolve() if dst.parent.exists() else dst.parent)
        # If parent doesn't exist yet, walk up until we find one that does
        # so the relative-to check is meaningful.
        check_target = dst_parent
        while not check_target.exists() and check_target != check_target.parent:
            check_target = check_target.parent
        check_target.resolve().relative_to(vault_root.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Destination is outside the vault")

    # Access control — both endpoints must be inside the user's scope.
    scope = await _build_user_scope(db, current_user)
    path_filter = _make_path_filter(scope)
    if path_filter is not None:
        is_dir = src.is_dir()
        if not path_filter(src_rel, is_dir) or not path_filter(dst_rel, is_dir):
            raise HTTPException(status_code=403, detail="You don't have access to one of these paths")

    if not src.exists():
        raise HTTPException(status_code=404, detail="Source not found")
    if dst.exists():
        raise HTTPException(status_code=409, detail="Destination already exists")

    # Forbid moves that would land inside the source directory itself
    # (would create an infinite loop / shutil.move quirk).
    try:
        dst.resolve().relative_to(src.resolve())
        raise HTTPException(status_code=400, detail="Cannot move a directory into itself")
    except ValueError:
        pass

    # Perform the move + update DB rows whose file_path is anchored at
    # the source. We update both an exact match (a regular file or a
    # study folder) and any ``file_path LIKE 'src/%'`` rows (per-frame
    # documents pre-collapse, lab subfiles, etc.).
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.move(str(src), str(dst))
    except Exception as exc:
        logger.exception("Vault move failed: %s -> %s", src, dst)
        raise HTTPException(status_code=500, detail=f"Move failed: {exc}")

    affected_doc_ids: list[int] = []
    cursor = await db.execute(
        "SELECT id FROM documents WHERE file_path = ? OR file_path LIKE ?",
        (src_rel, src_rel + "/%"),
    )
    affected_doc_ids = [r[0] for r in await cursor.fetchall()]

    await db.execute(
        "UPDATE documents SET file_path = ?, updated_at = CURRENT_TIMESTAMP "
        "WHERE file_path = ?",
        (dst_rel, src_rel),
    )
    await db.execute(
        "UPDATE documents SET file_path = ? || SUBSTR(file_path, ?), "
        "updated_at = CURRENT_TIMESTAMP "
        "WHERE file_path LIKE ?",
        (dst_rel, len(src_rel) + 1, src_rel + "/%"),
    )
    # Imaging study + series folder paths follow the same prefix update.
    await db.execute(
        "UPDATE imaging_studies SET folder_path = ? WHERE folder_path = ?",
        (dst_rel, src_rel),
    )
    await db.execute(
        "UPDATE imaging_studies SET folder_path = ? || SUBSTR(folder_path, ?) "
        "WHERE folder_path LIKE ?",
        (dst_rel, len(src_rel) + 1, src_rel + "/%"),
    )
    await db.execute(
        "UPDATE imaging_series SET folder_path = ? || SUBSTR(folder_path, ?) "
        "WHERE folder_path = ? OR folder_path LIKE ?",
        (dst_rel, len(src_rel) + 1, src_rel, src_rel + "/%"),
    )

    await db.commit()
    return {
        "status": "moved",
        "from": src_rel,
        "to": dst_rel,
        "affected_documents": affected_doc_ids,
    }
