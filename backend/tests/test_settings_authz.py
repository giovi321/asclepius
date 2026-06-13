"""Regression tests for settings authorization (Phase 0 security fix).

Three sensitive settings surfaces were gated by ``get_current_user`` instead
of ``require_role("admin")``, so any authenticated viewer could:

  * download a full SQLite backup of the database (all PHI, OTPs, password
    hashes) via GET /api/settings/backup and the scheduled-backup endpoints;
  * tamper with the extraction prompts via PUT/DELETE /api/settings/prompts/*;
  * read application logs (which can contain PHI-adjacent content).

These tests assert viewers get 403 and admins keep access.
"""

import pytest


@pytest.mark.asyncio
async def test_viewer_cannot_download_backup(client, make_user_client):
    viewer, _ = await make_user_client("v-backup", role="viewer")
    assert (await viewer.get("/api/settings/backup")).status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_list_scheduled_backups(client, make_user_client):
    viewer, _ = await make_user_client("v-backup-list", role="viewer")
    assert (await viewer.get("/api/settings/backup/files")).status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_download_scheduled_backup(client, make_user_client):
    viewer, _ = await make_user_client("v-backup-file", role="viewer")
    assert (await viewer.get("/api/settings/backup/files/anything.sqlite")).status_code == 403


@pytest.mark.asyncio
async def test_editor_cannot_download_backup(client, make_user_client):
    # Even a global "editor" (not admin) must be denied.
    editor, _ = await make_user_client("e-backup", role="editor")
    assert (await editor.get("/api/settings/backup")).status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_update_prompt(client, make_user_client):
    viewer, _ = await make_user_client("v-prompt", role="viewer")
    resp = await viewer.put("/api/settings/prompts/classification", json={"text": "pwned"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_reset_prompt(client, make_user_client):
    viewer, _ = await make_user_client("v-prompt-del", role="viewer")
    assert (await viewer.delete("/api/settings/prompts/classification")).status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_read_logs(client, make_user_client):
    viewer, _ = await make_user_client("v-logs", role="viewer")
    assert (await viewer.get("/api/settings/logs")).status_code == 403


@pytest.mark.asyncio
async def test_admin_can_download_backup(client):
    resp = await client.get("/api/settings/backup")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_admin_can_list_scheduled_backups(client):
    resp = await client.get("/api/settings/backup/files")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_admin_can_read_logs(client):
    assert (await client.get("/api/settings/logs")).status_code == 200


@pytest.mark.asyncio
async def test_admin_can_manage_prompts(client):
    from asclepius.llm.prompt_manager import PROMPT_REGISTRY

    assert (await client.get("/api/settings/prompts")).status_code == 200
    key = next(iter(PROMPT_REGISTRY))
    assert (await client.put(f"/api/settings/prompts/{key}", json={"text": "x"})).status_code == 200
    assert (await client.delete(f"/api/settings/prompts/{key}")).status_code == 200
