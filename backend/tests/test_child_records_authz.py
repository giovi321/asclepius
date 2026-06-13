"""Authorization tests for the two sanctioned behavior fixes in the authz
consolidation pass.

FIX #1 — child-record writes (encounters / medications) used to accept *any*
patient grant, so a ``viewer`` could PATCH or DELETE them. They now require
write access (admin / uploader / owner / editor), matching the rest of the
document-write surface. These tests pin: a viewer is rejected (403), an editor
and an owner are allowed.

FIX #2 — imaging-study access used to call ``check_patient_access`` directly,
with no admin bypass: an admin holding no explicit ``user_patient_access``
grant on the study's patient got a 403. It now routes through
``authz.require_patient_access``, which grants admins access everywhere. This
test pins the new admin-bypass behavior on ``GET /api/imaging/{id}``.
"""

import aiosqlite
import pytest


async def _seed_patient_with_encounter(db_path, slug, name):
    """Create a patient + a done document + one encounter row.

    Returns (patient_id, doc_id, encounter_id).
    """
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)", (slug, name)
        )
        pid = cur.lastrowid
        cur = await db.execute(
            "INSERT INTO documents (patient_id, file_path, original_filename, doc_type, status) "
            "VALUES (?, ?, 'enc.pdf', 'visit', 'done')",
            (pid, f"{slug}/enc.pdf"),
        )
        did = cur.lastrowid
        cur = await db.execute(
            "INSERT INTO encounters (document_id, patient_id, diagnosis_original, notes) "
            "VALUES (?, ?, 'Flu', 'initial note')",
            (did, pid),
        )
        eid = cur.lastrowid
        await db.commit()
    return pid, did, eid


# ── FIX #1: viewers can no longer edit/delete child records ──────────


@pytest.mark.asyncio
async def test_viewer_cannot_patch_encounter(client, db_path, make_user_client):
    pid, _, eid = await _seed_patient_with_encounter(db_path, "cr-viewer", "CR Viewer")
    viewer, _ = await make_user_client(
        "cr-view", role="viewer", patient_grants={pid: "viewer"}
    )
    resp = await viewer.patch(
        f"/api/encounters/{eid}", json={"notes": "hijacked"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_cannot_delete_encounter(client, db_path, make_user_client):
    pid, _, eid = await _seed_patient_with_encounter(db_path, "cr-viewer-del", "CR ViewerD")
    viewer, _ = await make_user_client(
        "cr-view-del", role="viewer", patient_grants={pid: "viewer"}
    )
    resp = await viewer.delete(f"/api/encounters/{eid}")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_editor_can_patch_encounter(client, db_path, make_user_client):
    pid, _, eid = await _seed_patient_with_encounter(db_path, "cr-editor", "CR Editor")
    editor, _ = await make_user_client(
        "cr-edit", role="editor", patient_grants={pid: "editor"}
    )
    resp = await editor.patch(
        f"/api/encounters/{eid}", json={"notes": "fixed by editor"}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


@pytest.mark.asyncio
async def test_owner_can_delete_encounter(client, db_path, make_user_client):
    pid, _, eid = await _seed_patient_with_encounter(db_path, "cr-owner", "CR Owner")
    owner, _ = await make_user_client(
        "cr-own", role="editor", patient_grants={pid: "owner"}
    )
    resp = await owner.delete(f"/api/encounters/{eid}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"


# ── FIX #2: admins reach imaging studies without an explicit grant ───


async def _seed_imaging_study(db_path, slug, name):
    """Create a patient + parent imaging_report document + an imaging study.

    The default ``admin`` user from the conftest fixture is NOT granted any
    ``user_patient_access`` on this patient, so the test exercises the
    admin-bypass path.
    """
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)", (slug, name)
        )
        pid = cur.lastrowid
        cur = await db.execute(
            "INSERT INTO documents (patient_id, file_path, original_filename, doc_type, status) "
            "VALUES (?, '', 'MR Brain (report pending)', 'imaging_report', 'done')",
            (pid,),
        )
        did = cur.lastrowid
        cur = await db.execute(
            "INSERT INTO imaging_studies "
            "(document_id, patient_id, modality, body_part, report_status) "
            "VALUES (?, ?, 'MR', 'brain', 'placeholder')",
            (did, pid),
        )
        sid = cur.lastrowid
        await db.commit()
    return pid, sid


@pytest.mark.asyncio
async def test_admin_without_grant_can_access_imaging_study(client, db_path):
    # ``client`` is the admin from conftest; it has NO user_patient_access row
    # on this freshly-created patient. The old check_patient_access path would
    # 403 here; the new authz.require_patient_access admin bypass lets it in.
    _, sid = await _seed_imaging_study(db_path, "img-admin", "Img Admin")
    resp = await client.get(f"/api/imaging/{sid}")
    assert resp.status_code == 200
    assert resp.json()["id"] == sid


@pytest.mark.asyncio
async def test_non_admin_without_grant_still_blocked_on_imaging(
    client, db_path, make_user_client
):
    # The admin bypass must not loosen non-admins: a user with no grant on the
    # study's patient still gets 403.
    _, sid = await _seed_imaging_study(db_path, "img-noaccess", "Img NoAccess")
    other, _ = await make_user_client("img-no", role="editor")
    resp = await other.get(f"/api/imaging/{sid}")
    assert resp.status_code == 403
