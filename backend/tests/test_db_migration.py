"""Regression tests for the in-code migrations in ``db/init.py``.

0.9.7 trimmed the migration ladder: every pre-0.9 ALTER TABLE was
removed (the schema is now baked into ``schema.sql`` and a fresh
install runs no migrations at all). What stays is the 0.9.5 → 0.9.7
ladder for users who upgrade through the imaging-related shape changes.

These tests seed a 0.9.x database state and verify each migration is
idempotent + leaves the data in the expected new shape.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from asclepius.db.init import initialize_database


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
                study_instance_uid, folder_path)
               VALUES (?, ?, 'US', 1, 3, '1.2.3.STUDY-UID',
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
        # Canonical doc rewritten. The 0.9.6 model treats imaging documents
        # as report PLACEHOLDERS — doc_type flips to ``imaging_report``,
        # file_path is cleared (the radiology PDF takes its place when the
        # user uploads/links one). The deterministic study hash is preserved.
        canon = conn.execute(
            "SELECT file_path, doc_type, file_hash FROM documents WHERE id = ?",
            (canonical_doc,),
        ).fetchone()
        assert canon is not None
        assert canon["doc_type"] == "imaging_report"
        assert (canon["file_path"] or "") == ""
        assert canon["file_hash"] == expected_hash

        # Per-frame dupes gone (doc_type may now be the new
        # ``imaging_report`` after the 0.9.6 flip).
        per_frame = conn.execute(
            """SELECT COUNT(*) FROM documents
               WHERE doc_type IN ('imaging_dicom', 'imaging_report') AND id != ?""",
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

    # Idempotent — second run is a no-op. The placeholder remains a
    # placeholder and the study hash is unchanged.
    await initialize_database(str(db_path))
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        canon = conn.execute(
            "SELECT file_path, doc_type, file_hash FROM documents WHERE id = ?",
            (canonical_doc,),
        ).fetchone()
        assert (canon["file_path"] or "") == ""
        assert canon["doc_type"] == "imaging_report"
        assert canon["file_hash"] == expected_hash


@pytest.mark.asyncio
async def test_imaging_report_migration_v0_9_6(tmp_path: Path) -> None:
    """0.9.6: imaging documents flip from ``imaging_dicom`` (where
    ``file_path`` pointed at the DICOM folder) to ``imaging_report``
    placeholders (file_path NULL). ``imaging_studies.report_status`` is
    a new column that records whether the parent doc has a real PDF
    yet. The migration is idempotent.
    """
    db_path = tmp_path / "imaging-0.9.6.sqlite"
    await initialize_database(str(db_path))

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        cur = conn.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('giovi', 'Giovi')"
        )
        patient_id = cur.lastrowid
        # A pre-0.9.6 imaging document — file_path points at the study folder.
        cur = conn.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename,
                                       doc_type, status, ocr_engine, file_hash)
               VALUES (?, 'patients/giovi/2026/2026-04-27_clinic_US', 'foo',
                       'imaging_dicom', 'done', 'dicom', 'study-hash-x')""",
            (patient_id,),
        )
        doc_id = cur.lastrowid
        cur = conn.execute(
            """INSERT INTO imaging_studies
               (document_id, patient_id, modality, body_part,
                num_series, num_images, study_instance_uid, folder_path)
               VALUES (?, ?, 'US', 'ABDOMEN', 1, 35, 'STUDY-A',
                       'patients/giovi/2026/2026-04-27_clinic_US')""",
            (doc_id, patient_id),
        )
        conn.commit()

    # Re-run init: 0.9.6 migration runs.
    await initialize_database(str(db_path))

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # documents row flipped to imaging_report placeholder.
        d = conn.execute(
            "SELECT doc_type, file_path, original_filename FROM documents WHERE id = ?",
            (doc_id,),
        ).fetchone()
        assert d["doc_type"] == "imaging_report"
        # file_path is empty (placeholder marker) — schema declares the
        # column NOT NULL so we use '' rather than NULL.
        assert (d["file_path"] or "") == ""
        assert "report pending" in d["original_filename"].lower()
        # imaging_studies gained report_status, defaulted to placeholder.
        s = conn.execute(
            "SELECT report_status FROM imaging_studies WHERE document_id = ?",
            (doc_id,),
        ).fetchone()
        assert s["report_status"] == "placeholder"

    # Idempotent — second run is a no-op.
    await initialize_database(str(db_path))
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        d = conn.execute(
            "SELECT doc_type, file_path FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        assert d["doc_type"] == "imaging_report"
        assert (d["file_path"] or "") == ""


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
                study_instance_uid, folder_path)
               VALUES (?, ?, 'US', 1, 1, 'STUDY-A',
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
        # The 0.9.6 migration also flips this imaging_dicom doc to a
        # placeholder imaging_report. The folder_path is on the study
        # (asserted above); the documents row's file_path is now empty.
        doc = conn.execute(
            "SELECT file_path, doc_type FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        assert doc["doc_type"] == "imaging_report"
        assert (doc["file_path"] or "") == ""


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
                study_instance_uid, folder_path)
               VALUES (?, ?, 'US', 1, 0, 'study-uid-A', 'patients/mig-pat/imaging')""",
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
