"""Database initialization and seed loading."""

import json
import logging
import os
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
SEEDS_DIR = (
    Path(os.environ.get("ASCLEPIUS_CONFIG_PATH", "/data/config/settings.yaml")).parent / "seeds"
)
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

    The pre-existing migration ladder was wiped — all earlier shape
    changes are baked into ``schema.sql`` and a fresh
    ``CREATE TABLE IF NOT EXISTS`` is enough for new installs. Users on
    pre-current databases must reinstall.

    What remains:

      - imaging_studies / encounters → documents triggers (always
        ensured; idempotent via CREATE TRIGGER IF NOT EXISTS)
      - clear_imaging_placeholder_summary_v1: NULL the LLM-written
        summary on imaging placeholders (rows whose report PDF has
        not been attached yet) so they no longer surface stale text
        in the document view.

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
    # Specialty cascades only to encounters — imaging_studies has no
    # norm_specialty_id column. Without this, repointing a document's
    # specialty in the doc detail page leaves the extracted encounter
    # rows attached to the OLD norm_specialties row, so the Normalization
    # tab's "linked documents" walk (which traverses both documents and
    # encounters) keeps surfacing the document under the old specialty.
    await db.execute("""
        CREATE TRIGGER IF NOT EXISTS encounters_specialty_sync
        AFTER UPDATE OF norm_specialty_id ON documents
        FOR EACH ROW
        WHEN NEW.norm_specialty_id IS NOT OLD.norm_specialty_id
        BEGIN
            UPDATE encounters SET norm_specialty_id = NEW.norm_specialty_id WHERE document_id = NEW.id;
        END
    """)
    await db.commit()

    # Skip the rest entirely on a fresh install (no documents yet).
    cursor = await db.execute("SELECT COUNT(*) FROM documents")
    n_docs = (await cursor.fetchone())[0]
    if n_docs == 0:
        await _ensure_compat_view(db)
        return

    # Data-cleanup migrations: gated by schema_migrations so they run once
    # per DB instead of scanning every startup.
    await _ensure_schema_migrations_table(db)
    await _run_once(
        db,
        "clear_imaging_placeholder_summary_v1",
        _migration_clear_imaging_placeholder_summary,
    )
    await _ensure_compat_view(db)


async def _ensure_schema_migrations_table(db: aiosqlite.Connection) -> None:
    """Create the bookkeeping table for one-shot data-cleanup migrations."""
    await db.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
            key TEXT PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    await db.commit()


async def _run_once(
    db: aiosqlite.Connection,
    key: str,
    fn,
) -> None:
    """Run ``fn`` only if its key has not been recorded yet, then record it.

    Use for data-cleanup migrations that are idempotent but expensive on
    populated DBs (full table scans, GROUP BYs). Schema-shape migrations
    keep their own inline guards via PRAGMA table_info and don't go
    through this helper.
    """
    cursor = await db.execute(
        "SELECT 1 FROM schema_migrations WHERE key = ?",
        (key,),
    )
    if await cursor.fetchone():
        return
    await fn(db)
    await db.execute(
        "INSERT OR IGNORE INTO schema_migrations (key) VALUES (?)",
        (key,),
    )
    await db.commit()


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


async def _migration_clear_imaging_placeholder_summary(db: aiosqlite.Connection) -> None:
    """NULL the LLM-written summary on imaging placeholder documents.

    An imaging placeholder is a row with ``doc_type='imaging_report'`` and
    an empty ``file_path`` — the radiology PDF has not been attached
    yet, so any ``summary_en`` / ``summary_original`` text on the row was
    generated from DICOM metadata alone and is not meaningful clinical
    content. Clearing it avoids the document detail view showing stale
    blurbs for studies that have no real report.

    Idempotent: re-running just clears the same set again, which is a
    no-op once the rows already match.
    """
    cursor = await db.execute(
        """UPDATE documents
              SET summary_en = NULL, summary_original = NULL
            WHERE doc_type = 'imaging_report'
              AND COALESCE(file_path, '') = ''
              AND (summary_en IS NOT NULL OR summary_original IS NOT NULL)"""
    )
    if cursor.rowcount and cursor.rowcount > 0:
        logger.info(
            "Migration: cleared summary on %d imaging placeholder documents",
            cursor.rowcount,
        )
    await db.commit()


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
        db,
        path,
        main_table="norm_lab_tests",
        main_columns=[
            "canonical_code",
            "canonical_display",
            "loinc_code",
            "category",
            "unit_preferred",
        ],
        alias_table="norm_lab_test_aliases",
        alias_fk="norm_lab_test_id",
        get_main_values=lambda item: (
            item["canonical_code"],
            item["canonical_display"],
            item.get("loinc_code"),
            item.get("category"),
            item.get("unit_preferred"),
        ),
    )


async def _seed_diagnoses(db: aiosqlite.Connection, path: Path) -> None:
    await _seed_with_aliases(
        db,
        path,
        main_table="norm_diagnoses",
        main_columns=["canonical_code", "canonical_display", "icd10_code"],
        alias_table="norm_diagnosis_aliases",
        alias_fk="norm_diagnosis_id",
        get_main_values=lambda item: (
            item["canonical_code"],
            item["canonical_display"],
            item.get("icd10_code"),
        ),
    )


async def _seed_medications(db: aiosqlite.Connection, path: Path) -> None:
    await _seed_with_aliases(
        db,
        path,
        main_table="norm_medications",
        main_columns=["canonical_code", "canonical_display", "atc_code"],
        alias_table="norm_medication_aliases",
        alias_fk="norm_medication_id",
        get_main_values=lambda item: (
            item["canonical_code"],
            item["canonical_display"],
            item.get("atc_code"),
        ),
    )


async def _seed_specialties(db: aiosqlite.Connection, path: Path) -> None:
    await _seed_with_aliases(
        db,
        path,
        main_table="norm_specialties",
        main_columns=["canonical_code", "canonical_display"],
        alias_table="norm_specialty_aliases",
        alias_fk="norm_specialty_id",
        get_main_values=lambda item: (
            item["canonical_code"],
            item["canonical_display"],
        ),
    )
