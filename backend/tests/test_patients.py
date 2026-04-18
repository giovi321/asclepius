"""Patient CRUD tests."""

import pytest


@pytest.mark.asyncio
async def test_create_patient(client):
    resp = await client.post(
        "/api/patients", json={"display_name": "Giovanni Crapelli", "date_of_birth": "1990-01-15"}
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["display_name"] == "Giovanni Crapelli"
    assert data["slug"] == "giovanni-crapelli"
    assert data["date_of_birth"] == "1990-01-15"


@pytest.mark.asyncio
async def test_list_patients(client):
    # Create a patient first
    await client.post("/api/patients", json={"display_name": "Test Patient"})

    resp = await client.get("/api/patients")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert any(p["display_name"] == "Test Patient" for p in data)


@pytest.mark.asyncio
async def test_update_patient(client):
    # Create
    resp = await client.post("/api/patients", json={"display_name": "Old Name"})
    patient_id = resp.json()["id"]

    # Update
    resp = await client.patch(
        f"/api/patients/{patient_id}", json={"display_name": "New Name"}
    )
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "New Name"


@pytest.mark.asyncio
async def test_create_duplicate_slug(client):
    # Two patients may share a display_name; the slug is auto-disambiguated
    # (unique-patient → unique-patient-2) so both creates succeed.
    first = await client.post("/api/patients", json={"display_name": "Unique Patient"})
    second = await client.post("/api/patients", json={"display_name": "Unique Patient"})
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["slug"] == "unique-patient"
    assert second.json()["slug"] != first.json()["slug"]
    assert second.json()["slug"].startswith("unique-patient")


@pytest.mark.asyncio
async def test_patients_require_auth(unauthed_client):
    resp = await unauthed_client.get("/api/patients")
    assert resp.status_code == 401
