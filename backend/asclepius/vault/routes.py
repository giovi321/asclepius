"""Vault file browser API routes."""

from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db

router = APIRouter()


def _build_tree(root: Path, base: Path, db_filename: str) -> list[dict]:
    """Recursively build a directory tree structure."""
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

        if item.is_dir():
            children = _build_tree(item, base, db_filename)
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


@router.get("/tree")
async def get_vault_tree(
    path: str | None = Query(default=None, description="Subtree path relative to vault root"),
    current_user: dict = Depends(get_current_user),
):
    """Get the vault directory structure as a browsable tree."""
    config = get_config()
    vault_root = Path(config.vault.root_path)

    if not vault_root.exists():
        raise HTTPException(status_code=404, detail="Vault directory not found")

    # Determine the database filename to skip it
    db_path = Path(config.database.path)
    db_filename = db_path.name

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
        children = _build_tree(target, vault_root, db_filename)
        relative = str(target.relative_to(vault_root)).replace("\\", "/")
        return {
            "name": target.name,
            "type": "dir",
            "path": relative,
            "size": 0,
            "children": children,
        }

    children = _build_tree(vault_root, vault_root, db_filename)
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
