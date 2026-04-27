"""DICOM file processing and metadata extraction."""

import hashlib
import json
import logging
import os
import shutil
from pathlib import Path

import aiosqlite

from asclepius.config import AppConfig
from asclepius.documents.service import compute_file_hash

logger = logging.getLogger(__name__)


def parse_dicom_pn(raw: str) -> str:
    """Convert DICOM Person Name (PN) syntax to a plain "First Last" string.

    DICOM PN is ``Family^Given^Middle^Prefix^Suffix`` (each component is
    optional; the caret separators are mandatory). pydicom returns the raw
    string verbatim, so a name like ``WUILLERET^GUILLAUME^^DR. MED.^DR. MED.``
    ends up stored exactly that way unless we parse it. We assemble
    ``Given Middle Family`` (the natural Western order), drop the prefix /
    suffix components (titles like "Dr. med." are handled by
    ``strip_doctor_title`` later), and return an empty string when the
    parse yields nothing.
    """
    if not raw:
        return ""
    # Some scanners use multiple `=` separators for ideographic / phonetic
    # forms ("Alphabetic=Ideographic=Phonetic"). We only care about the
    # alphabetic component (the first one).
    raw = raw.split("=", 1)[0]
    if "^" not in raw:
        return raw.strip()
    parts = raw.split("^")
    # Pad to 5 components so indexing is safe regardless of trailing carets.
    parts += [""] * (5 - len(parts))
    family, given, middle = parts[0].strip(), parts[1].strip(), parts[2].strip()
    pieces = [p for p in (given, middle, family) if p]
    return " ".join(pieces)


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

    # Extract metadata. PatientName and ReferringPhysicianName arrive in
    # DICOM PN syntax (Family^Given^Middle^Prefix^Suffix); convert them to
    # the natural "Given Family" form before downstream entity matching
    # treats them as plain strings.
    patient_name = parse_dicom_pn(str(getattr(ds, "PatientName", ""))) or None
    study_date_raw = str(getattr(ds, "StudyDate", "")) or None
    modality = str(getattr(ds, "Modality", "")) or None
    body_part = str(getattr(ds, "BodyPartExamined", "")) or None
    study_desc = str(getattr(ds, "StudyDescription", "")) or None
    institution = str(getattr(ds, "InstitutionName", "")) or None
    referring = parse_dicom_pn(str(getattr(ds, "ReferringPhysicianName", ""))) or None
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

    # Upsert doctor from referring physician. Strip honorific titles ("Dr.",
    # "Dr. med.") and normalise capitalisation so the doctor table holds the
    # raw person name only — matches the pattern used by the OCR/LLM path.
    doctor_id = None
    if referring:
        from asclepius.pipeline.extractor import _upsert_doctor
        from asclepius.pipeline.entity_matching import (
            strip_doctor_title, normalize_name,
        )
        cleaned = normalize_name(strip_doctor_title(referring))
        if cleaned:
            doctor_id = await _upsert_doctor(db, {"name": cleaned}, facility_id)

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

    try:
        frame_size = os.path.getsize(str(path))
    except OSError:
        logger.exception("Could not stat DICOM file %s", path.name)
        patient_hint_path.unlink(missing_ok=True)
        event_hint_path.unlink(missing_ok=True)
        return None

    # Idempotent re-ingest: a frame that is already at its destination with
    # the same byte count was almost certainly written by a previous run of
    # this pipeline (re-uploaded zip, replayed inbox). Skip the counter
    # bumps so num_images does not inflate on repeat ingest.
    frame_already_ingested = (
        dest.exists() and dest.stat().st_size == frame_size
    )

    # Deterministic ``file_hash`` for the documents row. We model an imaging
    # study as ONE document (regardless of how many frames it carries), so
    # subsequent frames must find the same row instead of creating a new
    # one. Hashing the StudyInstanceUID gives a stable key; for the rare
    # case where a DICOM file has no UID we fall back to a hash of the
    # study folder, which is also unique per study.
    study_key = study_uid or base_path
    study_doc_hash = hashlib.sha256(
        f"asclepius-imaging-study:{study_key}".encode("utf-8")
    ).hexdigest()
    study_folder_basename = base_path.rsplit("/", 1)[-1]

    if not frame_already_ingested:
        shutil.copy2(str(path), str(dest))
    path.unlink(missing_ok=True)

    # Find or create the canonical document row for this study. The first
    # frame creates it; every subsequent frame just looks it up.
    cursor = await db.execute(
        "SELECT id FROM documents WHERE file_hash = ?", (study_doc_hash,),
    )
    existing_doc = await cursor.fetchone()
    if existing_doc:
        doc_id = existing_doc[0]
    else:
        cursor = await db.execute(
            """INSERT INTO documents
               (patient_id, event_id, file_path, original_filename, doc_type, event_date,
                doctor_id, facility_id, file_hash, file_size,
                status, ocr_engine, ocr_text)
               VALUES (?, ?, ?, ?, 'imaging_dicom', ?, ?, ?, ?, 0, 'done', 'dicom', ?)""",
            (patient_id, hinted_event_id, base_path, study_folder_basename,
             study_date, doctor_id, facility_id, study_doc_hash,
             f"DICOM: {modality or ''} {body_part or ''} {study_desc or ''}".strip()),
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
            # Bump the image counter on the existing study row only for
            # FIRST-TIME frames — never on a repeat-ingest of an existing
            # frame. ``num_series`` is updated below when a NEW series row
            # appears.
            if not frame_already_ingested:
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
        # Only bump per-series image counter for FIRST-TIME frames.
        if not frame_already_ingested:
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
    other bundle bookkeeping kept alongside the imaging study. These files
    are NOT given their own ``documents`` row (one DICOM bundle = one
    document; the DICOM frames already cover that) — they live on disk
    under ``imaging-bundles/{zip_stem}/`` and the imaging detail UI lists
    them via a dedicated bundle-files endpoint.
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

    # Bundle files are NOT given a documents row; they belong to the
    # parent imaging study and are listed via the imaging detail UI.
    # The destination still needs a stable copy on disk so the UI can
    # serve them (e.g. JPEG previews next to the DICOM frames).
    if dest.exists():
        path.unlink(missing_ok=True)
        sidecar_path.unlink(missing_ok=True)
        patient_hint_path.unlink(missing_ok=True)
        event_hint_path.unlink(missing_ok=True)
        return None

    shutil.copy2(str(path), str(dest))
    path.unlink(missing_ok=True)
    sidecar_path.unlink(missing_ok=True)
    patient_hint_path.unlink(missing_ok=True)
    event_hint_path.unlink(missing_ok=True)

    logger.info("Zip member stored: %s", relative_path)
    return None
