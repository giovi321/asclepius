"""Vault file browser API routes."""

from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db

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
