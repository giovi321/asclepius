"""DICOM file processing and metadata extraction."""

import logging
import shutil
from pathlib import Path

import aiosqlite

from asclepius.config import AppConfig

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

    try:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True)
    except Exception:
        logger.exception("Failed to read DICOM file: %s", path.name)
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

    # Try to match patient
    patient_id = None
    if patient_name:
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

    shutil.copy2(str(path), str(dest))
    path.unlink()

    # Create document record
    cursor = await db.execute(
        """INSERT INTO documents
           (patient_id, file_path, original_filename, doc_type, doc_date,
            doctor_id, facility_id, status, ocr_engine, ocr_text)
           VALUES (?, ?, ?, 'imaging_dicom', ?, ?, ?, 'done', 'dicom', ?)""",
        (patient_id, relative_path, path.name, study_date,
         doctor_id, facility_id,
         f"DICOM: {modality} {body_part} {study_desc}"),
    )
    doc_id = cursor.lastrowid

    # Create or find imaging study
    study_id = None
    if study_uid:
        cursor = await db.execute(
            "SELECT id FROM imaging_studies WHERE study_instance_uid = ?", (study_uid,)
        )
        row = await cursor.fetchone()
        if row:
            study_id = row[0]
            # Update counts
            await db.execute(
                "UPDATE imaging_studies SET num_images = num_images + 1 WHERE id = ?",
                (study_id,),
            )

    if not study_id:
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

    # Create or find imaging series
    cursor = await db.execute(
        "SELECT id FROM imaging_series WHERE study_id = ? AND series_instance_uid = ?",
        (study_id, series_uid),
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

    await db.commit()
    logger.info("DICOM processed: doc=%d study=%d %s %s", doc_id, study_id, modality, body_part)
    return doc_id
