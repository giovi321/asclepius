"""Lab results API tests."""

import pytest
import aiosqlite


async def _create_patient_with_labs(db_path):
    """Helper to create a patient with lab results."""
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('lab-patient', 'Lab Patient')"
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
               VALUES (?, 'test/labs.pdf', 'labs.pdf', 'done')""",
            (patient_id,),
        )
        doc_id = cursor.lastrowid

        # Add lab results
        for test_name, value, unit, date in [
            ("Hemoglobin", 14.5, "g/dL", "2024-01-15"),
            ("Hemoglobin", 13.8, "g/dL", "2024-06-15"),
            ("Hemoglobin", 15.0, "g/dL", "2024-12-15"),
            ("Total Cholesterol", 210, "mg/dL", "2024-01-15"),
            ("Total Cholesterol", 195, "mg/dL", "2024-06-15"),
        ]:
            await db.execute(
                """INSERT INTO lab_results
                   (document_id, patient_id, test_name_original, value, unit, test_date, is_abnormal)
                   VALUES (?, ?, ?, ?, ?, ?, 0)""",
                (doc_id, patient_id, test_name, value, unit, date),
            )
        await db.commit()
    return patient_id


@pytest.mark.asyncio
async def test_list_lab_results(client, db_path):
    patient_id = await _create_patient_with_labs(db_path)
    resp = await client.get("/api/lab-results", params={"patient_id": patient_id})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 5


@pytest.mark.asyncio
async def test_filter_by_test_name(client, db_path):
    patient_id = await _create_patient_with_labs(db_path)
    resp = await client.get(
        "/api/lab-results",
        params={"patient_id": patient_id, "test_name": "Hemoglobin"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 3


@pytest.mark.asyncio
async def test_filter_by_date(client, db_path):
    patient_id = await _create_patient_with_labs(db_path)
    resp = await client.get(
        "/api/lab-results",
        params={"patient_id": patient_id, "date_from": "2024-06-01", "date_to": "2024-06-30"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2  # June values for both tests


@pytest.mark.asyncio
async def test_timeline(client, db_path):
    patient_id = await _create_patient_with_labs(db_path)
    resp = await client.get(
        "/api/lab-results/timeline",
        params={"patient_id": patient_id, "test_name": "Hemoglobin"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) == 3
    # Should be ordered by date ascending
    dates = [d["test_date"] for d in data]
    assert dates == sorted(dates)


@pytest.mark.asyncio
async def test_lab_results_require_auth(unauthed_client):
    resp = await unauthed_client.get("/api/lab-results")
    assert resp.status_code == 401
