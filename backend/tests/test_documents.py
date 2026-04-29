"""Document CRUD tests."""

import pytest
import aiosqlite


@pytest.mark.asyncio
async def test_list_documents_empty(client):
    resp = await client.get("/api/documents")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_list_documents_with_data(client, db_path):
    # Create a patient and document directly in DB
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")

        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('test-patient', 'Test Patient')"
        )
        patient_id = cursor.lastrowid

        # Grant access
        await db.execute("SELECT id FROM users WHERE username = 'admin'")
        user_cursor = await db.execute("SELECT id FROM users WHERE username = 'admin'")
        user = await user_cursor.fetchone()
        await db.execute(
            "INSERT INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, 'owner')",
            (user[0], patient_id),
        )

        await db.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename, doc_type, status)
               VALUES (?, 'test/path.pdf', 'test.pdf', 'lab_test', 'done')""",
            (patient_id,),
        )
        await db.commit()

    resp = await client.get("/api/documents", params={"patient_id": patient_id})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["original_filename"] == "test.pdf"
    assert data["items"][0]["doc_type"] == "lab_test"


@pytest.mark.asyncio
async def test_get_document_detail(client, db_path):
    # Create test data
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('detail-patient', 'Detail Patient')"
        )
        patient_id = cursor.lastrowid
        user_cursor = await db.execute("SELECT id FROM users WHERE username = 'admin'")
        user = await user_cursor.fetchone()
        await db.execute(
            "INSERT INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, 'owner')",
            (user[0], patient_id),
        )
        cursor = await db.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename, doc_type, status, ocr_text)
               VALUES (?, 'test/detail.pdf', 'detail.pdf', 'lab_test', 'done', 'Hemoglobin 14.5 g/dL')""",
            (patient_id,),
        )
        doc_id = cursor.lastrowid

        # Add a lab result
        await db.execute(
            """INSERT INTO lab_results (document_id, patient_id, test_name_original, value, unit, is_abnormal)
               VALUES (?, ?, 'Hemoglobin', 14.5, 'g/dL', 0)""",
            (doc_id, patient_id),
        )
        await db.commit()

    resp = await client.get(f"/api/documents/{doc_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["original_filename"] == "detail.pdf"
    assert len(data["lab_results"]) == 1
    assert data["lab_results"][0]["test_name_original"] == "Hemoglobin"
    assert data["lab_results"][0]["value"] == 14.5


@pytest.mark.asyncio
async def test_get_document_not_found(client):
    resp = await client.get("/api/documents/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_document(client, db_path):
    # Create test data
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('update-patient', 'Update Patient')"
        )
        patient_id = cursor.lastrowid
        user_cursor = await db.execute("SELECT id FROM users WHERE username = 'admin'")
        user = await user_cursor.fetchone()
        await db.execute(
            "INSERT INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, 'owner')",
            (user[0], patient_id),
        )
        cursor = await db.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename, status)
               VALUES (?, 'test/update.pdf', 'update.pdf', 'done')""",
            (patient_id,),
        )
        doc_id = cursor.lastrowid
        await db.commit()

    resp = await client.patch(
        f"/api/documents/{doc_id}", json={"doc_type": "prescription", "event_date": "2024-03-15"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["doc_type"] == "prescription"
    assert data["event_date"] == "2024-03-15"


@pytest.mark.asyncio
async def test_documents_require_auth(unauthed_client):
    resp = await unauthed_client.get("/api/documents")
    assert resp.status_code == 401
