"""Regression tests for normalization authorization (Phase 0 review).

A follow-up review found that the normalization endpoints:
  * leaked cross-tenant document filenames + patient names via
    GET /{norm_type}/{norm_id}/documents (a norm entry is shared across all
    patients, but the listing was unscoped), and
  * let any authenticated viewer mutate shared clinical vocabulary
    (rename / merge / delete / add-alias) — gated only by get_current_user.
"""

import pytest
import aiosqlite


async def _seed_doc_with_lab(db_path, slug, name, norm_lab_test_id=1):
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)", (slug, name)
        )
        pid = cur.lastrowid
        cur = await db.execute(
            "INSERT INTO documents (patient_id, file_path, original_filename, status) "
            "VALUES (?, ?, ?, 'done')",
            (pid, f"{slug}/f.pdf", f"{slug}-report.pdf"),
        )
        did = cur.lastrowid
        await db.execute(
            "INSERT INTO lab_results (document_id, patient_id, test_name_original, value, "
            "norm_lab_test_id) VALUES (?, ?, 'Hb', 14.0, ?)",
            (did, pid, norm_lab_test_id),
        )
        await db.commit()
    return pid, did


@pytest.mark.asyncio
async def test_list_linked_documents_scoped_to_accessible_patients(
    client, db_path, make_user_client
):
    pid_a, _ = await _seed_doc_with_lab(db_path, "nz-a", "NZ A")
    _, _ = await _seed_doc_with_lab(db_path, "nz-b", "NZ B")
    viewer, _ = await make_user_client("nz-v", role="viewer", patient_grants={pid_a: "viewer"})
    resp = await viewer.get("/api/normalization/lab_tests/1/documents")
    assert resp.status_code == 200
    filenames = {d["original_filename"] for d in resp.json()}
    assert "nz-a-report.pdf" in filenames
    assert "nz-b-report.pdf" not in filenames


@pytest.mark.asyncio
async def test_admin_sees_all_linked_documents(client, db_path):
    await _seed_doc_with_lab(db_path, "nz-a2", "NZ A2")
    await _seed_doc_with_lab(db_path, "nz-b2", "NZ B2")
    resp = await client.get("/api/normalization/lab_tests/1/documents")
    assert resp.status_code == 200
    filenames = {d["original_filename"] for d in resp.json()}
    assert {"nz-a2-report.pdf", "nz-b2-report.pdf"} <= filenames


@pytest.mark.asyncio
async def test_viewer_cannot_rename_norm_entry(client, make_user_client):
    viewer, _ = await make_user_client("nz-mut", role="viewer")
    resp = await viewer.patch(
        "/api/normalization/lab_tests/1", json={"canonical_display": "Pwned"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_delete_norm_entry(client, make_user_client):
    viewer, _ = await make_user_client("nz-del", role="viewer")
    assert (await viewer.delete("/api/normalization/lab_tests/1")).status_code == 403


@pytest.mark.asyncio
async def test_editor_can_rename_norm_entry(client, make_user_client):
    editor, _ = await make_user_client("nz-ed", role="editor")
    resp = await editor.patch(
        "/api/normalization/lab_tests/1", json={"canonical_display": "Hemoglobin (edited)"}
    )
    assert resp.status_code == 200
