"""DICOM file processing and metadata extraction."""

import json
import logging
import os
import shutil
from pathlib import Path

import aiosqlite

from asclepius.config import AppConfig
from asclepius.documents.service import compute_file_hash

logger = logging.getLogger(__name__)


async def process_dicom(
    file_path: str,
    config: AppConfig,
    db: aiosqlite.Connection,
) -> int | None:
    """Process a DICOM file: extract metadata, organize, and write to DB.

    Returns: document ID or None on failure.
    """
    try:
        import pydicom
    except ImportError:
        logger.error("pydicom not installed, cannot process DICOM files")
        return None

    path = Path(file_path)

    # Sidecars from the upload route. ``patient_hint`` reflects an explicit
    # user choice on the upload form and should outrank whatever PatientName
    # the DICOM file carries (lab exports often store the name in a format
    # that ``_match_patient`` cannot reconcile, which would otherwise leave
    # the study in unclassified/).
    patient_hint_path = Path(str(path) + ".patient_hint")
    hinted_patient_id: int | None = None
    if patient_hint_path.exists():
        try:
            hinted_patient_id = int(patient_hint_path.read_text().strip())
        except (ValueError, OSError):
            hinted_patient_id = None

    event_hint_path = Path(str(path) + ".event_hint")
    hinted_event_id: int | None = None
    if event_hint_path.exists():
        try:
            hinted_event_id = int(event_hint_path.read_text().strip())
        except (ValueError, OSError):
            hinted_event_id = None

    try:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True)
    except Exception:
        logger.exception("Failed to read DICOM file: %s", path.name)
        # Drop the sidecars so they do not pile up in the inbox.
        patient_hint_path.unlink(missing_ok=True)
        event_hint_path.unlink(missing_ok=True)
        return None

    # Extract metadata
    patient_name = str(getattr(ds, "PatientName", "")) or None
    study_date_raw = str(getattr(ds, "StudyDate", "")) or None
    modality = str(getattr(ds, "Modality", "")) or None
    body_part = str(getattr(ds, "BodyPartExamined", "")) or None
    study_desc = str(getattr(ds, "StudyDescription", "")) or None
    institution = str(getattr(ds, "InstitutionName", "")) or None
    referring = str(getattr(ds, "ReferringPhysicianName", "")) or None
    accession = str(getattr(ds, "AccessionNumber", "")) or None
    study_uid = str(getattr(ds, "StudyInstanceUID", "")) or None
    series_uid = str(getattr(ds, "SeriesInstanceUID", "")) or None
    series_number = getattr(ds, "SeriesNumber", None)
    series_desc = str(getattr(ds, "SeriesDescription", "")) or None

    # Format study date
    study_date = None
    if study_date_raw and len(study_date_raw) == 8:
        study_date = f"{study_date_raw[:4]}-{study_date_raw[4:6]}-{study_date_raw[6:8]}"

    # Try to match patient. An explicit upload-form selection wins over any
    # heuristic match against the DICOM PatientName tag.
    patient_id: int | None = None
    if hinted_patient_id:
        cursor = await db.execute(
            "SELECT id FROM patients WHERE id = ?", (hinted_patient_id,),
        )
        if await cursor.fetchone():
            patient_id = hinted_patient_id
    if patient_id is None and patient_name:
        from asclepius.pipeline.extractor import _match_patient
        patient_id = await _match_patient(db, patient_name)

    # Upsert facility from institution name
    facility_id = None
    if institution:
        from asclepius.pipeline.extractor import _upsert_facility
        facility_id = await _upsert_facility(db, {"name": institution, "type": "imaging_center"})

    # Upsert doctor from referring physician
    doctor_id = None
    if referring:
        from asclepius.pipeline.extractor import _upsert_doctor
        doctor_id = await _upsert_doctor(db, {"name": referring}, facility_id)

    # Determine destination path
    from asclepius.patients.service import slugify

    if patient_id:
        cursor = await db.execute("SELECT slug FROM patients WHERE id = ?", (patient_id,))
        row = await cursor.fetchone()
        patient_slug = row[0] if row else "unknown"
    else:
        patient_slug = None

    year = study_date[:4] if study_date else "unknown"
    facility_slug = slugify(institution) if institution else "unknown"
    study_folder_name = f"{study_date or 'unknown'}_{facility_slug}_{modality or 'unknown'}"

    if patient_slug:
        base_path = f"patients/{patient_slug}/{year}/imaging/{study_folder_name}"
    else:
        base_path = f"unclassified/imaging/{study_folder_name}"

    series_folder = f"series-{series_number or '001'}"
    relative_path = f"{base_path}/{series_folder}/{path.name}"

    vault_root = Path(config.vault.root_path)
    dest = vault_root / relative_path
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Compute file hash for deduplication. If this exact frame is already
    # ingested (re-uploaded zip, replayed inbox), skip the rest of the
    # bookkeeping so num_images counters do not inflate.
    try:
        file_hash = compute_file_hash(str(path))
        file_size = os.path.getsize(str(path))
    except OSError:
        logger.exception("Could not stat DICOM file %s", path.name)
        patient_hint_path.unlink(missing_ok=True)
        event_hint_path.unlink(missing_ok=True)
        return None

    cursor = await db.execute(
        "SELECT id FROM documents WHERE file_hash = ?", (file_hash,),
    )
    existing = await cursor.fetchone()
    if existing:
        logger.info(
            "DICOM frame %s already ingested as doc=%d, skipping",
            path.name, existing[0],
        )
        path.unlink(missing_ok=True)
        patient_hint_path.unlink(missing_ok=True)
        event_hint_path.unlink(missing_ok=True)
        return existing[0]

    shutil.copy2(str(path), str(dest))
    path.unlink()

    # Create document record
    cursor = await db.execute(
        """INSERT INTO documents
           (patient_id, event_id, file_path, original_filename, doc_type, event_date,
            doctor_id, facility_id, file_hash, file_size,
            status, ocr_engine, ocr_text)
           VALUES (?, ?, ?, ?, 'imaging_dicom', ?, ?, ?, ?, ?, 'done', 'dicom', ?)""",
        (patient_id, hinted_event_id, relative_path, path.name, study_date,
         doctor_id, facility_id, file_hash, file_size,
         f"DICOM: {modality} {body_part} {study_desc}"),
    )
    doc_id = cursor.lastrowid

    # Create or find imaging study
    study_id: int | None = None
    study_is_new = False
    if study_uid:
        cursor = await db.execute(
            "SELECT id FROM imaging_studies WHERE study_instance_uid = ?", (study_uid,)
        )
        row = await cursor.fetchone()
        if row:
            study_id = row[0]
            # Bump the image counter on the existing study row. ``num_series``
            # is updated below only when the SERIES is new — never bump it
            # here unconditionally (a 35-frame, 1-series study would
            # otherwise report num_series=35).
            await db.execute(
                "UPDATE imaging_studies SET num_images = num_images + 1 WHERE id = ?",
                (study_id,),
            )

    if study_id is None:
        cursor = await db.execute(
            """INSERT INTO imaging_studies
               (document_id, patient_id, doctor_id, facility_id,
                study_date, modality, body_part,
                study_description, institution_name, referring_physician,
                accession_number, study_instance_uid, num_series, num_images,
                is_dicom, folder_path)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?)""",
            (doc_id, patient_id, doctor_id, facility_id,
             study_date, modality, body_part,
             study_desc, institution, referring, accession, study_uid,
             base_path),
        )
        study_id = cursor.lastrowid
        study_is_new = True

    # Create or find imaging series. Match on series_instance_uid when
    # present; fall back to (study_id, series_number) when the DICOM lacks
    # a SeriesInstanceUID — otherwise every frame would create its own
    # series row because ``WHERE series_instance_uid = NULL`` never matches.
    if series_uid:
        cursor = await db.execute(
            "SELECT id FROM imaging_series WHERE study_id = ? AND series_instance_uid = ?",
            (study_id, series_uid),
        )
    else:
        cursor = await db.execute(
            "SELECT id FROM imaging_series WHERE study_id = ? AND series_instance_uid IS NULL "
            "AND COALESCE(series_number, -1) = COALESCE(?, -1)",
            (study_id, series_number),
        )
    row = await cursor.fetchone()
    if row:
        await db.execute(
            "UPDATE imaging_series SET num_images = num_images + 1 WHERE id = ?",
            (row[0],),
        )
    else:
        await db.execute(
            """INSERT INTO imaging_series
               (study_id, series_number, series_description, modality,
                num_images, series_instance_uid, folder_path)
               VALUES (?, ?, ?, ?, 1, ?, ?)""",
            (study_id, series_number, series_desc, modality,
             series_uid, f"{base_path}/{series_folder}"),
        )
        # First frame of a brand-new series under an EXISTING study — bump
        # the parent's series counter. For a brand-new study the counter
        # already starts at 1, so do not double-count.
        if not study_is_new:
            await db.execute(
                "UPDATE imaging_studies SET num_series = num_series + 1 WHERE id = ?",
                (study_id,),
            )

    await db.commit()
    # Clean up sidecars now that the file has been ingested.
    patient_hint_path.unlink(missing_ok=True)
    event_hint_path.unlink(missing_ok=True)
    logger.info("DICOM processed: doc=%d study=%d %s %s", doc_id, study_id, modality, body_part)
    return doc_id


async def process_zip_member(
    file_path: str,
    config: AppConfig,
    db: aiosqlite.Connection,
) -> int | None:
    """Store a non-DICOM file extracted from a zip upload.

    Used for DICOMDIR manifests, JPEG previews, LOCKFILE, VERSION and any
    other bundle bookkeeping the user wants kept alongside the imaging
    study. We do not OCR or LLM-process them — they are filed under
    ``imaging-bundles/{zip_stem}/`` next to the patient (or unclassified)
    and the original filename is restored from the sidecar so e.g.
    ``DICOMDIR.bin`` is saved back as ``DICOMDIR``.
    """
    path = Path(file_path)
    sidecar_path = Path(str(path) + ".zip_member")
    if not sidecar_path.exists():
        logger.warning("zip_member sidecar missing for %s — skipping", path.name)
        return None

    try:
        meta = json.loads(sidecar_path.read_text())
    except Exception:
        logger.exception("Failed to read zip_member sidecar for %s", path.name)
        meta = {}

    original_name = meta.get("original_name") or path.stem
    zip_stem = meta.get("zip_stem") or "bundle"

    # Patient hint sidecar (written by upload route, same format used by the
    # standard pipeline path).
    patient_hint_path = Path(str(path) + ".patient_hint")
    patient_id: int | None = None
    if patient_hint_path.exists():
        try:
            patient_id = int(patient_hint_path.read_text().strip())
        except (ValueError, OSError):
            patient_id = None

    event_hint_path = Path(str(path) + ".event_hint")
    event_id: int | None = None
    if event_hint_path.exists():
        try:
            event_id = int(event_hint_path.read_text().strip())
        except (ValueError, OSError):
            event_id = None

    # Resolve destination: alongside the imaging bundle for this study.
    from asclepius.patients.service import slugify  # local import to avoid cycles

    if patient_id:
        cursor = await db.execute("SELECT slug FROM patients WHERE id = ?", (patient_id,))
        row = await cursor.fetchone()
        patient_slug = row[0] if row else None
    else:
        patient_slug = None

    bundle_slug = slugify(zip_stem) or "bundle"
    if patient_slug:
        relative_dir = f"patients/{patient_slug}/imaging-bundles/{bundle_slug}"
    else:
        relative_dir = f"unclassified/imaging-bundles/{bundle_slug}"

    vault_root = Path(config.vault.root_path)
    dest_dir = vault_root / relative_dir
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Restore original filename. If a same-named file already exists from a
    # prior extraction, suffix-counter so we never overwrite.
    safe_original = original_name.replace("/", "_").replace("\\", "_")
    dest = dest_dir / safe_original
    counter = 1
    while dest.exists():
        stem = Path(safe_original).stem
        suffix = Path(safe_original).suffix
        dest = dest_dir / f"{stem}_{counter}{suffix}"
        counter += 1
        if counter > 10_000:
            logger.error("Could not allocate filename for %s", safe_original)
            return None

    relative_path = f"{relative_dir}/{dest.name}"

    try:
        file_hash = compute_file_hash(str(path))
        file_size = os.path.getsize(str(path))
    except OSError:
        logger.exception("Could not stat zip member %s", path.name)
        return None

    # Dedup: if this exact file already exists as a document, skip.
    cursor = await db.execute(
        "SELECT id FROM documents WHERE file_hash = ?", (file_hash,)
    )
    existing = await cursor.fetchone()
    if existing:
        logger.info("Zip member %s already ingested as doc=%d, skipping", path.name, existing[0])
        path.unlink(missing_ok=True)
        sidecar_path.unlink(missing_ok=True)
        patient_hint_path.unlink(missing_ok=True)
        event_hint_path.unlink(missing_ok=True)
        return existing[0]

    shutil.copy2(str(path), str(dest))
    path.unlink(missing_ok=True)
    sidecar_path.unlink(missing_ok=True)
    patient_hint_path.unlink(missing_ok=True)
    event_hint_path.unlink(missing_ok=True)

    cursor = await db.execute(
        """INSERT INTO documents
           (patient_id, event_id, file_path, original_filename, doc_type,
            file_hash, file_size, status, ocr_engine, summary_en)
           VALUES (?, ?, ?, ?, 'unknown_binary', ?, ?, 'done', 'none', ?)""",
        (
            patient_id,
            event_id,
            relative_path,
            safe_original,
            file_hash,
            file_size,
            f"Imaging bundle file: {safe_original} (from {zip_stem})",
        ),
    )
    doc_id = cursor.lastrowid
    await db.commit()
    logger.info("Zip member stored: doc=%d %s", doc_id, relative_path)
    return doc_id
