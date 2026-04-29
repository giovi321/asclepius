"""Search and FTS5 tests."""

import pytest
import aiosqlite


@pytest.mark.asyncio
async def test_fts_search(client, db_path):
    """Test full-text search via documents endpoint."""
    # Insert a document with OCR text
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('search-patient', 'Search Patient')"
        )
        patient_id = cursor.lastrowid
        user_cursor = await db.execute("SELECT id FROM users WHERE username = 'admin'")
        user = await user_cursor.fetchone()
        await db.execute(
            "INSERT INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, 'owner')",
            (user[0], patient_id),
        )

        # Insert document with searchable text
        await db.execute(
            """INSERT INTO documents
               (patient_id, file_path, original_filename, doc_type, status, ocr_text)
               VALUES (?, 'test/search.pdf', 'search.pdf', 'lab_test', 'done',
                       'Patient has elevated cholesterol levels at 280 mg/dL. Recommend statin therapy.')""",
            (patient_id,),
        )
        await db.commit()

    # Search for cholesterol
    resp = await client.get("/api/documents", params={"q": "cholesterol"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert any("cholesterol" in (item.get("ocr_text") or "").lower() for item in data["items"])

    # Search for something not in the text
    resp = await client.get("/api/documents", params={"q": "xyznonexistent"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 0
