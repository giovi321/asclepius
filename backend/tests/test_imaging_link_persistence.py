"""Regression tests for imaging↔document link persistence across parent swaps.

Bug history: linking documents from the imaging detail page wrote rows in
``document_links`` anchored on the imaging's *parent* document id. Attaching
or detaching a report PDF swaps that parent id. The placeholder delete that
follows the swap used to cascade-wipe every link via
``ON DELETE CASCADE``. ``migrate_document_links`` repoints the rows before
the delete so links survive.
"""

import aiosqlite
import pytest

from asclepius.documents.service import (
    get_document_links,
    migrate_document_links,
)


async def _seed_patient(db: aiosqlite.Connection) -> int:
    cursor = await db.execute("INSERT INTO patients (slug, display_name) VALUES ('p1', 'P1')")
    return cursor.lastrowid


async def _seed_doc(
    db: aiosqlite.Connection,
    patient_id: int,
    filename: str,
    doc_type: str = "bloodtest",
    file_path: str = "stub/path.pdf",
) -> int:
    cursor = await db.execute(
        """INSERT INTO documents (patient_id, file_path, original_filename, doc_type, status)
           VALUES (?, ?, ?, ?, 'done')""",
        (patient_id, file_path, filename, doc_type),
    )
    return cursor.lastrowid


async def _seed_imaging(
    db: aiosqlite.Connection,
    patient_id: int,
    parent_doc_id: int,
) -> int:
    cursor = await db.execute(
        """INSERT INTO imaging_studies
           (patient_id, document_id, study_instance_uid, modality, body_part,
            num_series, num_images, report_status)
           VALUES (?, ?, 'uid-1', 'MR', 'brain', 0, 0, 'placeholder')""",
        (patient_id, parent_doc_id),
    )
    return cursor.lastrowid


@pytest.mark.asyncio
async def test_migrate_repoints_source_and_target(db):
    patient = await _seed_patient(db)
    a = await _seed_doc(db, patient, "a.pdf")
    b = await _seed_doc(db, patient, "b.pdf")
    old_parent = await _seed_doc(
        db, patient, "placeholder.pdf", doc_type="imaging_report", file_path=""
    )
    new_parent = await _seed_doc(db, patient, "report.pdf", doc_type="imaging_report")

    # Two links: one with source=old_parent, one with target=old_parent.
    await db.execute(
        "INSERT INTO document_links (source_document_id, target_document_id, link_type) VALUES (?, ?, 'related')",
        (old_parent, a),
    )
    await db.execute(
        "INSERT INTO document_links (source_document_id, target_document_id, link_type) VALUES (?, ?, 'related')",
        (b, old_parent),
    )
    await db.commit()

    await migrate_document_links(db, old_parent, new_parent)
    await db.commit()

    cursor = await db.execute(
        "SELECT source_document_id, target_document_id FROM document_links ORDER BY id"
    )
    rows = await cursor.fetchall()
    assert {(r[0], r[1]) for r in rows} == {(new_parent, a), (b, new_parent)}


@pytest.mark.asyncio
async def test_migrate_handles_unique_collision(db):
    """Old parent has the same (target, link_type) as new parent. The
    rewrite would violate the UNIQUE constraint; helper drops the dupe first."""
    patient = await _seed_patient(db)
    a = await _seed_doc(db, patient, "a.pdf")
    old_parent = await _seed_doc(db, patient, "old.pdf", doc_type="imaging_report", file_path="")
    new_parent = await _seed_doc(db, patient, "new.pdf", doc_type="imaging_report")

    await db.execute(
        "INSERT INTO document_links (source_document_id, target_document_id, link_type) VALUES (?, ?, 'related')",
        (old_parent, a),
    )
    await db.execute(
        "INSERT INTO document_links (source_document_id, target_document_id, link_type) VALUES (?, ?, 'related')",
        (new_parent, a),
    )
    await db.commit()

    await migrate_document_links(db, old_parent, new_parent)
    await db.commit()

    cursor = await db.execute("SELECT source_document_id, target_document_id FROM document_links")
    rows = await cursor.fetchall()
    assert len(rows) == 1
    assert rows[0][0] == new_parent and rows[0][1] == a


@pytest.mark.asyncio
async def test_migrate_avoids_self_loop(db):
    """A pre-existing OLD↔NEW link must be deleted before the rewrite,
    otherwise the rewrite would set source = target."""
    patient = await _seed_patient(db)
    old_parent = await _seed_doc(db, patient, "old.pdf", doc_type="imaging_report", file_path="")
    new_parent = await _seed_doc(db, patient, "new.pdf", doc_type="imaging_report")

    await db.execute(
        "INSERT INTO document_links (source_document_id, target_document_id, link_type) VALUES (?, ?, 'related')",
        (old_parent, new_parent),
    )
    await db.commit()

    await migrate_document_links(db, old_parent, new_parent)
    await db.commit()

    cursor = await db.execute(
        "SELECT COUNT(*) FROM document_links WHERE source_document_id = target_document_id"
    )
    (count,) = await cursor.fetchone()
    assert count == 0


@pytest.mark.asyncio
async def test_migrate_noop_for_missing_or_equal_ids(db):
    """Empty / equal ids are silent no-ops."""
    patient = await _seed_patient(db)
    a = await _seed_doc(db, patient, "a.pdf")
    await migrate_document_links(db, None, a)
    await migrate_document_links(db, a, None)
    await migrate_document_links(db, a, a)
    # Nothing exploded.


@pytest.mark.asyncio
async def test_get_document_links_appends_synthetic_imaging_entry(db):
    """When a document is the parent of an imaging study, get_document_links
    surfaces the imaging as a synthetic row (id=None, link_type=imaging_report)
    so the document-page LinksSection shows it in 'Linked documents' too."""
    patient = await _seed_patient(db)
    parent = await _seed_doc(db, patient, "report.pdf", doc_type="imaging_report")
    study = await _seed_imaging(db, patient, parent)
    await db.commit()

    links = await get_document_links(db, parent)

    synthetic = [r for r in links if r["id"] is None]
    assert len(synthetic) == 1
    s = synthetic[0]
    assert s["link_type"] == "imaging_report"
    assert s["target_imaging_study_id"] == study
    assert s["target_modality"] == "MR"
    assert s["target_body_part"] == "brain"


@pytest.mark.asyncio
async def test_get_document_links_enriches_imaging_parent(db):
    """When a real link points to a document that parents an imaging study,
    the row carries source_/target_imaging_study_id so the UI can badge it."""
    patient = await _seed_patient(db)
    a = await _seed_doc(db, patient, "a.pdf")
    parent = await _seed_doc(db, patient, "report.pdf", doc_type="imaging_report")
    study = await _seed_imaging(db, patient, parent)
    await db.execute(
        "INSERT INTO document_links (source_document_id, target_document_id, link_type) VALUES (?, ?, 'related')",
        (a, parent),
    )
    await db.commit()

    links = await get_document_links(db, a)
    real = [r for r in links if r["id"] is not None]
    assert len(real) == 1
    row = real[0]
    assert row["target_imaging_study_id"] == study
    assert row["target_modality"] == "MR"


@pytest.mark.asyncio
async def test_links_survive_attach_report_simulation(db):
    """Simulates the headline regression: imaging starts with placeholder P,
    user links docs A and B against P, then a report PDF C is attached
    (P is deleted, study repointed at C). After migrate_document_links runs,
    A and B must still be reachable via C's links."""
    patient = await _seed_patient(db)
    a = await _seed_doc(db, patient, "a.pdf")
    b = await _seed_doc(db, patient, "b.pdf")
    placeholder = await _seed_doc(
        db,
        patient,
        "placeholder.pdf",
        doc_type="imaging_report",
        file_path="",
    )
    study = await _seed_imaging(db, patient, placeholder)
    real_pdf = await _seed_doc(db, patient, "report.pdf", doc_type="imaging_report")

    # User links A and B against the imaging (which means against the
    # placeholder, since LinksSection uses the parent doc's id).
    await db.execute(
        "INSERT INTO document_links (source_document_id, target_document_id, link_type) VALUES (?, ?, 'related')",
        (placeholder, a),
    )
    await db.execute(
        "INSERT INTO document_links (source_document_id, target_document_id, link_type) VALUES (?, ?, 'related')",
        (placeholder, b),
    )
    await db.commit()

    # Simulate attach_imaging_report: repoint the study, migrate links,
    # delete the placeholder. Order matches imaging/routes.py.
    await db.execute(
        "UPDATE imaging_studies SET document_id = ?, report_status = 'attached' WHERE id = ?",
        (real_pdf, study),
    )
    await migrate_document_links(db, placeholder, real_pdf)
    await db.execute("DELETE FROM documents WHERE id = ?", (placeholder,))
    await db.commit()

    # Reading from the new parent should still surface A and B.
    links = await get_document_links(db, real_pdf)
    real_links = [r for r in links if r["id"] is not None]
    targets = {r["target_document_id"] for r in real_links}
    assert {a, b}.issubset(targets), f"links lost across parent swap; got {targets}"
