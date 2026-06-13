"""Characterization tests for the backup endpoints (admin behavior/shape).

Pins the CURRENT response shapes of:
    * GET  /api/settings/backup        -> SQLite file download (200 + content-type)
    * GET  /api/settings/backup/files  -> {"files": [...], "directory": str}
    * POST /api/settings/backup/run    -> {"ok": True, "file": str, "kind": str}
                                          and the file lands on disk

Auth / role gating is already covered by test_settings_authz.py — these focus
on behavior and response shape for the admin ``client``.

The default config points ``backup.directory`` at ``/vault/backups`` (not
writable in CI), so the round-trip tests redirect it to a tmp dir via the
shared (lru-cached) config object that the app fixture already populated.
"""

from __future__ import annotations

import pytest

from asclepius.config import get_config


@pytest.mark.asyncio
async def test_download_backup_returns_sqlite(client):
    resp = await client.get("/api/settings/backup")
    assert resp.status_code == 200
    # Content type is the sqlite media type set by the FileResponse.
    assert resp.headers["content-type"] == "application/x-sqlite3"
    # Filename is exposed via content-disposition and follows the prefix.
    cd = resp.headers.get("content-disposition", "")
    assert "asclepius_backup_" in cd
    assert cd.endswith('.sqlite"') or ".sqlite" in cd
    # The body is a real SQLite file: starts with the SQLite magic header.
    assert resp.content[:16].startswith(b"SQLite format 3")


@pytest.mark.asyncio
async def test_list_scheduled_backups_shape_empty(client, tmp_path):
    # Redirect to a fresh, empty (nonexistent) backup dir.
    backup_dir = tmp_path / "backups-empty"
    get_config().backup.directory = str(backup_dir)

    resp = await client.get("/api/settings/backup/files")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"files", "directory"}
    assert body["directory"] == str(backup_dir)
    # Nonexistent directory -> empty file list (does not 500).
    assert body["files"] == []


@pytest.mark.asyncio
async def test_run_backup_writes_db_snapshot_and_lists_it(client, tmp_path):
    backup_dir = tmp_path / "backups-run"
    cfg = get_config()
    cfg.backup.directory = str(backup_dir)
    # Default scope is database-only (include_database=True, include_vault=False)
    # which compute_kind maps to "db".
    cfg.backup.include_database = True
    cfg.backup.include_vault = False

    resp = await client.post("/api/settings/backup/run")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body.keys()) == {"ok", "file", "kind"}
    assert body["ok"] is True
    assert body["kind"] == "db"
    assert body["file"].startswith("asclepius_db_")
    assert body["file"].endswith(".sqlite")

    # The file is physically on disk in the configured directory.
    written = backup_dir / body["file"]
    assert written.is_file()
    assert written.read_bytes()[:16].startswith(b"SQLite format 3")

    # And it shows up in the listing with the expected per-file shape.
    listing = (await client.get("/api/settings/backup/files")).json()
    assert listing["directory"] == str(backup_dir)
    assert len(listing["files"]) == 1
    entry = listing["files"][0]
    assert set(entry.keys()) == {"name", "size", "created_at", "type"}
    assert entry["name"] == body["file"]
    assert entry["type"] == "db"
    assert isinstance(entry["size"], int) and entry["size"] > 0


@pytest.mark.asyncio
async def test_run_backup_rejects_when_no_scope_selected(client, tmp_path):
    cfg = get_config()
    cfg.backup.directory = str(tmp_path / "backups-none")
    cfg.backup.include_database = False
    cfg.backup.include_vault = False

    resp = await client.post("/api/settings/backup/run")
    assert resp.status_code == 400
    assert "at least one of: database, vault" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_get_settings_backup_block_shape(client, tmp_path):
    """The top-level GET /api/settings exposes a flat ``backup`` state block."""
    backup_dir = tmp_path / "backups-state"
    get_config().backup.directory = str(backup_dir)

    backup = (await client.get("/api/settings")).json()["backup"]
    assert set(backup.keys()) == {
        "directory",
        "enabled",
        "include_database",
        "include_vault",
        "schedule",
        "retention_mode",
        "retention_value",
        "last_backup_at",
    }
    assert backup["directory"] == str(backup_dir)
    assert isinstance(backup["enabled"], bool)
    # No backups written yet in this fresh dir -> last_backup_at is None.
    assert backup["last_backup_at"] is None
