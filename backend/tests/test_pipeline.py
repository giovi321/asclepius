"""Pipeline processing tests."""

import pytest

from asclepius.documents.service import compute_file_hash
from asclepius.pipeline.organizer import build_organized_path
from asclepius.patients.service import slugify


def test_slugify():
    assert slugify("Alex Smith") == "alex-smith"
    assert slugify("Dr. Hans Müller") == "dr-hans-mller"
    assert slugify("  Spaces  Everywhere  ") == "spaces-everywhere"
    assert slugify("already-slugged") == "already-slugged"


def test_build_organized_path():
    from asclepius.config import AppConfig
    config = AppConfig()

    path = build_organized_path(
        config, "alex-smith", "2024-03-15", "drhouse", "bloodtest", "report.pdf"
    )
    assert path == "patients/alex-smith/2024/20240315_bloodtest.pdf"


def test_build_organized_path_unclassified():
    from asclepius.config import AppConfig
    config = AppConfig()

    path = build_organized_path(
        config, None, "2024-03-15", "drhouse", "bloodtest", "report.pdf"
    )
    assert path.startswith("unclassified/")


def test_build_organized_path_missing_fields():
    from asclepius.config import AppConfig
    config = AppConfig()

    path = build_organized_path(
        config, "patient", None, None, None, "scan.jpg"
    )
    assert "unknown" in path
    assert path.endswith(".jpg")


def test_build_organized_path_with_event():
    from asclepius.config import AppConfig
    config = AppConfig()

    path = build_organized_path(
        config, "alex-smith", "2024-03-15", "drhouse", "bloodtest", "report.pdf",
        event_slug="sleep-apnea-treatment",
    )
    assert path == "patients/alex-smith/2024/sleep-apnea-treatment/20240315_bloodtest.pdf"


def test_slugify_event():
    from asclepius.pipeline.organizer import slugify_event
    assert slugify_event("Sleep Apnea Treatment") == "sleep-apnea-treatment"
    assert slugify_event("Knee Injury 2024") == "knee-injury-2024"
    assert slugify_event("  Spaces  Everywhere  ") == "spaces-everywhere"


def test_compute_file_hash(tmp_path):
    test_file = tmp_path / "test.txt"
    test_file.write_text("hello world")
    hash1 = compute_file_hash(str(test_file))
    assert len(hash1) == 64  # SHA-256 hex digest length

    # Same content = same hash
    test_file2 = tmp_path / "test2.txt"
    test_file2.write_text("hello world")
    hash2 = compute_file_hash(str(test_file2))
    assert hash1 == hash2

    # Different content = different hash
    test_file3 = tmp_path / "test3.txt"
    test_file3.write_text("different content")
    hash3 = compute_file_hash(str(test_file3))
    assert hash1 != hash3


@pytest.mark.asyncio
async def test_pipeline_status(client):
    resp = await client.get("/api/pipeline/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "queue_depth" in data
    assert "total_processed" in data
    assert "total_errors" in data
    assert "recent_errors" in data
