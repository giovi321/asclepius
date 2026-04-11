"""Database initialization and seed loading."""

import json
import logging
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
SEEDS_DIR = Path("/config/seeds")


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


async def _seed_normalization_tables(db: aiosqlite.Connection) -> None:
    """Load seed data from JSON files into normalization tables."""
    seeds_dir = SEEDS_DIR
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
