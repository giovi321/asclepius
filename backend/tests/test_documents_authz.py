"""Regression tests for document AI / linking authorization (Phase 0 review).

A follow-up security review found several document and event endpoints that
either lacked a patient-access check entirely or (for event linking) checked
access to the event but not to the document being linked — an IDOR allowing
cross-tenant PHI read-back and re-parenting. These tests pin the fixes.
"""

import pytest
import aiosqlite


async def _seed_doc(db_path, slug, name, *, filename="f.pdf"):
    """Create a patient + a done document, return (patient_id, doc_id)."""
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)", (slug, name)
        )
        pid = cur.lastrowid
        cur = await db.execute(
            "INSERT INTO documents (patient_id, file_path, original_filename, doc_type, status) "
            "VALUES (?, ?, ?, 'lab_test', 'done')",
            (pid, f"{slug}/{filename}", filename),
        )
        did = cur.lastrowid
        await db.commit()
    return pid, did


@pytest.mark.asyncio
async def test_edit_with_ai_requires_access(client, db_path, make_user_client):
    _, did = await _seed_doc(db_path, "ai1", "AI One")
    other, _ = await make_user_client("ai-noaccess", role="editor")
    resp = await other.post(
        f"/api/documents/{did}/edit-with-ai", json={"instruction": "set doctor to X"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_generate_filename_requires_access(client, db_path, make_user_client):
    _, did = await _seed_doc(db_path, "ai2", "AI Two")
    other, _ = await make_user_client("fn-noaccess", role="editor")
    resp = await other.post(f"/api/documents/{did}/generate-filename")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_links_requires_access(client, db_path, make_user_client):
    _, did = await _seed_doc(db_path, "lk1", "Link One")
    other, _ = await make_user_client("lk-noaccess", role="editor")
    assert (await other.get(f"/api/documents/{did}/links")).status_code == 403


@pytest.mark.asyncio
async def test_link_documents_blocks_cross_patient_target(client, db_path, make_user_client):
    pid_a, doc_a = await _seed_doc(db_path, "lka", "Link A")
    _, doc_b = await _seed_doc(db_path, "lkb", "Link B")
    # User can see patient A but not patient B → cannot link A's doc to B's doc.
    user, _ = await make_user_client("lk-a", role="editor", patient_grants={pid_a: "editor"})
    resp = await user.post(
        f"/api/documents/{doc_a}/link",
        json={"target_document_id": doc_b, "link_type": "related"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_link_documents_same_patient_ok(client, db_path, make_user_client):
    pid_a, doc_a = await _seed_doc(db_path, "lka2", "Link A2")
    # Second doc on the SAME patient.
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute(
            "INSERT INTO documents (patient_id, file_path, original_filename, status) "
            "VALUES (?, 'lka2/b.pdf', 'b.pdf', 'done')",
            (pid_a,),
        )
        doc_a2 = cur.lastrowid
        await db.commit()
    user, _ = await make_user_client("lk-a2", role="editor", patient_grants={pid_a: "editor"})
    resp = await user.post(
        f"/api/documents/{doc_a}/link",
        json={"target_document_id": doc_a2, "link_type": "related"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_event_link_blocks_cross_patient_document(client, db_path, make_user_client):
    # Event on patient A; document on patient B. A user (or even admin) must
    # not be able to link B's document to A's event.
    pid_a, _ = await _seed_doc(db_path, "ev-a", "Ev A")
    _, doc_b = await _seed_doc(db_path, "ev-b", "Ev B")
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute(
            "INSERT INTO medical_events (patient_id, title, event_type) "
            "VALUES (?, 'E', 'surgery')",
            (pid_a,),
        )
        eid = cur.lastrowid
        await db.commit()
    user, _ = await make_user_client("ev-u", role="editor", patient_grants={pid_a: "editor"})
    resp = await user.post(
        f"/api/events/{eid}/link", json={"document_id": doc_b, "relevance": "primary"}
    )
    assert resp.status_code == 403
    # Admin is also blocked — it's a data-integrity rule, not an access one.
    resp_admin = await client.post(
        f"/api/events/{eid}/link", json={"document_id": doc_b, "relevance": "primary"}
    )
    assert resp_admin.status_code == 403
