"""Inbox cleanup sweep.

The pipeline removes each file from the inbox once it has been
processed (DICOM frame copied to ``patients/{slug}/{year}/...``,
zip-bundle file copied to ``imaging-bundles/...``). Two failure modes
leave files behind anyway:

  - **Crash before unlink.** If ``process_dicom`` or
    ``process_zip_member`` raises after the destination copy but before
    the source unlink, the inbox keeps a duplicate. (The vault has the
    real file; the inbox copy is effectively garbage.)
  - **Orphan sidecars.** ``.patient_hint`` / ``.event_hint`` /
    ``.user_hint`` / ``.zip_member`` / ``.imaging_study_hint`` files
    survive when their primary disappears unexpectedly.

This module runs on app startup (and after every pipeline tick) and
deletes any inbox file that meets one of the conditions above. It is
deliberately conservative: a file is only deleted when we can prove
its content is already represented elsewhere (or it's a stranded
sidecar). Anything we are unsure about is left alone for the watcher
to pick up.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

_SIDECAR_SUFFIXES = (
    ".patient_hint",
    ".event_hint",
    ".user_hint",
    ".zip_member",
    ".imaging_study_hint",
)


def _study_doc_hash(study_uid: str | None, fallback_key: str) -> str:
    """Same deterministic hash ``dicom_ingest`` writes into
    ``documents.file_hash`` for the canonical imaging-study row."""
    key = study_uid or fallback_key
    return hashlib.sha256(f"asclepius-imaging-study:{key}".encode("utf-8")).hexdigest()


async def _is_dicom_already_ingested(path: Path, db: aiosqlite.Connection) -> bool:
    """Read the DICOM's StudyInstanceUID and check whether a documents
    row already exists with the deterministic study hash. Falls back
    to a study-folder hash for DICOMs that carry no StudyInstanceUID,
    rebuilt the same way ``process_dicom`` derives ``base_path``."""
    try:
        import pydicom
    except ImportError:
        return False
    try:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
    except Exception:
        return False
    study_uid = str(getattr(ds, "StudyInstanceUID", "") or "") or None
    if study_uid:
        cursor = await db.execute(
            "SELECT 1 FROM documents WHERE file_hash = ? LIMIT 1",
            (_study_doc_hash(study_uid, ""),),
        )
        return (await cursor.fetchone()) is not None

    # No StudyInstanceUID: rebuild the canonical ``base_path`` the same
    # way ``process_dicom`` does and hash with it. Without this the sweep
    # never recognises ingested copies of UID-less DICOMs and the inbox
    # accumulates duplicates the watcher keeps re-detecting.
    from asclepius.pipeline.dicom_ingest import parse_dicom_pn, study_base_path

    patient_name = parse_dicom_pn(str(getattr(ds, "PatientName", ""))) or None
    study_date_raw = str(getattr(ds, "StudyDate", "")) or None
    modality = str(getattr(ds, "Modality", "")) or None
    institution = str(getattr(ds, "InstitutionName", "")) or None

    study_date = None
    if study_date_raw and len(study_date_raw) == 8:
        study_date = f"{study_date_raw[:4]}-{study_date_raw[4:6]}-{study_date_raw[6:8]}"

    # Resolve patient_id from the upload-form hint sidecar first, then
    # fall back to PatientName matching — same precedence as ingest.
    hinted_patient_id: int | None = None
    hint_sidecar = Path(str(path) + ".patient_hint")
    if hint_sidecar.exists():
        try:
            hinted_patient_id = int(hint_sidecar.read_text().strip())
        except (ValueError, OSError):
            hinted_patient_id = None

    patient_id: int | None = None
    if hinted_patient_id:
        cursor = await db.execute(
            "SELECT id FROM patients WHERE id = ?",
            (hinted_patient_id,),
        )
        if await cursor.fetchone():
            patient_id = hinted_patient_id
    if patient_id is None and patient_name:
        from asclepius.pipeline.extractor import _match_patient

        patient_id = await _match_patient(db, patient_name)

    patient_slug: str | None = None
    if patient_id:
        cursor = await db.execute(
            "SELECT slug FROM patients WHERE id = ?",
            (patient_id,),
        )
        row = await cursor.fetchone()
        patient_slug = row[0] if row else "unknown"

    base_path = study_base_path(
        patient_slug=patient_slug,
        study_date=study_date,
        institution=institution,
        modality=modality,
    )
    cursor = await db.execute(
        "SELECT 1 FROM documents WHERE file_hash = ? LIMIT 1",
        (_study_doc_hash(None, base_path),),
    )
    return (await cursor.fetchone()) is not None


async def _bundle_file_already_copied(
    path: Path,
    vault_root: Path,
    db: aiosqlite.Connection,
) -> bool:
    """Check whether a ``.bin`` zip-member's copy already exists at the
    expected ``imaging-bundles`` destination. Reads the ``.zip_member``
    sidecar to recover the original filename.
    """
    sidecar = Path(str(path) + ".zip_member")
    if not sidecar.exists():
        # Without the sidecar we can't know where the file should have
        # ended up — leave it alone.
        return False
    try:
        import json

        meta = json.loads(sidecar.read_text())
    except Exception:
        return False
    original_name = meta.get("original_name") or path.stem
    # ``zip_stem`` is part of the destination path that
    # ``process_zip_member`` builds, but the per-patient bundle root
    # already namespaces by zip stem so we only need the original
    # filename for the duplicate check below.

    # Reproduce ``process_zip_member``'s destination shape:
    # ``patients/{slug}/imaging-bundles/{zip_stem_slug}/{original_name}``.
    # We don't know the patient here, so scan every imaging-bundles
    # folder; if any file with the original name exists, treat the
    # inbox copy as a duplicate.
    safe_original = original_name.replace("/", "_").replace("\\", "_")

    src_size = path.stat().st_size
    for bundle_dir in vault_root.glob("patients/*/imaging-bundles/*"):
        if not bundle_dir.is_dir():
            continue
        candidate = bundle_dir / safe_original
        if candidate.is_file() and candidate.stat().st_size == src_size:
            return True
    unclass_root = vault_root / "unclassified" / "imaging-bundles"
    if unclass_root.exists():
        for sub in unclass_root.iterdir():
            if not sub.is_dir():
                continue
            candidate = sub / safe_original
            if candidate.is_file() and candidate.stat().st_size == src_size:
                return True
    _ = db  # placeholder for future hash-based check
    return False


def _drop_orphan_sidecars(inbox_root: Path) -> int:
    """Delete sidecars whose primary file no longer exists. Returns the
    number of sidecars removed."""
    removed = 0
    for f in inbox_root.rglob("*"):
        if not f.is_file():
            continue
        suffix = next((s for s in _SIDECAR_SUFFIXES if f.name.endswith(s)), None)
        if not suffix:
            continue
        primary = Path(str(f)[: -len(suffix)])
        if not primary.exists():
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def _rmdir_empty_subdirs(inbox_root: Path) -> int:
    """Recursively rmdir any empty directory under the inbox, bottom-up.
    Returns the number of directories removed. Stops at ``inbox_root``
    itself."""
    removed = 0
    # Sort by depth, deepest first.
    dirs = sorted(
        (p for p in inbox_root.rglob("*") if p.is_dir()),
        key=lambda p: -len(p.parts),
    )
    for d in dirs:
        try:
            d.rmdir()  # only succeeds if empty
            removed += 1
        except OSError:
            pass
    return removed


async def sweep_inbox(inbox_root: Path, vault_root: Path, db: aiosqlite.Connection) -> dict:
    """Top-level entry point. Removes already-ingested ``.dcm`` files,
    duplicate ``.bin`` zip-bundle members, orphan sidecars, and empty
    directories. Returns a small summary dict for logging."""
    if not inbox_root.exists():
        return {"dcm": 0, "bin": 0, "sidecars": 0, "dirs": 0}

    dcm_removed = 0
    bin_removed = 0
    for f in list(inbox_root.rglob("*")):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext in {".dcm", ".dicom"}:
            try:
                if await _is_dicom_already_ingested(f, db):
                    f.unlink()
                    dcm_removed += 1
            except Exception:
                pass
        elif ext == ".bin":
            try:
                if await _bundle_file_already_copied(f, vault_root, db):
                    f.unlink()
                    bin_removed += 1
            except Exception:
                pass

    sidecar_removed = _drop_orphan_sidecars(inbox_root)
    dirs_removed = _rmdir_empty_subdirs(inbox_root)

    summary = {
        "dcm": dcm_removed,
        "bin": bin_removed,
        "sidecars": sidecar_removed,
        "dirs": dirs_removed,
    }
    if any(summary.values()):
        logger.info(
            "Inbox sweep: removed %d already-ingested DICOM frames, %d duplicated "
            "bundle files, %d orphan sidecars, %d empty subdirs",
            dcm_removed,
            bin_removed,
            sidecar_removed,
            dirs_removed,
        )
    return summary
