"""Database initialization and seed loading."""

import json
import logging
import os
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
SEEDS_DIR = Path(os.environ.get("ASCLEPIUS_CONFIG_PATH", "/data/config/settings.yaml")).parent / "seeds"
# Bundled seeds inside the Docker image (fallback)
BUNDLED_SEEDS_DIR = Path(__file__).parent.parent.parent / "bundled_config" / "seeds"


async def initialize_database(db_path: str) -> None:
    """Initialize the database schema and seed data if needed."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        # Execute schema
        schema_sql = SCHEMA_PATH.read_text()
        await db.executescript(schema_sql)
        await db.commit()

        # Migrations for existing databases
        await _run_migrations(db)

        # Check if we need to seed
        cursor = await db.execute("SELECT COUNT(*) FROM norm_lab_tests")
        row = await cursor.fetchone()
        if row[0] == 0:
            await _seed_normalization_tables(db)
            await db.commit()

        logger.info("Database initialized at %s", db_path)


async def _run_migrations(db: aiosqlite.Connection) -> None:
    """Run schema migrations for existing databases.

    0.9.7 trimmed this file: every migration that pre-dates the 0.9.x
    line was dropped — those changes are baked into ``schema.sql`` and
    a fresh ``CREATE TABLE IF NOT EXISTS`` is enough for new installs.
    Anyone upgrading from before 0.9.0 needs to start from a clean
    database.

    What remains is the ladder that takes a 0.9.x install up to the
    current shape:

      - imaging_studies / encounters → documents triggers (always
        ensured; idempotent via CREATE TRIGGER IF NOT EXISTS)
      - 0.9.5: imaging-layout move (drop the legacy ``imaging/`` segment)
      - 0.9.5: one-doc-per-imaging-study collapse
      - 0.9.5: imaging-series dedup + counter recompute
      - 0.9.6: imaging_dicom → imaging_report (placeholder PDF parent)
      - 0.9.7: drop dead imaging_studies columns
        (institution_name, referring_physician, is_dicom)
      - 0.9.8: drop imaging_studies.study_date (use documents.event_date
        as the single source of truth for the timeline anchor)

    The compat view ``documents_with_names`` is rebuilt every init.
    """
    # ── triggers: keep imaging_studies / encounters in lockstep with
    # the parent documents row. Idempotent via CREATE TRIGGER IF NOT EXISTS.
    for table in ("encounters", "imaging_studies"):
        await db.execute(f"""
            CREATE TRIGGER IF NOT EXISTS {table}_doctor_sync
            AFTER UPDATE OF doctor_id ON documents
            FOR EACH ROW
            WHEN NEW.doctor_id IS NOT OLD.doctor_id
            BEGIN
                UPDATE {table} SET doctor_id = NEW.doctor_id WHERE document_id = NEW.id;
            END
        """)
        await db.execute(f"""
            CREATE TRIGGER IF NOT EXISTS {table}_facility_sync
            AFTER UPDATE OF facility_id ON documents
            FOR EACH ROW
            WHEN NEW.facility_id IS NOT OLD.facility_id
            BEGIN
                UPDATE {table} SET facility_id = NEW.facility_id WHERE document_id = NEW.id;
            END
        """)
    await db.commit()

    # Skip the rest entirely on a fresh install (no documents yet).
    cursor = await db.execute("SELECT COUNT(*) FROM documents")
    n_docs = (await cursor.fetchone())[0]
    if n_docs == 0:
        await _ensure_compat_view(db)
        return

    # All the per-version blocks below are idempotent. We dispatch in
    # version order so each one sees the schema shape produced by the
    # previous one. None of these touch user data outside imaging.
    await _migration_0_9_5_imaging_layout(db)
    await _migration_0_9_5_collapse_imaging_docs(db)
    await _migration_0_9_5_imaging_series_dedup(db)
    await _migration_0_9_6_imaging_report(db)
    await _migration_0_9_7_drop_dead_imaging_columns(db)
    await _migration_0_9_8_drop_imaging_study_date(db)
    await _ensure_compat_view(db)


async def _ensure_compat_view(db: aiosqlite.Connection) -> None:
    """Compat view for external tooling that still expects the old
    doctor_name / facility_name columns. Dropped and recreated every
    init so the view re-binds to the current documents columns."""
    await db.execute("DROP VIEW IF EXISTS documents_with_names")
    await db.execute("""
        CREATE VIEW IF NOT EXISTS documents_with_names AS
        SELECT d.*,
               doc.name       AS doctor_name,
               f.name         AS facility_name,
               p.display_name AS patient_name,
               p.slug         AS patient_slug
        FROM documents d
        LEFT JOIN doctors    doc ON d.doctor_id   = doc.id
        LEFT JOIN facilities f   ON d.facility_id = f.id
        LEFT JOIN patients   p   ON d.patient_id  = p.id
    """)
    await db.commit()


async def _migration_0_9_5_imaging_layout(db: aiosqlite.Connection) -> None:
    """0.9.5 imaging-layout migration. Studies used to live under an
    ``imaging/`` subfolder of the year directory; they now sit at the
    same level as document files (peer of a PDF). We move on-disk
    folders and rewrite folder/file paths in lockstep. Idempotent —
    paths that already lack the ``imaging/`` segment are skipped.
    """
    try:
        from asclepius.config import get_config as _get_config_for_layout
        vault_root = Path(_get_config_for_layout().vault.root_path)
    except Exception:
        return

    cursor = await db.execute(
        "SELECT id, folder_path FROM imaging_studies "
        "WHERE folder_path LIKE '%/imaging/%' OR folder_path LIKE 'unclassified/imaging/%'"
    )
    rows = await cursor.fetchall()
    if not rows:
        return

    import shutil as _shutil_layout
    _moved = 0
    for lrow in rows:
        study_pk = lrow[0]
        old_folder = lrow[1] or ""
        if not old_folder:
            continue
        new_folder = old_folder.replace("/imaging/", "/", 1)
        if new_folder == old_folder:
            continue
        old_abs = vault_root / old_folder
        new_abs = vault_root / new_folder
        try:
            if old_abs.exists():
                new_abs.parent.mkdir(parents=True, exist_ok=True)
                if new_abs.exists():
                    logger.warning(
                        "Migration: cannot move %s to %s — destination exists; skipping disk move",
                        old_abs, new_abs,
                    )
                else:
                    _shutil_layout.move(str(old_abs), str(new_abs))
            await db.execute(
                "UPDATE imaging_studies SET folder_path = ? WHERE id = ?",
                (new_folder, study_pk),
            )
            await db.execute(
                "UPDATE imaging_series SET folder_path = REPLACE(folder_path, ?, ?) "
                "WHERE study_id = ?",
                (old_folder, new_folder, study_pk),
            )
            await db.execute(
                "UPDATE documents SET file_path = REPLACE(file_path, ?, ?) "
                "WHERE file_path LIKE ?",
                (old_folder, new_folder, old_folder + "%"),
            )
            _moved += 1
        except Exception:
            logger.warning(
                "Migration: failed to relocate imaging study %d (%s)",
                study_pk, old_folder, exc_info=True,
            )

    # Sweep empty legacy ``imaging/`` directories.
    if vault_root.exists():
        for patient_dir in (vault_root / "patients").glob("*"):
            if not patient_dir.is_dir():
                continue
            for year_dir in patient_dir.iterdir():
                if not year_dir.is_dir():
                    continue
                imaging_legacy = year_dir / "imaging"
                if imaging_legacy.exists() and imaging_legacy.is_dir():
                    try:
                        if not any(imaging_legacy.iterdir()):
                            imaging_legacy.rmdir()
                    except OSError:
                        pass
        legacy_unclass = vault_root / "unclassified" / "imaging"
        if legacy_unclass.exists() and legacy_unclass.is_dir():
            try:
                if not any(legacy_unclass.iterdir()):
                    legacy_unclass.rmdir()
            except OSError:
                pass

    if _moved:
        await db.commit()
        logger.info(
            "Migration: relocated %d imaging studies to drop the legacy 'imaging/' segment",
            _moved,
        )


async def _migration_0_9_5_collapse_imaging_docs(db: aiosqlite.Connection) -> None:
    """One documents row per imaging study (was N — one per DICOM frame
    plus one per zip-member bundle file). We rewrite the canonical row's
    file_path / file_hash / original_filename, drop the per-frame dupes,
    and drop the per-bundle-file rows. Idempotent.
    """
    import hashlib as _hashlib

    cursor = await db.execute(
        "SELECT id, document_id, study_instance_uid, folder_path FROM imaging_studies"
    )
    studies = await cursor.fetchall()
    _rewritten = 0
    _frame_dupes = 0
    for srow in studies:
        canonical_doc_id = srow[1]
        study_uid = srow[2]
        folder_path = srow[3]
        if not folder_path or not canonical_doc_id:
            continue
        study_key = study_uid or folder_path
        study_doc_hash = _hashlib.sha256(
            f"asclepius-imaging-study:{study_key}".encode("utf-8")
        ).hexdigest()
        study_folder_basename = folder_path.rsplit("/", 1)[-1] or folder_path
        cursor = await db.execute(
            "SELECT file_path, file_hash FROM documents WHERE id = ?",
            (canonical_doc_id,),
        )
        cur_row = await cursor.fetchone()
        if cur_row is not None and (
            cur_row[0] != folder_path or cur_row[1] != study_doc_hash
        ):
            try:
                await db.execute(
                    """UPDATE documents
                       SET file_path = ?, original_filename = ?, file_hash = ?,
                           doc_type = 'imaging_dicom'
                       WHERE id = ?""",
                    (folder_path, study_folder_basename, study_doc_hash,
                     canonical_doc_id),
                )
                _rewritten += 1
            except aiosqlite.IntegrityError:
                pass

        await db.execute(
            """DELETE FROM documents
               WHERE doc_type = 'imaging_dicom'
                 AND id != ?
                 AND file_path LIKE ?""",
            (canonical_doc_id, folder_path + "/%"),
        )
        _frame_dupes += (await (await db.execute("SELECT changes()")).fetchone())[0]

    await db.execute(
        """DELETE FROM documents
           WHERE doc_type = 'unknown_binary'
             AND (file_path LIKE 'patients/%/imaging-bundles/%'
                  OR file_path LIKE 'unclassified/imaging-bundles/%')"""
    )
    _bundles = (await (await db.execute("SELECT changes()")).fetchone())[0]

    if _rewritten or _frame_dupes or _bundles:
        await db.commit()
        logger.info(
            "Migration: collapsed imaging documents — rewrote %d canonical, "
            "removed %d per-frame + %d bundle-file rows",
            _rewritten, _frame_dupes, _bundles,
        )


async def _migration_0_9_5_imaging_series_dedup(db: aiosqlite.Connection) -> None:
    """Merge duplicate imaging_series rows (NULL series_instance_uid bug)
    and recompute parent counters. Idempotent."""
    cursor = await db.execute(
        """SELECT study_id, COALESCE(series_number, -1) AS sn,
                  GROUP_CONCAT(id) AS ids, SUM(num_images) AS total
           FROM imaging_series
           WHERE series_instance_uid IS NULL
           GROUP BY study_id, COALESCE(series_number, -1)
           HAVING COUNT(*) > 1"""
    )
    null_uid_groups = await cursor.fetchall()
    cursor = await db.execute(
        """SELECT study_id, series_instance_uid,
                  GROUP_CONCAT(id) AS ids, SUM(num_images) AS total
           FROM imaging_series
           WHERE series_instance_uid IS NOT NULL
           GROUP BY study_id, series_instance_uid
           HAVING COUNT(*) > 1"""
    )
    uid_groups = await cursor.fetchall()

    _merged = 0
    for grp in (*null_uid_groups, *uid_groups):
        ids_str = grp[2]
        total = grp[3] or 0
        ids = sorted(int(s) for s in str(ids_str).split(",") if s)
        if len(ids) < 2:
            continue
        keeper, *drops = ids
        await db.execute(
            "UPDATE imaging_series SET num_images = ? WHERE id = ?",
            (total, keeper),
        )
        for d in drops:
            await db.execute("DELETE FROM imaging_series WHERE id = ?", (d,))
            _merged += 1

    await db.execute(
        """UPDATE imaging_studies
           SET num_series = (
               SELECT COUNT(*) FROM imaging_series WHERE study_id = imaging_studies.id
           ),
               num_images = (
               SELECT COALESCE(SUM(num_images), 0) FROM imaging_series
               WHERE study_id = imaging_studies.id
           )"""
    )

    if _merged:
        await db.commit()
        logger.info(
            "Migration: merged %d duplicate imaging_series rows and recomputed study counters",
            _merged,
        )
    else:
        await db.commit()


async def _migration_0_9_6_imaging_report(db: aiosqlite.Connection) -> None:
    """0.9.6: the parent document of an imaging study is now the radiology
    REPORT, not the DICOM bundle. Existing rows with doc_type='imaging_dicom'
    flip to 'imaging_report' and have their file_path cleared so they
    become placeholders the user can populate by uploading the actual
    PDF. imaging_studies gains a denormalised report_status flag.
    """
    cursor = await db.execute("PRAGMA table_info(imaging_studies)")
    is_cols = [row[1] for row in await cursor.fetchall()]
    if "report_status" not in is_cols:
        await db.execute(
            "ALTER TABLE imaging_studies ADD COLUMN report_status TEXT NOT NULL DEFAULT 'placeholder'"
        )
        logger.info("Migration: added imaging_studies.report_status")

    # ``study_date`` was dropped by the 0.9.8 migration; pull the parent
    # document's ``event_date`` instead so the placeholder filename still
    # carries a date.
    cursor = await db.execute(
        """SELECT d.id, COALESCE(s.modality, '') AS modality,
                  COALESCE(s.body_part, '') AS body_part,
                  COALESCE(d.event_date, '') AS study_date
           FROM documents d
           LEFT JOIN imaging_studies s ON s.document_id = d.id
           WHERE d.doc_type = 'imaging_dicom'"""
    )
    legacy = await cursor.fetchall()
    _flipped = 0
    for r in legacy:
        doc_pk = r[0]
        bits = [b for b in ((r[1] or "").strip(), (r[2] or "").strip(), (r[3] or "").strip()) if b]
        label = " ".join(bits) if bits else "Imaging"
        placeholder_name = f"{label} (report pending)"
        await db.execute(
            """UPDATE documents
               SET doc_type = 'imaging_report',
                   file_path = '',
                   file_size = NULL,
                   original_filename = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (placeholder_name, doc_pk),
        )
        _flipped += 1

    await db.execute(
        """UPDATE imaging_studies SET report_status =
              CASE
                WHEN COALESCE((SELECT file_path FROM documents WHERE id = imaging_studies.document_id), '') = ''
                THEN 'placeholder'
                ELSE 'attached'
              END"""
    )
    if _flipped:
        await db.commit()
        logger.info(
            "Migration: flipped %d imaging_dicom documents to placeholder imaging_report rows",
            _flipped,
        )


async def _migration_0_9_7_drop_dead_imaging_columns(db: aiosqlite.Connection) -> None:
    """0.9.7: drop columns that duplicated the documents-side metadata.

    ``referring_physician`` and ``institution_name`` were extracted from
    DICOM tags at ingest and stored alongside ``doctor_id`` /
    ``facility_id`` (which point at the canonical normalised entities).
    The two pairs drifted as users edited the document side, so we keep
    only the foreign-key version. ``is_dicom`` was set to 1 on every row
    and never read.

    SQLite 3.35+ supports ``ALTER TABLE DROP COLUMN``. We run it inside
    a try/except so older runtimes don't crash the migration — the dead
    columns just stay around invisibly.
    """
    cursor = await db.execute("PRAGMA table_info(imaging_studies)")
    cols = {row[1] for row in await cursor.fetchall()}
    dropped = []
    for col in ("institution_name", "referring_physician", "is_dicom"):
        if col in cols:
            try:
                await db.execute(f"ALTER TABLE imaging_studies DROP COLUMN {col}")
                dropped.append(col)
            except Exception:
                logger.warning(
                    "Migration: ALTER TABLE DROP COLUMN %s failed (older SQLite?); leaving column in place",
                    col,
                )
    if dropped:
        await db.commit()
        logger.info(
            "Migration: dropped dead imaging_studies columns: %s",
            ", ".join(dropped),
        )


async def _migration_0_9_8_drop_imaging_study_date(db: aiosqlite.Connection) -> None:
    """0.9.8: ``imaging_studies.study_date`` duplicated
    ``documents.event_date`` (the canonical timeline anchor used by every
    other table and by the timeline view). The two drifted whenever a
    user edited the document side, and "Study date" + "Event date" being
    different fields in the UI was confusing. Backfill any imaging study
    whose parent document has no event_date but the imaging row does,
    then drop the column.
    """
    cursor = await db.execute("PRAGMA table_info(imaging_studies)")
    cols = {row[1] for row in await cursor.fetchall()}
    if "study_date" not in cols:
        return  # already migrated

    # Backfill: copy non-null study_date onto the parent document when it
    # has no event_date set (rare, but safe).
    await db.execute(
        """UPDATE documents SET event_date = (
              SELECT s.study_date FROM imaging_studies s
              WHERE s.document_id = documents.id
              LIMIT 1
           )
           WHERE event_date IS NULL
             AND id IN (
                 SELECT document_id FROM imaging_studies
                 WHERE study_date IS NOT NULL
             )"""
    )

    try:
        await db.execute("ALTER TABLE imaging_studies DROP COLUMN study_date")
        await db.commit()
        logger.info(
            "Migration: dropped imaging_studies.study_date "
            "(use documents.event_date as the single source of truth)"
        )
    except Exception:
        logger.warning(
            "Migration: ALTER TABLE DROP COLUMN study_date failed "
            "(older SQLite?); leaving column in place",
        )


async def _seed_normalization_tables(db: aiosqlite.Connection) -> None:
    """Load seed data from JSON files into normalization tables."""
    seeds_dir = SEEDS_DIR
    # Check bundled seeds inside the Docker image
    if not seeds_dir.exists():
        seeds_dir = BUNDLED_SEEDS_DIR
    # Also check relative path for local development
    if not seeds_dir.exists():
        seeds_dir = Path(__file__).parent.parent.parent.parent / "config" / "seeds"
    if not seeds_dir.exists():
        logger.warning("Seeds directory not found, skipping seed data")
        return

    await _seed_lab_tests(db, seeds_dir / "lab_tests.json")
    await _seed_diagnoses(db, seeds_dir / "diagnoses.json")
    await _seed_medications(db, seeds_dir / "medications.json")
    await _seed_specialties(db, seeds_dir / "specialties.json")
    logger.info("Seed data loaded")


async def _seed_with_aliases(
    db: aiosqlite.Connection,
    path: Path,
    main_table: str,
    main_columns: list[str],
    alias_table: str,
    alias_fk: str,
    get_main_values: callable,
) -> None:
    """Generic batch seeder for normalization tables with aliases.

    Args:
        db: Database connection
        path: Path to JSON seed file
        main_table: Name of the canonical table (e.g. 'norm_lab_tests')
        main_columns: Column names for INSERT (e.g. ['canonical_code', 'canonical_display', ...])
        alias_table: Name of the alias table (e.g. 'norm_lab_test_aliases')
        alias_fk: Foreign key column in alias table (e.g. 'norm_lab_test_id')
        get_main_values: Function(item) -> tuple of values matching main_columns
    """
    if not path.exists():
        return

    data = json.loads(path.read_text(encoding="utf-8"))
    if not data:
        return

    cols = ", ".join(main_columns)
    placeholders = ", ".join(["?"] * len(main_columns))
    insert_main = f"INSERT OR IGNORE INTO {main_table} ({cols}) VALUES ({placeholders})"
    select_id = f"SELECT id FROM {main_table} WHERE canonical_code = ?"
    insert_alias = f"INSERT OR IGNORE INTO {alias_table} ({alias_fk}, alias, language, auto_mapped) VALUES (?, ?, ?, 0)"

    count_main = 0
    count_aliases = 0

    for item in data:
        values = get_main_values(item)
        await db.execute(insert_main, values)

        # Get the ID (whether just inserted or already existed)
        cursor = await db.execute(select_id, (item["canonical_code"],))
        row = await cursor.fetchone()
        if not row:
            continue
        item_id = row[0]
        count_main += 1

        # Batch insert aliases
        aliases = item.get("aliases", [])
        if aliases:
            alias_values = [(item_id, a["alias"], a.get("language")) for a in aliases]
            await db.executemany(insert_alias, alias_values)
            count_aliases += len(aliases)

    logger.info("Seeded %s: %d entries, %d aliases", main_table, count_main, count_aliases)


async def _seed_lab_tests(db: aiosqlite.Connection, path: Path) -> None:
    await _seed_with_aliases(
        db, path,
        main_table="norm_lab_tests",
        main_columns=["canonical_code", "canonical_display", "loinc_code", "category", "unit_preferred"],
        alias_table="norm_lab_test_aliases",
        alias_fk="norm_lab_test_id",
        get_main_values=lambda item: (
            item["canonical_code"], item["canonical_display"],
            item.get("loinc_code"), item.get("category"), item.get("unit_preferred"),
        ),
    )


async def _seed_diagnoses(db: aiosqlite.Connection, path: Path) -> None:
    await _seed_with_aliases(
        db, path,
        main_table="norm_diagnoses",
        main_columns=["canonical_code", "canonical_display", "icd10_code"],
        alias_table="norm_diagnosis_aliases",
        alias_fk="norm_diagnosis_id",
        get_main_values=lambda item: (
            item["canonical_code"], item["canonical_display"], item.get("icd10_code"),
        ),
    )


async def _seed_medications(db: aiosqlite.Connection, path: Path) -> None:
    await _seed_with_aliases(
        db, path,
        main_table="norm_medications",
        main_columns=["canonical_code", "canonical_display", "atc_code"],
        alias_table="norm_medication_aliases",
        alias_fk="norm_medication_id",
        get_main_values=lambda item: (
            item["canonical_code"], item["canonical_display"], item.get("atc_code"),
        ),
    )


async def _seed_specialties(db: aiosqlite.Connection, path: Path) -> None:
    await _seed_with_aliases(
        db, path,
        main_table="norm_specialties",
        main_columns=["canonical_code", "canonical_display"],
        alias_table="norm_specialty_aliases",
        alias_fk="norm_specialty_id",
        get_main_values=lambda item: (
            item["canonical_code"], item["canonical_display"],
        ),
    )
