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

    # Server-side sessions — lets admins list and revoke live logins.
    # session_id is a random 256-bit token stored in the user's signed cookie;
    # the row is the source of truth for whether the session is still valid.
    await db.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            revoked_at DATETIME
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(revoked_at, expires_at)")

    # Prune the patient profile down to fields that actually serve either the
    # LLM (name, DOB, sex) or the user's internal bookkeeping (slug, created).
    # Blood type / allergies / contact info / insurance were dead weight —
    # never passed to the LLM for extraction and not needed by any view.
    cursor = await db.execute("PRAGMA table_info(patients)")
    patient_cols = [row[1] for row in await cursor.fetchall()]
    _dropped = 0
    for col in (
        "blood_type", "allergies", "notes",
        "phone", "email", "address",
        "insurance_company", "insurance_number",
    ):
        if col in patient_cols:
            await db.execute(f"ALTER TABLE patients DROP COLUMN {col}")
            _dropped += 1
    if _dropped:
        await db.commit()
        logger.info("Migration: dropped %d legacy columns from patients", _dropped)

    # Chat history carries a JSON blob of source documents on assistant
    # messages so the UI can show document chips when the history is
    # reloaded, not just on the live reply.
    cursor = await db.execute("PRAGMA table_info(chat_history)")
    chat_cols = [row[1] for row in await cursor.fetchall()]
    if "sources" not in chat_cols:
        await db.execute("ALTER TABLE chat_history ADD COLUMN sources TEXT")
        await db.commit()
        logger.info("Migration: added sources column to chat_history")

    # Sweep existing doctor names: strip honorific titles (Dr., Dott.ssa,
    # Prof., etc.) so stored names hold the raw person-name only. The sweep
    # is idempotent — re-running the migration against already-cleaned rows
    # produces no writes. Applied to doctors.name, doctors.canonical_display,
    # and the denormalised documents.doctor_name column.
    from asclepius.pipeline.extractor import strip_doctor_title, normalize_name
    cursor = await db.execute("SELECT id, name, canonical_display FROM doctors")
    _doc_updates = 0
    for r in await cursor.fetchall():
        doc_id, cur_name, cur_canonical = r[0], r[1] or "", r[2]
        new_name = normalize_name(strip_doctor_title(cur_name))
        new_canonical = (
            normalize_name(strip_doctor_title(cur_canonical))
            if cur_canonical else cur_canonical
        )
        if new_name != cur_name or new_canonical != cur_canonical:
            await db.execute(
                "UPDATE doctors SET name = ?, canonical_display = ? WHERE id = ?",
                (new_name, new_canonical, doc_id),
            )
            _doc_updates += 1

    cursor = await db.execute(
        "SELECT id, doctor_name FROM documents WHERE doctor_name IS NOT NULL AND doctor_name <> ''"
    )
    _denorm_updates = 0
    for r in await cursor.fetchall():
        new_name = normalize_name(strip_doctor_title(r[1]))
        if new_name != r[1]:
            await db.execute(
                "UPDATE documents SET doctor_name = ? WHERE id = ?",
                (new_name, r[0]),
            )
            _denorm_updates += 1

    if _doc_updates or _denorm_updates:
        await db.commit()
        logger.info(
            "Migration: stripped titles from %d doctor rows and %d document.doctor_name values",
            _doc_updates, _denorm_updates,
        )

    # Resync child rows whose doctor_id / facility_id drifted from the owning
    # document. Happens when a user corrected the doctor / facility on a
    # document before the cascade in update_document_fields existed — the
    # parent pointed to the right canonical entry, the children still pointed
    # to the old one, and the normalization view showed stale references.
    # Idempotent.
    await db.execute("""
        UPDATE encounters
        SET facility_id = (SELECT d.facility_id FROM documents d WHERE d.id = encounters.document_id)
        WHERE EXISTS (
            SELECT 1 FROM documents d
            WHERE d.id = encounters.document_id
              AND COALESCE(d.facility_id, -1) != COALESCE(encounters.facility_id, -1)
        )
    """)
    await db.execute("""
        UPDATE encounters
        SET doctor_id = (SELECT d.doctor_id FROM documents d WHERE d.id = encounters.document_id)
        WHERE EXISTS (
            SELECT 1 FROM documents d
            WHERE d.id = encounters.document_id
              AND COALESCE(d.doctor_id, -1) != COALESCE(encounters.doctor_id, -1)
        )
    """)
    await db.execute("""
        UPDATE imaging_studies
        SET facility_id = (SELECT d.facility_id FROM documents d WHERE d.id = imaging_studies.document_id)
        WHERE EXISTS (
            SELECT 1 FROM documents d
            WHERE d.id = imaging_studies.document_id
              AND COALESCE(d.facility_id, -1) != COALESCE(imaging_studies.facility_id, -1)
        )
    """)
    await db.execute("""
        UPDATE imaging_studies
        SET doctor_id = (SELECT d.doctor_id FROM documents d WHERE d.id = imaging_studies.document_id)
        WHERE EXISTS (
            SELECT 1 FROM documents d
            WHERE d.id = imaging_studies.document_id
              AND COALESCE(d.doctor_id, -1) != COALESCE(imaging_studies.doctor_id, -1)
        )
    """)
    await db.commit()

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

    # Add canonical_code/canonical_display + alias tables for doctors & facilities
    cursor = await db.execute("PRAGMA table_info(doctors)")
    doctor_cols = [row[1] for row in await cursor.fetchall()]
    if "canonical_code" not in doctor_cols:
        await db.execute("ALTER TABLE doctors ADD COLUMN canonical_code TEXT")
        await db.execute("ALTER TABLE doctors ADD COLUMN canonical_display TEXT")
        await db.execute("UPDATE doctors SET canonical_code = slug, canonical_display = name WHERE canonical_code IS NULL")
        logger.info("Migration: added canonical_code/canonical_display to doctors")

    cursor = await db.execute("PRAGMA table_info(facilities)")
    facility_cols = [row[1] for row in await cursor.fetchall()]
    if "canonical_code" not in facility_cols:
        await db.execute("ALTER TABLE facilities ADD COLUMN canonical_code TEXT")
        await db.execute("ALTER TABLE facilities ADD COLUMN canonical_display TEXT")
        await db.execute("UPDATE facilities SET canonical_code = slug, canonical_display = name WHERE canonical_code IS NULL")
        logger.info("Migration: added canonical_code/canonical_display to facilities")

    # Create alias tables (idempotent)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS doctor_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            language TEXT,
            auto_mapped BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_doctor_aliases_alias ON doctor_aliases(alias)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_doctor_aliases_fk ON doctor_aliases(doctor_id)")

    await db.execute("""
        CREATE TABLE IF NOT EXISTS facility_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            language TEXT,
            auto_mapped BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_facility_aliases_alias ON facility_aliases(alias)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_facility_aliases_fk ON facility_aliases(facility_id)")

    # Backfill alias rows for existing doctors/facilities that don't have any yet
    await db.execute("""
        INSERT OR IGNORE INTO doctor_aliases (doctor_id, alias, auto_mapped)
        SELECT id, name, 0 FROM doctors
        WHERE id NOT IN (SELECT DISTINCT doctor_id FROM doctor_aliases)
    """)
    await db.execute("""
        INSERT OR IGNORE INTO facility_aliases (facility_id, alias, auto_mapped)
        SELECT id, name, 0 FROM facilities
        WHERE id NOT IN (SELECT DISTINCT facility_id FROM facility_aliases)
    """)

    # Backfill NULL canonical_code/display from slug/name (idempotent — covers rows
    # created before the migration ran or inserted without those fields populated).
    await db.execute(
        "UPDATE doctors SET canonical_code = slug WHERE canonical_code IS NULL OR canonical_code = ''"
    )
    await db.execute(
        "UPDATE doctors SET canonical_display = name WHERE canonical_display IS NULL OR canonical_display = ''"
    )
    await db.execute(
        "UPDATE facilities SET canonical_code = slug WHERE canonical_code IS NULL OR canonical_code = ''"
    )
    await db.execute(
        "UPDATE facilities SET canonical_display = name WHERE canonical_display IS NULL OR canonical_display = ''"
    )

    # Unique indexes on canonical_code (can't do via ALTER TABLE in SQLite)
    await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_doctors_canonical_code ON doctors(canonical_code)")
    await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_facilities_canonical_code ON facilities(canonical_code)")

    # Per-user document attribution. Nullable on purpose — legacy rows created
    # before this column existed stay NULL and are treated as admin-only in
    # the list handlers.
    cursor = await db.execute("PRAGMA table_info(documents)")
    doc_cols = [row[1] for row in await cursor.fetchall()]
    if "uploaded_by_user_id" not in doc_cols:
        await db.execute(
            "ALTER TABLE documents ADD COLUMN uploaded_by_user_id INTEGER REFERENCES users(id)"
        )
        # Best-effort backfill: if a document's patient has exactly one
        # user with access, attribute it to that user. Others stay NULL.
        await db.execute("""
            UPDATE documents
            SET uploaded_by_user_id = (
                SELECT upa.user_id FROM user_patient_access upa
                WHERE upa.patient_id = documents.patient_id
                GROUP BY upa.patient_id
                HAVING COUNT(*) = 1
            )
            WHERE uploaded_by_user_id IS NULL AND patient_id IS NOT NULL
        """)
        logger.info("Migration: added uploaded_by_user_id to documents")
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by_user_id)"
    )

    # Backfill NULL created_at on legacy rows so the Documents page's "Date
    # added" column always has something to show. Uses the document's
    # updated_at when it's populated (closest proxy for the real write time),
    # falling back to CURRENT_TIMESTAMP as a last resort.
    await db.execute("""
        UPDATE documents
        SET created_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
        WHERE created_at IS NULL
    """)

    # Auto-confirm aliases that are trivially identical to their parent's canonical
    # display name — there is nothing to review when the alias IS the canonical form.
    # Idempotent.
    for alias_table, parent_table, fk in [
        ("doctor_aliases", "doctors", "doctor_id"),
        ("facility_aliases", "facilities", "facility_id"),
        ("norm_lab_test_aliases", "norm_lab_tests", "norm_lab_test_id"),
        ("norm_specialty_aliases", "norm_specialties", "norm_specialty_id"),
        ("norm_diagnosis_aliases", "norm_diagnoses", "norm_diagnosis_id"),
        ("norm_medication_aliases", "norm_medications", "norm_medication_id"),
    ]:
        await db.execute(f"""
            UPDATE {alias_table}
            SET auto_mapped = 0
            WHERE auto_mapped = 1
              AND EXISTS (
                  SELECT 1 FROM {parent_table} p
                  WHERE p.id = {alias_table}.{fk}
                    AND LOWER(TRIM(p.canonical_display)) = LOWER(TRIM({alias_table}.alias))
              )
        """)

    # Backfill NULL lab_results.test_date from the parent document's best
    # available date (date_visit > date_issued > doc_date). Historically the
    # extractor only propagated the LLM-emitted doc_date, so rows created
    # before the extraction fix landed can have NULL test_date even though
    # their document has a date. Idempotent — only touches NULL rows.
    await db.execute("""
        UPDATE lab_results
        SET test_date = (
            SELECT COALESCE(d.date_visit, d.date_issued, d.doc_date)
            FROM documents d WHERE d.id = lab_results.document_id
        )
        WHERE test_date IS NULL
    """)

    # Extraction corrections table (correction-driven learning)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS extraction_corrections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            field_name TEXT NOT NULL,
            llm_value TEXT,
            corrected_value TEXT,
            facility_id INTEGER,
            doc_type TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_corrections_doc ON extraction_corrections(document_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_corrections_facility ON extraction_corrections(facility_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_corrections_type ON extraction_corrections(doc_type)")

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
