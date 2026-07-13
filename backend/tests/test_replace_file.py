"""Tests for POST /api/documents/{id}/replace-file.

The endpoint swaps the stored file for a new one WITHOUT re-running the
pipeline: the document keeps its OCR text, extraction, and child rows.
The replacement may be a different file type (an image scan replaced by
the original PDF is the primary use case); file_hash, page_count and
original_filename are recomputed and the superseded file is deleted.
"""

import hashlib

import aiosqlite
import fitz
import pytest


def _png_bytes(size: int = 8, val: int = 255) -> bytes:
    """Return PNG-encoded bytes (vary size/val for a distinct hash)."""
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, size, size))
    pix.clear_with(val)
    return pix.tobytes("png")


def _make_png(path) -> None:
    """Write a small valid PNG."""
    from pathlib import Path as _P

    _P(str(path)).write_bytes(_png_bytes())


def _make_pdf_bytes(pages: int = 2) -> bytes:
    """Return bytes of a valid multi-page PDF (fitz can count its pages)."""
    doc = fitz.open()
    for _ in range(pages):
        doc.new_page()
    data = doc.tobytes()
    doc.close()
    return data


# The endpoint's real MIME guard uses libmagic (python-magic). We stub it
# here so the tests are deterministic and don't depend on a working native
# libmagic install (it segfaults on some Windows setups). The stub maps by
# extension; individual tests override it to force an unsupported type.
def _fake_mime_by_ext(path) -> str:
    from pathlib import Path as _P

    return {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }.get(_P(str(path)).suffix.lower(), "application/octet-stream")


@pytest.fixture(autouse=True)
def _stub_detect_mime(monkeypatch):
    import asclepius.documents.upload_routes as up

    monkeypatch.setattr(up, "_detect_mime", _fake_mime_by_ext)
    return monkeypatch


async def _seed_doc(
    db_path,
    tmp_vault,
    *,
    slug="rf-patient",
    grant_user_id=None,
    grant_role="owner",
    with_lab=True,
):
    """Create a patient + PNG-backed document on disk. Returns (patient_id, doc_id, rel_path)."""
    rel_path = f"patients/{slug}/2024/scan.png"
    file_abs = tmp_vault / rel_path
    file_abs.parent.mkdir(parents=True, exist_ok=True)
    _make_png(file_abs)
    file_hash = hashlib.sha256(file_abs.read_bytes()).hexdigest()

    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)",
            (slug, slug),
        )
        patient_id = cursor.lastrowid
        if grant_user_id is not None:
            await db.execute(
                "INSERT INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, ?)",
                (grant_user_id, patient_id, grant_role),
            )
        cursor = await db.execute(
            """INSERT INTO documents
                 (patient_id, file_path, original_filename, doc_type, status,
                  ocr_text, file_hash, file_size, page_count, uploaded_by_user_id)
               VALUES (?, ?, 'scan.png', 'lab_test', 'done',
                       'Hemoglobin 14.5 g/dL', ?, ?, 1, NULL)""",
            (patient_id, rel_path, file_hash, file_abs.stat().st_size),
        )
        doc_id = cursor.lastrowid
        if with_lab:
            await db.execute(
                """INSERT INTO lab_results
                     (document_id, patient_id, test_name_original, value, unit, is_abnormal)
                   VALUES (?, ?, 'Hemoglobin', 14.5, 'g/dL', 0)""",
                (doc_id, patient_id),
            )
        await db.commit()
    return patient_id, doc_id, rel_path


@pytest.mark.asyncio
async def test_replace_image_with_pdf_keeps_data(client, db_path, tmp_vault):
    _, doc_id, old_rel = await _seed_doc(db_path, tmp_vault)
    old_abs = tmp_vault / old_rel
    assert old_abs.exists()

    pdf = _make_pdf_bytes(pages=2)
    resp = await client.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("original.pdf", pdf, "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # File identity recomputed to match the new bytes.
    assert data["original_filename"] == "scan.pdf"  # base name kept, new ext
    assert data["page_count"] == 2
    assert data["file_size"] == len(pdf)
    assert data["file_path"].endswith(".pdf")

    # Derived data untouched — the whole point of replace (no reprocess).
    assert data["ocr_text"] == "Hemoglobin 14.5 g/dL"

    detail = (await client.get(f"/api/documents/{doc_id}")).json()
    assert len(detail["lab_results"]) == 1
    assert detail["lab_results"][0]["test_name_original"] == "Hemoglobin"

    # Old file gone, new file present with matching hash.
    assert not old_abs.exists()
    new_abs = tmp_vault / data["file_path"]
    assert new_abs.exists()
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute(
            "SELECT file_hash FROM documents WHERE id = ?", (doc_id,)
        )).fetchone()
    assert row["file_hash"] == hashlib.sha256(pdf).hexdigest()


@pytest.mark.asyncio
async def test_replace_duplicate_hash_rejected(client, db_path, tmp_vault):
    _, doc_id, old_rel = await _seed_doc(db_path, tmp_vault)
    pdf = _make_pdf_bytes(pages=1)
    pdf_hash = hashlib.sha256(pdf).hexdigest()

    # A different document already owns these exact bytes.
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute(
            """INSERT INTO documents (file_path, original_filename, status, file_hash)
               VALUES ('unclassified/other.pdf', 'other.pdf', 'done', ?)""",
            (pdf_hash,),
        )
        await db.commit()

    resp = await client.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("original.pdf", pdf, "application/pdf")},
    )
    assert resp.status_code == 409, resp.text

    # The original file and record are untouched.
    assert (tmp_vault / old_rel).exists()
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute(
            "SELECT file_path, original_filename FROM documents WHERE id = ?", (doc_id,)
        )).fetchone()
    assert row["file_path"] == old_rel
    assert row["original_filename"] == "scan.png"


@pytest.mark.asyncio
async def test_replace_unsupported_mime_rejected(client, db_path, tmp_vault, monkeypatch):
    _, doc_id, old_rel = await _seed_doc(db_path, tmp_vault)
    # Force the MIME guard to see a disallowed type regardless of extension.
    import asclepius.documents.upload_routes as up

    monkeypatch.setattr(up, "_detect_mime", lambda _p: "text/plain")
    resp = await client.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("note.txt", b"just some plain text, not a document", "text/plain")},
    )
    assert resp.status_code == 415, resp.text
    # Original untouched and no stray temp file left behind (only the .png).
    assert (tmp_vault / old_rel).exists()
    dest_dir = (tmp_vault / old_rel).parent
    assert [p.name for p in dest_dir.iterdir()] == ["scan.png"]


@pytest.mark.asyncio
async def test_replace_requires_extension(client, db_path, tmp_vault):
    _, doc_id, _ = await _seed_doc(db_path, tmp_vault)
    resp = await client.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("noext", _make_pdf_bytes(), "application/pdf")},
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_replace_not_found(client):
    resp = await client.post(
        "/api/documents/99999/replace-file",
        files={"file": ("x.pdf", _make_pdf_bytes(), "application/pdf")},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_replace_viewer_grant_rejected(client, make_user_client, db_path, tmp_vault):
    viewer, viewer_id = await make_user_client("rf-viewer", role="viewer")
    _, doc_id, old_rel = await _seed_doc(
        db_path, tmp_vault, grant_user_id=viewer_id, grant_role="viewer"
    )
    resp = await viewer.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("original.pdf", _make_pdf_bytes(), "application/pdf")},
    )
    assert resp.status_code == 403, resp.text
    assert (tmp_vault / old_rel).exists()


@pytest.mark.asyncio
async def test_replace_owner_grant_allowed(client, make_user_client, db_path, tmp_vault):
    owner, owner_id = await make_user_client("rf-owner", role="viewer")
    _, doc_id, _ = await _seed_doc(
        db_path, tmp_vault, slug="rf-owner-patient",
        grant_user_id=owner_id, grant_role="owner",
    )
    resp = await owner.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("original.pdf", _make_pdf_bytes(), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_replace_same_extension_disambiguates(client, db_path, tmp_vault):
    """png -> png: the destination collides with the existing on-disk file,
    so the name is disambiguated and the old file is then deleted."""
    _, doc_id, old_rel = await _seed_doc(db_path, tmp_vault)
    old_abs = tmp_vault / old_rel
    assert old_abs.exists()

    resp = await client.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("better.png", _png_bytes(size=16, val=128), "image/png")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Disambiguated on-disk name, but the display name keeps the base + ext.
    assert data["file_path"].endswith("scan-2.png")
    assert data["original_filename"] == "scan.png"
    # Old file removed, disambiguated file present, data preserved.
    assert not old_abs.exists()
    assert (tmp_vault / data["file_path"]).exists()
    assert data["ocr_text"] == "Hemoglobin 14.5 g/dL"


@pytest.mark.asyncio
async def test_replace_does_not_delete_cross_patient_file(client, db_path, tmp_vault):
    """If file_path was repointed (as /relink allows) at another patient's
    file, replace must NOT delete that file — it is out of the document's own
    scope and still referenced by the other document."""
    victim_rel = "patients/victim/2024/report.pdf"
    victim_abs = tmp_vault / victim_rel
    victim_abs.parent.mkdir(parents=True, exist_ok=True)
    victim_abs.write_bytes(_make_pdf_bytes(1))

    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        vic = (await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('victim', 'Victim')"
        )).lastrowid
        att = (await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('attacker', 'Attacker')"
        )).lastrowid
        # Victim's document legitimately owns the file.
        await db.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename, status, file_hash)
               VALUES (?, ?, 'report.pdf', 'done', 'victimhash')""",
            (vic, victim_rel),
        )
        # Attacker's document has been repointed at the victim's file.
        cur = await db.execute(
            """INSERT INTO documents (patient_id, file_path, original_filename, status, file_hash)
               VALUES (?, ?, 'scan.png', 'done', 'attackerhash')""",
            (att, victim_rel),
        )
        att_doc = cur.lastrowid
        await db.commit()

    resp = await client.post(
        f"/api/documents/{att_doc}/replace-file",
        files={"file": ("x.pdf", _make_pdf_bytes(3), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text

    # The victim's file and record are untouched.
    assert victim_abs.exists()
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute(
            "SELECT file_path FROM documents WHERE patient_id = ? AND original_filename = 'report.pdf'",
            (vic,),
        )).fetchone()
    assert row["file_path"] == victim_rel


@pytest.mark.asyncio
async def test_replace_missing_file_uses_patient_year_fallback(client, db_path, tmp_vault):
    """A document with no file_path (e.g. a placeholder) lands under
    patients/{slug}/{year} and attempts no old-file deletion."""
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        pid = (await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('fb-patient', 'FB')"
        )).lastrowid
        cur = await db.execute(
            """INSERT INTO documents
                 (patient_id, file_path, original_filename, status, event_date, file_hash)
               VALUES (?, '', 'missing.png', 'done', '2023-05-01', 'fbhash')""",
            (pid,),
        )
        doc_id = cur.lastrowid
        await db.commit()

    resp = await client.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("original.pdf", _make_pdf_bytes(2), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["file_path"].startswith("patients/fb-patient/2023/")
    assert data["file_path"].endswith("missing.pdf")
    assert data["page_count"] == 2


@pytest.mark.asyncio
async def test_replace_missing_file_unclassified_fallback(client, db_path, tmp_vault):
    """No patient and no file_path -> the replacement lands in unclassified."""
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cur = await db.execute(
            """INSERT INTO documents (file_path, original_filename, status, file_hash)
               VALUES ('', 'loose.png', 'done', 'unclhash')"""
        )
        doc_id = cur.lastrowid
        await db.commit()

    resp = await client.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("original.pdf", _make_pdf_bytes(1), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["file_path"].startswith("unclassified/")
    assert data["file_path"].endswith("loose.pdf")


@pytest.mark.asyncio
async def test_replace_writes_audit_log(client, db_path, tmp_vault):
    _, doc_id, _ = await _seed_doc(db_path, tmp_vault)
    resp = await client.post(
        f"/api/documents/{doc_id}/replace-file",
        files={"file": ("original.pdf", _make_pdf_bytes(), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute(
            "SELECT action, resource_id FROM audit_log "
            "WHERE action = 'document.replace-file' AND resource_id = ?",
            (doc_id,),
        )).fetchone()
    assert row is not None
    assert row["resource_id"] == doc_id
