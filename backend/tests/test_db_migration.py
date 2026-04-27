"""Regression tests for the in-code migrations in ``db/init.py``.

The 0.9 refactor dropped ``doctor_name`` / ``facility_name`` columns and
unified ``doc_date`` / ``date_visit`` / ``date_issued`` into ``event_date`` +
``issued_date``. Migrating an existing 0.8 database must:

- add the new columns and backfill them using the priority rule,
- drop the legacy columns,
- rebuild the FTS5 virtual table with its sync triggers,
- create the ``idx_documents_event_date`` index.

These tests seed a minimal pre-0.9 schema and then run
``initialize_database`` against it to verify all of the above.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from asclepius.db.init import initialize_database


# Minimal pre-0.9 schema — just enough of ``documents`` to exercise the
# migration path. Other tables are created by the migration code's
# ``executescript(schema.sql)`` step.
LEGACY_DOCUMENTS_DDL = """
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    doc_type TEXT,
    doc_date DATE,
    doctor_id INTEGER,
    doctor_name TEXT,
    facility_id INTEGER,
    facility_name TEXT,
    date_issued DATE,
    date_visit DATE,
    date_received DATE,
    summary_en TEXT,
    summary_original TEXT,
    norm_specialty_id INTEGER,
    specialty_original TEXT,
    insurance_company TEXT,
    insurance_policy TEXT,
    event_id INTEGER,
    notes TEXT,
    tags TEXT,
    page_count INTEGER,
    file_size INTEGER,
    file_hash TEXT UNIQUE,
    language_source TEXT,
    ocr_text TEXT,
    ocr_confidence REAL,
    ocr_engine TEXT,
    llm_provider TEXT,
    raw_extraction JSON,
    cost_amount REAL,
    cost_currency TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    process_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""


def _seed_legacy(db_path: Path) -> None:
    """Create a legacy (pre-0.9) database with two representative rows."""
    with sqlite3.connect(db_path) as conn:
        conn.executescript(LEGACY_DOCUMENTS_DDL)
        # Seed the pre-0.9 indexes on the soon-to-be-dropped columns so we
        # verify the migration cleans them up before the DROP COLUMNs. SQLite
        # refuses to drop a column an index still references.
        conn.execute("CREATE INDEX idx_documents_doc_date ON documents(doc_date)")
        conn.executemany(
            """INSERT INTO documents
               (file_path, original_filename, doc_type, doc_date,
                date_issued, date_visit, doctor_name, facility_name, ocr_text)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                # Row 1: all three dates set — date_visit wins the priority rule.
                ("a.pdf", "a.pdf", "specialist_report",
                 "2024-01-01", "2024-01-05", "2024-01-10",
                 "Dr. A", "Clinic A", "visit report"),
                # Row 2: only doc_date — event_date should fall through to it.
                ("b.pdf", "b.pdf", "invoice",
                 "2024-02-15", None, None,
                 "Dr. B", "Clinic B", "invoice body"),
            ],
        )
        conn.commit()


@pytest.mark.asyncio
async def test_legacy_db_upgrades_cleanly(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.sqlite"
    _seed_legacy(db_path)

    # Should not raise — the failure mode we are guarding against is
    # ``sqlite3.OperationalError: no such column: event_date`` fired by
    # ``CREATE INDEX … ON documents(event_date)`` inside schema.sql before
    # the migration has had a chance to add the column.
    await initialize_database(str(db_path))

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cols = {r[1] for r in conn.execute("PRAGMA table_info(documents)")}
        assert "event_date" in cols, "event_date column should have been added"
        assert "issued_date" in cols, "issued_date column should have been added"
        assert "doc_date" not in cols, "legacy doc_date column should have been dropped"
        assert "date_visit" not in cols, "legacy date_visit column should have been dropped"
        assert "date_issued" not in cols, "legacy date_issued column should have been dropped"
        assert "doctor_name" not in cols, "denormalized doctor_name should have been dropped"
        assert "facility_name" not in cols, "denormalized facility_name should have been dropped"

        rows = {r["original_filename"]: r for r in conn.execute(
            "SELECT original_filename, event_date, issued_date FROM documents"
        )}
        assert rows["a.pdf"]["event_date"] == "2024-01-10", (
            "event_date should pick the first non-null in priority order "
            "(date_visit > date_issued > doc_date)"
        )
        assert rows["a.pdf"]["issued_date"] == "2024-01-05"
        assert rows["b.pdf"]["event_date"] == "2024-02-15"
        assert rows["b.pdf"]["issued_date"] is None

        indexes = {r[1] for r in conn.execute("PRAGMA index_list(documents)")}
        assert "idx_documents_event_date" in indexes
        assert "idx_documents_doc_date" not in indexes, (
            "legacy indexes on the dropped columns must be cleaned up"
        )

        fts_tables = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='documents_fts'"
            )
        }
        assert "documents_fts" in fts_tables

        # FTS sync triggers must exist so future inserts keep the index fresh.
        triggers = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger'"
                " AND name IN ('documents_ai', 'documents_au', 'documents_ad')"
            )
        }
        assert triggers == {"documents_ai", "documents_au", "documents_ad"}


@pytest.mark.asyncio
async def test_legacy_db_upgrade_is_idempotent(tmp_path: Path) -> None:
    """Running the migration twice must produce no errors."""
    db_path = tmp_path / "legacy.sqlite"
    _seed_legacy(db_path)
    await initialize_database(str(db_path))
    await initialize_database(str(db_path))  # second run = no-op


@pytest.mark.asyncio
async def test_imaging_one_doc_per_study_migration(tmp_path: Path) -> None:
    """The 0.9.5 model is "one documents row per imaging study". Existing
    pre-0.9.5 databases have N documents per study (one per DICOM frame)
    plus M ``unknown_binary`` rows for zip-member bundle files. The
    migration must:

      1. keep the canonical document (the one ``imaging_studies.document_id``
         points to), rewrite its ``file_path`` to the study folder and its
         ``file_hash`` to ``asclepius-imaging-study:{uid_or_path}`` SHA-256;
      2. delete the per-frame duplicate ``imaging_dicom`` rows;
      3. delete the per-bundle-file ``unknown_binary`` rows.

    Idempotent — running init twice produces no further changes.
    """
    import hashlib

    db_path = tmp_path / "imaging-collapse.sqlite"
    await initialize_database(str(db_path))

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        cur = conn.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('giovi', 'Giovi')"
        )
        patient_id = cur.lastrowid

        # Canonical document — the one imaging_studies.document_id will point at.
        cur = conn.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename,
                                       doc_type, status, ocr_engine, file_hash)
               VALUES (?, 'patients/giovi/imaging/foo/series-1/I1000000.dcm',
                       'I1000000.dcm', 'imaging_dicom', 'done', 'dicom', 'frame-hash-a')""",
            (patient_id,),
        )
        canonical_doc = cur.lastrowid

        # Two extra per-frame docs that the migration should delete.
        for n in (1, 2):
            conn.execute(
                """INSERT INTO documents (patient_id, file_path, original_filename,
                                           doc_type, status, ocr_engine, file_hash)
                   VALUES (?, ?, ?, 'imaging_dicom', 'done', 'dicom', ?)""",
                (
                    patient_id,
                    f"patients/giovi/imaging/foo/series-1/I100000{n}.dcm",
                    f"I100000{n}.dcm",
                    f"frame-hash-{n}",
                ),
            )

        # Bundle-file rows that the migration should delete.
        for n in (1, 2, 3):
            conn.execute(
                """INSERT INTO documents (patient_id, file_path, original_filename,
                                           doc_type, status, ocr_engine, file_hash)
                   VALUES (?, ?, ?, 'unknown_binary', 'done', 'none', ?)""",
                (
                    patient_id,
                    f"patients/giovi/imaging-bundles/foo/preview_{n}.jpg",
                    f"preview_{n}.jpg",
                    f"bundle-hash-{n}",
                ),
            )

        # Unrelated document that must NOT be touched by the migration.
        conn.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename,
                                       doc_type, status, ocr_engine, file_hash)
               VALUES (?, 'patients/giovi/2024/labs/cbc.pdf', 'cbc.pdf',
                       'lab_report', 'done', 'tesseract', 'unrelated-hash')""",
            (patient_id,),
        )

        cur = conn.execute(
            """INSERT INTO imaging_studies
               (document_id, patient_id, modality, num_series, num_images,
                is_dicom, study_instance_uid, folder_path)
               VALUES (?, ?, 'US', 1, 3, 1, '1.2.3.STUDY-UID',
                       'patients/giovi/imaging/foo')""",
            (canonical_doc, patient_id),
        )
        study_id = cur.lastrowid
        conn.execute(
            """INSERT INTO imaging_series
               (study_id, series_number, modality, num_images,
                series_instance_uid, folder_path)
               VALUES (?, 1, 'US', 3, '1.2.3.SERIES-UID',
                       'patients/giovi/imaging/foo/series-1')""",
            (study_id,),
        )
        conn.commit()

    # Run init: the migration block runs.
    await initialize_database(str(db_path))

    expected_hash = hashlib.sha256(
        b"asclepius-imaging-study:1.2.3.STUDY-UID"
    ).hexdigest()

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # Canonical doc rewritten. The 0.9.6 layout migration also strips
        # the legacy ``imaging/`` segment, so the final path is
        # ``patients/giovi/foo`` rather than ``patients/giovi/imaging/foo``.
        canon = conn.execute(
            "SELECT file_path, original_filename, file_hash FROM documents WHERE id = ?",
            (canonical_doc,),
        ).fetchone()
        assert canon is not None
        assert canon["file_path"] == "patients/giovi/foo"
        assert canon["original_filename"] == "foo"
        assert canon["file_hash"] == expected_hash

        # Per-frame dupes gone.
        per_frame = conn.execute(
            """SELECT COUNT(*) FROM documents
               WHERE doc_type = 'imaging_dicom' AND id != ?""",
            (canonical_doc,),
        ).fetchone()[0]
        assert per_frame == 0

        # Bundle-file rows gone.
        bundle = conn.execute(
            "SELECT COUNT(*) FROM documents WHERE doc_type = 'unknown_binary'"
        ).fetchone()[0]
        assert bundle == 0

        # Unrelated lab_report row untouched.
        unrelated = conn.execute(
            "SELECT COUNT(*) FROM documents WHERE doc_type = 'lab_report'"
        ).fetchone()[0]
        assert unrelated == 1

    # Idempotent — second run is a no-op (path stays ``patients/giovi/foo``).
    await initialize_database(str(db_path))
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        canon = conn.execute(
            "SELECT file_path, file_hash FROM documents WHERE id = ?",
            (canonical_doc,),
        ).fetchone()
        assert canon["file_path"] == "patients/giovi/foo"
        assert canon["file_hash"] == expected_hash


@pytest.mark.asyncio
async def test_imaging_layout_migration_strips_imaging_segment(
    tmp_path: Path, monkeypatch
) -> None:
    """0.9.6 drops the legacy ``imaging/`` middle segment so a study folder
    sits at the same level as document files (peer of a PDF). The
    migration moves the on-disk folder and rewrites every database row
    that referenced the old prefix.
    """
    # Point the config at a real vault root under tmp so the migration
    # can perform the disk move.
    vault = tmp_path / "vault"
    (vault / "patients" / "giovi" / "2026" / "imaging" / "foo" / "series-1").mkdir(parents=True)
    frame = vault / "patients" / "giovi" / "2026" / "imaging" / "foo" / "series-1" / "I1000000.dcm"
    frame.write_bytes(b"fake-dicom")
    monkeypatch.setenv("ASCLEPIUS_VAULT_PATH", str(vault))

    # Reset the cached config so the migration sees the new vault.
    from asclepius.config import get_config
    get_config.cache_clear()

    db_path = tmp_path / "layout.sqlite"
    await initialize_database(str(db_path))

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        cur = conn.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('giovi', 'Giovi')"
        )
        patient_id = cur.lastrowid
        cur = conn.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename,
                                       doc_type, status, ocr_engine, file_hash)
               VALUES (?, 'patients/giovi/2026/imaging/foo', 'foo',
                       'imaging_dicom', 'done', 'dicom', 'study-hash')""",
            (patient_id,),
        )
        doc_id = cur.lastrowid
        cur = conn.execute(
            """INSERT INTO imaging_studies
               (document_id, patient_id, modality, num_series, num_images,
                is_dicom, study_instance_uid, folder_path)
               VALUES (?, ?, 'US', 1, 1, 1, 'STUDY-A',
                       'patients/giovi/2026/imaging/foo')""",
            (doc_id, patient_id),
        )
        study_id = cur.lastrowid
        conn.execute(
            """INSERT INTO imaging_series
               (study_id, series_number, modality, num_images,
                series_instance_uid, folder_path)
               VALUES (?, 1, 'US', 1, 'SERIES-A',
                       'patients/giovi/2026/imaging/foo/series-1')""",
            (study_id,),
        )
        conn.commit()

    # Run init: layout migration moves the folder and rewrites paths.
    await initialize_database(str(db_path))

    # Folder is at the new location.
    assert not (vault / "patients" / "giovi" / "2026" / "imaging").exists()
    assert (vault / "patients" / "giovi" / "2026" / "foo" / "series-1" / "I1000000.dcm").exists()

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        study = conn.execute(
            "SELECT folder_path FROM imaging_studies WHERE id = ?", (study_id,)
        ).fetchone()
        assert study["folder_path"] == "patients/giovi/2026/foo"
        series = conn.execute(
            "SELECT folder_path FROM imaging_series WHERE study_id = ?", (study_id,)
        ).fetchone()
        assert series["folder_path"] == "patients/giovi/2026/foo/series-1"
        doc = conn.execute(
            "SELECT file_path FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        assert doc["file_path"] == "patients/giovi/2026/foo"


@pytest.mark.asyncio
async def test_imaging_series_dedup_migration(tmp_path: Path) -> None:
    """Existing databases corrupted by the NULL series_instance_uid bug
    must be cleaned up: duplicate imaging_series rows are merged (summing
    num_images), and each parent imaging_studies row's num_series and
    num_images are recomputed from the merged children."""
    db_path = tmp_path / "imaging.sqlite"

    # First run: create a clean schema so we can seed valid rows that
    # respect the foreign-key constraints (patients, documents).
    await initialize_database(str(db_path))

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        cur = conn.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('mig-pat', 'Mig Patient')"
        )
        patient_id = cur.lastrowid
        cur = conn.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename,
                                       doc_type, status, ocr_engine)
               VALUES (?, 'imaging/test.dcm', 'test.dcm', 'imaging_dicom', 'done', 'dicom')""",
            (patient_id,),
        )
        doc_id = cur.lastrowid

        # Study with a wrong num_series (bug 2): says 1, will actually have 2 series.
        cur = conn.execute(
            """INSERT INTO imaging_studies
               (document_id, patient_id, modality, num_series, num_images,
                is_dicom, study_instance_uid, folder_path)
               VALUES (?, ?, 'US', 1, 0, 1, 'study-uid-A', 'patients/mig-pat/imaging')""",
            (doc_id, patient_id),
        )
        study_id = cur.lastrowid

        # Bug 3 reproduction: 5 duplicate series rows for the same physical
        # series (NULL series_instance_uid + same series_number=1), each
        # with num_images=1.
        for _ in range(5):
            conn.execute(
                """INSERT INTO imaging_series
                   (study_id, series_number, series_description, modality,
                    num_images, series_instance_uid, folder_path)
                   VALUES (?, 1, 'US Abdomen', 'US', 1, NULL,
                           'patients/mig-pat/imaging/series-1')""",
                (study_id,),
            )

        # A second legitimate series with a non-NULL UID and 3 frames.
        conn.execute(
            """INSERT INTO imaging_series
               (study_id, series_number, series_description, modality,
                num_images, series_instance_uid, folder_path)
               VALUES (?, 2, 'US Pelvis', 'US', 3, 'series-uid-B',
                       'patients/mig-pat/imaging/series-2')""",
            (study_id,),
        )
        conn.commit()

    # Re-run init — the migration block runs and merges + recomputes.
    await initialize_database(str(db_path))

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # 5 duplicate NULL-uid rows collapse to 1 with num_images=5.
        rows = list(conn.execute(
            "SELECT series_instance_uid, num_images FROM imaging_series "
            "WHERE study_id = (SELECT id FROM imaging_studies WHERE study_instance_uid = 'study-uid-A') "
            "ORDER BY id"
        ))
        assert len(rows) == 2, f"Expected 2 series after merge, got {len(rows)}"
        # The merged null-UID series should now hold the summed count.
        null_row = next(r for r in rows if r["series_instance_uid"] is None)
        assert null_row["num_images"] == 5
        uid_row = next(r for r in rows if r["series_instance_uid"] == "series-uid-B")
        assert uid_row["num_images"] == 3

        # Parent counters were recomputed.
        study = conn.execute(
            "SELECT num_series, num_images FROM imaging_studies WHERE study_instance_uid = 'study-uid-A'"
        ).fetchone()
        assert study["num_series"] == 2
        assert study["num_images"] == 8  # 5 + 3

    # Idempotent — running once more must not change anything.
    await initialize_database(str(db_path))
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        study = conn.execute(
            "SELECT num_series, num_images FROM imaging_studies WHERE study_instance_uid = 'study-uid-A'"
        ).fetchone()
        assert study["num_series"] == 2
        assert study["num_images"] == 8
