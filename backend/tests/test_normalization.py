"""Normalization system tests."""

import pytest
import aiosqlite


@pytest.mark.asyncio
async def test_list_lab_tests(client):
    resp = await client.get("/api/normalization/lab_tests")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # Should have seed data
    assert len(data) > 0
    assert any(item["canonical_code"] == "hemoglobin" for item in data)


@pytest.mark.asyncio
async def test_get_lab_test_with_aliases(client):
    # Find hemoglobin ID
    resp = await client.get("/api/normalization/lab_tests")
    items = resp.json()
    hb = next(i for i in items if i["canonical_code"] == "hemoglobin")

    resp = await client.get(f"/api/normalization/lab_tests/{hb['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["canonical_code"] == "hemoglobin"
    assert len(data["aliases"]) > 0
    alias_texts = [a["alias"] for a in data["aliases"]]
    assert "Emoglobina" in alias_texts  # Italian alias from seed


@pytest.mark.asyncio
async def test_add_alias(client):
    resp = await client.get("/api/normalization/lab_tests")
    items = resp.json()
    hb = next(i for i in items if i["canonical_code"] == "hemoglobin")

    resp = await client.post(
        f"/api/normalization/lab_tests/{hb['id']}/aliases",
        json={"alias": "Hémoglobine", "language": "fr"},
    )
    assert resp.status_code == 200
    aliases = [a["alias"] for a in resp.json()["aliases"]]
    assert "Hémoglobine" in aliases


@pytest.mark.asyncio
async def test_update_canonical(client):
    resp = await client.get("/api/normalization/lab_tests")
    items = resp.json()
    hb = next(i for i in items if i["canonical_code"] == "hemoglobin")

    resp = await client.patch(
        f"/api/normalization/lab_tests/{hb['id']}",
        json={"canonical_display": "Hemoglobin (Hb)"},
    )
    assert resp.status_code == 200
    assert resp.json()["canonical_display"] == "Hemoglobin (Hb)"


@pytest.mark.asyncio
async def test_confirm_aliases(client):
    resp = await client.get("/api/normalization/lab_tests")
    items = resp.json()
    hb = next(i for i in items if i["canonical_code"] == "hemoglobin")

    resp = await client.post(f"/api/normalization/lab_tests/{hb['id']}/confirm")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_merge_norms(client, db_path):
    # Create two entries to merge
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO norm_lab_tests (canonical_code, canonical_display) VALUES ('test_dup_a', 'Dup A')"
        )
        id_a = cursor.lastrowid
        cursor = await db.execute(
            "INSERT INTO norm_lab_tests (canonical_code, canonical_display) VALUES ('test_dup_b', 'Dup B')"
        )
        id_b = cursor.lastrowid
        await db.execute(
            "INSERT INTO norm_lab_test_aliases (norm_lab_test_id, alias) VALUES (?, 'Alias A')",
            (id_a,),
        )
        await db.execute(
            "INSERT INTO norm_lab_test_aliases (norm_lab_test_id, alias) VALUES (?, 'Alias B')",
            (id_b,),
        )
        await db.commit()

    # Merge A into B
    resp = await client.post(
        "/api/normalization/lab_tests/merge",
        json={"source_id": id_a, "target_id": id_b},
    )
    assert resp.status_code == 200

    # Verify A is gone
    resp = await client.get(f"/api/normalization/lab_tests/{id_a}")
    assert resp.status_code == 404

    # Verify B has both aliases
    resp = await client.get(f"/api/normalization/lab_tests/{id_b}")
    assert resp.status_code == 200
    aliases = [a["alias"] for a in resp.json()["aliases"]]
    assert "Alias A" in aliases
    assert "Alias B" in aliases


@pytest.mark.asyncio
async def test_filter_unreviewed(client):
    resp = await client.get("/api/normalization/lab_tests", params={"filter": "unreviewed"})
    assert resp.status_code == 200
    # All seed data has auto_mapped=0, so none should be unreviewed
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_list_specialties(client):
    resp = await client.get("/api/normalization/specialties")
    assert resp.status_code == 200
    data = resp.json()
    assert any(item["canonical_code"] == "cardiology" for item in data)


@pytest.mark.asyncio
async def test_list_diagnoses(client):
    resp = await client.get("/api/normalization/diagnoses")
    assert resp.status_code == 200
    data = resp.json()
    assert any(item["canonical_code"] == "essential-hypertension" for item in data)


@pytest.mark.asyncio
async def test_list_medications(client):
    resp = await client.get("/api/normalization/medications")
    assert resp.status_code == 200
    data = resp.json()
    assert any(item["canonical_code"] == "atorvastatin" for item in data)


@pytest.mark.asyncio
async def test_invalid_norm_type(client):
    resp = await client.get("/api/normalization/invalid_type")
    assert resp.status_code == 400
