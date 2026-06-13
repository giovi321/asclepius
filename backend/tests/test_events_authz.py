"""Regression tests for medical-events authorization (Phase 0 security fix).

Before this fix every ``/api/events`` endpoint depended only on
``get_current_user`` with no patient-access check, so any authenticated user —
including a viewer with no grant — could read, edit, link, and cascade-delete
another patient's events and documents. These tests pin the corrected
behavior:

  * admins keep full access (no regression),
  * non-admins need an explicit ``user_patient_access`` grant on the event's
    patient to read/write,
  * viewers may read but not delete (mirrors ``/api/documents`` DELETE),
  * list results are scoped to the caller's accessible patients.
"""

import pytest
import aiosqlite


async def _seed_patient_with_event(db_path, slug, name, *, title="Surgery"):
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)", (slug, name)
        )
        pid = cur.lastrowid
        cur = await db.execute(
            "INSERT INTO medical_events (patient_id, title, event_type) "
            "VALUES (?, ?, 'surgery')",
            (pid, title),
        )
        eid = cur.lastrowid
        await db.commit()
    return pid, eid


@pytest.mark.asyncio
async def test_admin_can_read_event(client, db_path):
    _, eid = await _seed_patient_with_event(db_path, "p-admin", "P Admin")
    resp = await client.get(f"/api/events/{eid}")
    assert resp.status_code == 200
    assert resp.json()["id"] == eid


@pytest.mark.asyncio
async def test_user_without_access_cannot_read_event(client, db_path, make_user_client):
    _, eid = await _seed_patient_with_event(db_path, "p1", "P One")
    # Global "editor" role but NO grant on the patient → must be denied.
    other, _ = await make_user_client("noaccess", role="editor")
    resp = await other.get(f"/api/events/{eid}")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_user_without_access_cannot_update_event(client, db_path, make_user_client):
    _, eid = await _seed_patient_with_event(db_path, "p2", "P Two")
    other, _ = await make_user_client("noaccess2", role="editor")
    resp = await other.patch(f"/api/events/{eid}", json={"title": "Hijacked"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_user_without_access_cannot_delete_event(client, db_path, make_user_client):
    _, eid = await _seed_patient_with_event(db_path, "p3", "P Three")
    other, _ = await make_user_client("noaccess3", role="editor")
    resp = await other.delete(f"/api/events/{eid}")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_user_without_access_cannot_create_event(client, db_path, make_user_client):
    pid, _ = await _seed_patient_with_event(db_path, "p4", "P Four")
    other, _ = await make_user_client("noaccess4", role="editor")
    resp = await other.post("/api/events", json={"patient_id": pid, "title": "x"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_user_without_access_cannot_link(client, db_path, make_user_client):
    _, eid = await _seed_patient_with_event(db_path, "p5", "P Five")
    other, _ = await make_user_client("noaccess5", role="editor")
    resp = await other.post(
        f"/api/events/{eid}/link", json={"document_id": 1, "relevance": "primary"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_can_read_but_not_delete(client, db_path, make_user_client):
    pid, eid = await _seed_patient_with_event(db_path, "p6", "P Six")
    viewer, _ = await make_user_client("viewer1", role="viewer", patient_grants={pid: "viewer"})
    assert (await viewer.get(f"/api/events/{eid}")).status_code == 200
    assert (await viewer.delete(f"/api/events/{eid}")).status_code == 403


@pytest.mark.asyncio
async def test_editor_with_grant_can_delete(client, db_path, make_user_client):
    pid, eid = await _seed_patient_with_event(db_path, "p7", "P Seven")
    editor, _ = await make_user_client("editor1", role="editor", patient_grants={pid: "editor"})
    assert (await editor.delete(f"/api/events/{eid}")).status_code == 200


@pytest.mark.asyncio
async def test_list_events_scoped_to_accessible_patients(client, db_path, make_user_client):
    pid_a, _ = await _seed_patient_with_event(db_path, "pa", "PA", title="Event A")
    pid_b, _ = await _seed_patient_with_event(db_path, "pb", "PB", title="Event B")
    viewer, _ = await make_user_client("viewer2", role="viewer", patient_grants={pid_a: "viewer"})
    resp = await viewer.get("/api/events")
    assert resp.status_code == 200
    titles = {e["title"] for e in resp.json()}
    assert "Event A" in titles
    assert "Event B" not in titles


@pytest.mark.asyncio
async def test_suggest_requires_doc_patient_access(client, db_path, make_user_client):
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute("INSERT INTO patients (slug, display_name) VALUES ('ps', 'PS')")
        pid = cur.lastrowid
        cur = await db.execute(
            "INSERT INTO documents (patient_id, file_path, original_filename, status) "
            "VALUES (?, 'x/y.pdf', 'y.pdf', 'done')",
            (pid,),
        )
        did = cur.lastrowid
        await db.commit()
    other, _ = await make_user_client("nosug", role="editor")
    resp = await other.post(f"/api/events/suggest-for-document/{did}")
    assert resp.status_code == 403
