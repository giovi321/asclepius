"""Zip upload extraction tests.

Covers the pieces of ``upload_routes._extract_zip`` that are easy to break
in isolation:
  - DICOM magic-byte detection (extension-less files renamed to ``.dcm``)
  - non-DICOM members tagged ``.bin`` with the ``.zip_member`` sidecar
  - Zip-Slip protection (members named ``../etc/passwd`` are skipped)
  - zip-bomb protection (uncompressed-size cap is enforced)
  - happy-path HTTP upload of a small DICOM bundle
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import aiosqlite
import pytest

from asclepius.documents.upload_routes import (
    _extract_zip,
    _is_dicom_file,
    _is_zip_upload,
)


def _dicom_bytes(payload: bytes = b"") -> bytes:
    """Minimal byte string that satisfies the DICOM preamble check.

    The real DICOM format starts with 128 zero bytes followed by ``DICM``.
    We don't need a parseable file — only ``_is_dicom_file`` is exercised.
    """
    return b"\0" * 128 + b"DICM" + payload


def _make_zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


class _ServerCfg:
    max_zip_uncompressed_bytes = 4 * 1024 * 1024


class _Cfg:
    server = _ServerCfg()


def test_is_dicom_file_detects_magic(tmp_path: Path):
    p = tmp_path / "I1000000"
    p.write_bytes(_dicom_bytes(b"pixel-data"))
    assert _is_dicom_file(p) is True


def test_is_dicom_file_rejects_non_dicom(tmp_path: Path):
    p = tmp_path / "image.jpg"
    p.write_bytes(b"\xff\xd8\xff\xe0" + b"\0" * 200)
    assert _is_dicom_file(p) is False


def test_is_zip_upload_by_mime():
    assert _is_zip_upload("application/zip", Path("foo.zip"))
    assert _is_zip_upload("application/x-zip-compressed", Path("foo.zip"))
    assert not _is_zip_upload("application/pdf", Path("foo.pdf"))


def test_extract_zip_renames_dicom_and_tags_other(tmp_path: Path):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    zip_path = tmp_path / "exam.zip"
    zip_path.write_bytes(
        _make_zip(
            {
                "exam/MHQR/I1000000": _dicom_bytes(b"frame-1"),
                "exam/MHQR/I1100000": _dicom_bytes(b"frame-2"),
                "exam/DICOMDIR": b"DICOMDIR-manifest-bytes",
                "exam/jpeg/preview_001.jpg": b"\xff\xd8\xff\xe0" + b"\0" * 100,
                "exam/LOCKFILE": b"",
                "exam/VERSION": b"1.0",
            }
        )
    )

    summary = _extract_zip(
        zip_path=zip_path,
        inbox=inbox,
        config=_Cfg(),
        patient_id=42,
        event_id=None,
    )

    assert summary["extracted"] == 6
    assert summary["dicom"] == 2
    assert summary["other"] == 4

    # The two DICOM members should have been renamed to .dcm so the
    # inbox watcher will pick them up.
    extracted = sorted(p.relative_to(inbox).as_posix() for p in inbox.rglob("*") if p.is_file())
    dcm_files = [p for p in extracted if p.endswith(".dcm")]
    assert len(dcm_files) == 2

    # Non-DICOM members must be tagged ``.bin`` with a ``.zip_member`` sidecar
    # carrying the original filename so the passthrough handler can restore it.
    bin_files = [p for p in extracted if p.endswith(".bin")]
    assert len(bin_files) == 4
    for bin_rel in bin_files:
        sidecar = inbox / f"{bin_rel}.zip_member"
        assert sidecar.exists(), f"missing sidecar for {bin_rel}"
        meta = json.loads(sidecar.read_text())
        assert "original_name" in meta
        assert meta["zip_stem"]  # non-empty

    # Patient hint should be next to every member (DICOM and bin alike).
    hint_files = [p for p in inbox.rglob("*.patient_hint")]
    assert len(hint_files) == 6
    for h in hint_files:
        assert h.read_text().strip() == "42"


def test_extract_zip_rejects_zip_slip(tmp_path: Path):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    zip_path = tmp_path / "evil.zip"
    zip_path.write_bytes(
        _make_zip(
            {
                "../../etc/passwd": b"root:x:0:0::/root:/bin/bash\n",
                "good.dcm": _dicom_bytes(b"ok"),
            }
        )
    )

    summary = _extract_zip(
        zip_path=zip_path,
        inbox=inbox,
        config=_Cfg(),
        patient_id=None,
        event_id=None,
    )

    # The good DICOM was extracted; the traversal entry was either skipped
    # or had its traversal markers stripped — but in no case must any file
    # land outside the inbox tree.
    assert summary["dicom"] == 1
    assert not (tmp_path / "etc" / "passwd").exists()
    assert not (tmp_path.parent / "etc" / "passwd").exists()
    # Every extracted file must live under the inbox.
    for p in inbox.rglob("*"):
        if p.is_file():
            assert (
                inbox.resolve() in p.resolve().parents
                or p.resolve().parent == inbox.resolve()
                or inbox.resolve() in p.resolve().parents
            )


def test_extract_zip_enforces_uncompressed_cap(tmp_path: Path):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    zip_path = tmp_path / "big.zip"
    # Two 1 MiB members — well under any real cap, but we set the cap to 1 MiB
    # so the second member trips the limit.
    big = b"A" * (1024 * 1024)
    zip_path.write_bytes(
        _make_zip(
            {
                "first.bin": big,
                "second.bin": big,
            }
        )
    )

    class TinyServer:
        max_zip_uncompressed_bytes = 1024 * 1024  # only one member fits

    class TinyCfg:
        server = TinyServer()

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        _extract_zip(
            zip_path=zip_path,
            inbox=inbox,
            config=TinyCfg(),
            patient_id=None,
            event_id=None,
        )
    assert exc.value.status_code == 413


@pytest.fixture
def _patch_mime(monkeypatch):
    """Force libmagic to report a zip mime so the upload path is exercised
    without depending on the Windows libmagic DLL (which crashes the
    interpreter on some 3.14 builds)."""
    from asclepius.documents import upload_routes

    monkeypatch.setattr(upload_routes, "_detect_mime", lambda _path: "application/zip")
    yield


@pytest.mark.asyncio
async def test_upload_zip_endpoint_extracts(client, db_path, tmp_vault, _patch_mime):
    """End-to-end: POST a small DICOM zip and assert the inbox holds the
    extracted members ready for the watcher."""
    # Seed a patient + access so the upload route accepts ``patient_id``.
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('zip-pat', 'Zip Patient')"
        )
        patient_id = cursor.lastrowid
        user_cur = await db.execute("SELECT id FROM users WHERE username = 'admin'")
        user = await user_cur.fetchone()
        await db.execute(
            "INSERT INTO user_patient_access (user_id, patient_id, role) " "VALUES (?, ?, 'owner')",
            (user[0], patient_id),
        )
        await db.commit()

    zip_bytes = _make_zip(
        {
            "exam/I1000000": _dicom_bytes(b"frame-a"),
            "exam/I1100000": _dicom_bytes(b"frame-b"),
            "exam/DICOMDIR": b"DICOMDIR-manifest",
        }
    )

    resp = await client.post(
        f"/api/documents/upload?patient_id={patient_id}",
        files={"file": ("exam.zip", zip_bytes, "application/zip")},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["extracted"] == 3
    assert body["dicom"] == 2
    assert body["other"] == 1

    # Inbox should now contain two .dcm files and one .bin (DICOMDIR).
    inbox = Path(tmp_vault) / "inbox"
    dcm = list(inbox.rglob("*.dcm"))
    bins = list(inbox.rglob("*.bin"))
    assert len(dcm) == 2
    assert len(bins) == 1
    # The original .zip should be gone.
    assert not list(inbox.rglob("*.zip"))


@pytest.mark.asyncio
async def test_upload_zip_dedupe_on_resubmit(client, db_path, tmp_vault, _patch_mime):
    """Re-uploading an identical zip must not duplicate vault content.

    The first upload extracts everything into a fresh sub-folder; the second
    upload extracts again into a different sub-folder (counter suffix) — the
    pipeline's ``file_hash`` UNIQUE constraint is what de-dupes downstream.
    Here we only check the extraction step does not crash on a repeat.
    """
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('dedup-pat', 'Dedup Patient')"
        )
        patient_id = cursor.lastrowid
        user_cur = await db.execute("SELECT id FROM users WHERE username = 'admin'")
        user = await user_cur.fetchone()
        await db.execute(
            "INSERT INTO user_patient_access (user_id, patient_id, role) " "VALUES (?, ?, 'owner')",
            (user[0], patient_id),
        )
        await db.commit()

    zip_bytes = _make_zip({"I1000000": _dicom_bytes(b"only-frame")})

    for _ in range(2):
        resp = await client.post(
            f"/api/documents/upload?patient_id={patient_id}",
            files={"file": ("exam.zip", zip_bytes, "application/zip")},
        )
        assert resp.status_code == 201, resp.text

    # Two distinct extraction folders, one .dcm in each.
    inbox = Path(tmp_vault) / "inbox"
    dcm_files = list(inbox.rglob("*.dcm"))
    assert len(dcm_files) == 2
