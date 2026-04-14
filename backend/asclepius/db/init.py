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
    """Run schema migrations for existing databases."""
    # Check if process_at column exists on documents table
    cursor = await db.execute("PRAGMA table_info(documents)")
    columns = [row[1] for row in await cursor.fetchall()]
    if "process_at" not in columns:
        await db.execute("ALTER TABLE documents ADD COLUMN process_at DATETIME")
        await db.commit()
        logger.info("Migration: added process_at column to documents")

    # Add error_message and retry_count to documents
    if "error_message" not in columns:
        await db.execute("ALTER TABLE documents ADD COLUMN error_message TEXT")
        await db.execute("ALTER TABLE documents ADD COLUMN retry_count INTEGER DEFAULT 0")
        await db.commit()
        logger.info("Migration: added error_message/retry_count to documents")

    # Add role column to users
    cursor = await db.execute("PRAGMA table_info(users)")
    user_columns = [row[1] for row in await cursor.fetchall()]
    if "role" not in user_columns:
        await db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'")
        # Make the first user (id=1) an admin
        await db.execute("UPDATE users SET role = 'admin' WHERE id = 1")
        await db.commit()
        logger.info("Migration: added role column to users, first user set to admin")

    # Create audit_log table
    await db.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            action TEXT NOT NULL,
            resource_type TEXT,
            resource_id INTEGER,
            details TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)")

    # Create ocr_page_cache table
    await db.execute("""
        CREATE TABLE IF NOT EXISTS ocr_page_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            page_number INTEGER NOT NULL,
            ocr_text TEXT NOT NULL,
            ocr_engine TEXT,
            confidence REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(document_id, page_number)
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_ocr_page_cache_doc ON ocr_page_cache(document_id)")

    # Add unique constraint on document_links to prevent exact duplicates
    # First deduplicate any existing rows, keeping the oldest
    await db.execute("""
        DELETE FROM document_links WHERE id NOT IN (
            SELECT MIN(id) FROM document_links
            GROUP BY source_document_id, target_document_id
        )
    """)
    await db.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_document_links_unique
        ON document_links(source_document_id, target_document_id)
    """)

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
