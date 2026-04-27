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
    # produces no writes. Applied to doctors.name and doctors.canonical_display.
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

    if _doc_updates:
        await db.commit()
        logger.info(
            "Migration: stripped titles from %d doctor rows", _doc_updates,
        )

    # Also sweep doctor_aliases.alias — historically a row could be inserted
    # with an honorific ("Dr. Smith") as its alias even after the doctor's
    # own name had been cleaned, so the filter / autocomplete dropdowns kept
    # showing the uncleaned form. Guarded by an idempotent equality check,
    # so re-runs produce zero writes.
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='doctor_aliases'"
    )
    if await cursor.fetchone():
        cursor = await db.execute("SELECT id, alias FROM doctor_aliases")
        _alias_updates = 0
        for r in await cursor.fetchall():
            alias_id, cur_alias = r[0], r[1] or ""
            new_alias = normalize_name(strip_doctor_title(cur_alias))
            if new_alias and new_alias != cur_alias:
                try:
                    await db.execute(
                        "UPDATE doctor_aliases SET alias = ? WHERE id = ?",
                        (new_alias, alias_id),
                    )
                    _alias_updates += 1
                except aiosqlite.IntegrityError:
                    # Another alias row already holds the cleaned form — drop
                    # the duplicate instead of failing the whole migration.
                    await db.execute("DELETE FROM doctor_aliases WHERE id = ?", (alias_id,))
        if _alias_updates:
            await db.commit()
            logger.info(
                "Migration: stripped titles from %d doctor_aliases rows", _alias_updates,
            )

    # Keep encounters.{doctor_id,facility_id} and imaging_studies.{...} in
    # lockstep with the parent document via AFTER UPDATE triggers. Replaces
    # the belt-and-braces periodic re-sync that used to run on every startup
    # — the service layer already cascades on edits, and this catches any
    # direct SQL that bypasses it.
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

    # One-shot backfill for databases created before the triggers existed:
    # resolve any remaining drift so the two tables start clean. Idempotent
    # — the WHERE clauses short-circuit once everything is in sync.
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
    # available date. Post-rename, every document has a single event_date so
    # we just copy it forward. Idempotent — only touches NULL rows. Guarded
    # against databases that haven't run the event_date rename migration yet
    # (event_date is only available after the rename step below executes).
    cursor = await db.execute("PRAGMA table_info(documents)")
    _doc_cols_for_labs = [row[1] for row in await cursor.fetchall()]
    if "event_date" in _doc_cols_for_labs:
        await db.execute("""
            UPDATE lab_results
            SET test_date = (
                SELECT d.event_date FROM documents d WHERE d.id = lab_results.document_id
            )
            WHERE test_date IS NULL
        """)
    elif "doc_date" in _doc_cols_for_labs:
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

    # Phase 2 refactor: drop the denormalized doctor_name / facility_name columns
    # from documents. Readers now JOIN doctors / facilities on the FK. Idempotent
    # via the PRAGMA check below.
    cursor = await db.execute("PRAGMA table_info(documents)")
    doc_cols_now = [row[1] for row in await cursor.fetchall()]
    _denorm_dropped = 0
    if "doctor_name" in doc_cols_now:
        await db.execute("ALTER TABLE documents DROP COLUMN doctor_name")
        _denorm_dropped += 1
    if "facility_name" in doc_cols_now:
        await db.execute("ALTER TABLE documents DROP COLUMN facility_name")
        _denorm_dropped += 1
    if _denorm_dropped:
        await db.commit()
        logger.info("Migration: dropped %d denormalized name columns from documents", _denorm_dropped)

    # Phase 2 refactor: collapse date_visit / date_issued / doc_date into
    # event_date (canonical timeline anchor) + issued_date (administrative).
    # event_date takes the first non-null in the historic priority order.
    # Idempotent: only runs while the old columns still exist.
    cursor = await db.execute("PRAGMA table_info(documents)")
    doc_cols_now = [row[1] for row in await cursor.fetchall()]
    legacy_date_cols = {"doc_date", "date_visit", "date_issued"}
    if legacy_date_cols & set(doc_cols_now):
        # Drop FTS triggers + the virtual table FIRST. Otherwise the
        # backfill UPDATEs below fire the ``documents_au`` trigger, which
        # tries to delete-then-insert rows from a possibly-empty FTS index
        # (schema.sql's ``CREATE VIRTUAL TABLE IF NOT EXISTS`` just created
        # it blank on DBs that predate FTS5) and can corrupt it. We rebuild
        # the index at the end of this block.
        await db.execute("DROP TRIGGER IF EXISTS documents_ai")
        await db.execute("DROP TRIGGER IF EXISTS documents_au")
        await db.execute("DROP TRIGGER IF EXISTS documents_ad")
        await db.execute("DROP TABLE IF EXISTS documents_fts")

        if "event_date" not in doc_cols_now:
            await db.execute("ALTER TABLE documents ADD COLUMN event_date DATE")
        if "issued_date" not in doc_cols_now:
            await db.execute("ALTER TABLE documents ADD COLUMN issued_date DATE")
        await db.execute(
            "UPDATE documents SET event_date = COALESCE(date_visit, date_issued, doc_date) "
            "WHERE event_date IS NULL"
        )
        await db.execute(
            "UPDATE documents SET issued_date = date_issued WHERE issued_date IS NULL"
        )
        # SQLite refuses to drop a column an index still references. Drop
        # any legacy indexes on the doomed columns first — idx_documents_doc_date
        # comes from the pre-0.9 schema but other user-created indexes may
        # also be floating around, so discover them via sqlite_master.
        for col in ("doc_date", "date_visit", "date_issued"):
            idx_cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='documents' "
                "AND sql LIKE ?",
                (f"%({col})%",),
            )
            for (idx_name,) in await idx_cursor.fetchall():
                await db.execute(f"DROP INDEX IF EXISTS {idx_name}")
        for col in ("doc_date", "date_visit", "date_issued"):
            if col in doc_cols_now:
                await db.execute(f"ALTER TABLE documents DROP COLUMN {col}")
        await db.execute("DROP INDEX IF EXISTS idx_documents_doc_date")
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_documents_event_date ON documents(event_date)"
        )
        # Rebuild FTS5 virtual table + sync triggers
        await db.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                ocr_text,
                raw_extraction,
                content='documents',
                content_rowid='id'
            )
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
                INSERT INTO documents_fts(rowid, ocr_text, raw_extraction)
                VALUES (new.id, new.ocr_text, new.raw_extraction);
            END
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
                INSERT INTO documents_fts(documents_fts, rowid, ocr_text, raw_extraction)
                VALUES ('delete', old.id, old.ocr_text, old.raw_extraction);
            END
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
                INSERT INTO documents_fts(documents_fts, rowid, ocr_text, raw_extraction)
                VALUES ('delete', old.id, old.ocr_text, old.raw_extraction);
                INSERT INTO documents_fts(rowid, ocr_text, raw_extraction)
                VALUES (new.id, new.ocr_text, new.raw_extraction);
            END
        """)
        await db.execute("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')")
        await db.commit()
        logger.info("Migration: unified date columns into event_date + issued_date, rebuilt FTS5")

    # Always create the event_date index after the migration has had a
    # chance to add the column. Cannot live in schema.sql because
    # executescript() runs before this migration, and on a legacy DB the
    # column doesn't exist yet when the index statement fires.
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_event_date ON documents(event_date)"
    )

    # Normalize every canonical_code to kebab-case (lowercase, `-` as the
    # only word separator). Legacy seeds and LLM-emitted codes used
    # snake_case, so the Normalization settings UI showed a mix of
    # "essential_hypertension" and "25_hydroxy_vitamin_d" next to freshly
    # auto-created kebab entries. Idempotent — only touches rows that
    # actually need rewriting. Skips rows whose cleaned code would collide
    # with an existing row (UNIQUE constraint); the user can merge those
    # via the Normalization UI.
    from asclepius.pipeline.entity_matching import canonicalize_code
    _code_tables = (
        "norm_lab_tests",
        "norm_specialties",
        "norm_diagnoses",
        "norm_medications",
        "doctors",
        "facilities",
    )
    _code_updates = 0
    _code_skipped = 0
    for tbl in _code_tables:
        cursor = await db.execute(
            f"SELECT id, canonical_code FROM {tbl} WHERE canonical_code IS NOT NULL"
        )
        for r in await cursor.fetchall():
            row_id, cur_code = r[0], r[1] or ""
            new_code = canonicalize_code(cur_code)
            if not new_code or new_code == cur_code:
                continue
            try:
                await db.execute(
                    f"UPDATE {tbl} SET canonical_code = ? WHERE id = ?",
                    (new_code, row_id),
                )
                _code_updates += 1
            except aiosqlite.IntegrityError:
                _code_skipped += 1
    if _code_updates or _code_skipped:
        await db.commit()
        logger.info(
            "Migration: rewrote %d canonical_code values to kebab-case (%d skipped due to existing collision)",
            _code_updates, _code_skipped,
        )

    # Imaging-layout migration (0.9.5 → 0.9.6 shape). Studies used to live
    # under an ``imaging/`` subfolder of the year directory:
    #   patients/{slug}/{year}/imaging/{study}/...
    # The new layout drops that segment so studies sit at the same level
    # as document files (a study folder is a peer of a PDF):
    #   patients/{slug}/{year}/{study}/...
    # We move the on-disk folders and rewrite ``imaging_studies.folder_path``,
    # ``imaging_series.folder_path``, and ``documents.file_path`` to match.
    # Idempotent — paths that already lack ``imaging/`` are skipped.
    try:
        from asclepius.config import get_config as _get_config_for_layout
        _vault_root = Path(_get_config_for_layout().vault.root_path)
    except Exception:
        _vault_root = None

    if _vault_root is not None and _vault_root.exists():
        cursor = await db.execute(
            "SELECT id, folder_path FROM imaging_studies WHERE folder_path LIKE '%/imaging/%' OR folder_path LIKE 'unclassified/imaging/%'"
        )
        layout_rows = await cursor.fetchall()
        _moved_studies = 0
        import shutil as _shutil_layout
        for lrow in layout_rows:
            study_pk = lrow[0]
            old_folder = lrow[1] or ""
            if not old_folder:
                continue
            new_folder = old_folder.replace("/imaging/", "/", 1)
            if new_folder == old_folder:
                # Path didn't actually contain "/imaging/" (e.g. it begins
                # with "imaging/" literally — leave it alone).
                continue
            old_abs = _vault_root / old_folder
            new_abs = _vault_root / new_folder
            try:
                if old_abs.exists():
                    new_abs.parent.mkdir(parents=True, exist_ok=True)
                    if new_abs.exists():
                        # New path already populated — merge by leaving the
                        # legacy folder in place; admin can clean up later.
                        logger.warning(
                            "Migration: cannot move %s to %s — destination exists; skipping disk move",
                            old_abs, new_abs,
                        )
                    else:
                        _shutil_layout.move(str(old_abs), str(new_abs))
                # Rewrite folder_path on the study + every series under it.
                await db.execute(
                    "UPDATE imaging_studies SET folder_path = ? WHERE id = ?",
                    (new_folder, study_pk),
                )
                await db.execute(
                    "UPDATE imaging_series SET folder_path = REPLACE(folder_path, ?, ?) "
                    "WHERE study_id = ?",
                    (old_folder, new_folder, study_pk),
                )
                # Rewrite the canonical documents.file_path AND any leftover
                # per-frame paths in case the one-doc collapse runs after.
                await db.execute(
                    "UPDATE documents SET file_path = REPLACE(file_path, ?, ?) "
                    "WHERE file_path LIKE ?",
                    (old_folder, new_folder, old_folder + "%"),
                )
                _moved_studies += 1
            except Exception:
                logger.warning(
                    "Migration: failed to relocate imaging study %d (%s)",
                    study_pk, old_folder, exc_info=True,
                )

        # Sweep empty legacy ``imaging/`` directories left behind.
        for patient_dir in (_vault_root / "patients").glob("*"):
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
        legacy_unclass = _vault_root / "unclassified" / "imaging"
        if legacy_unclass.exists() and legacy_unclass.is_dir():
            try:
                if not any(legacy_unclass.iterdir()):
                    legacy_unclass.rmdir()
            except OSError:
                pass

        if _moved_studies:
            await db.commit()
            logger.info(
                "Migration: relocated %d imaging studies to drop the legacy 'imaging/' segment",
                _moved_studies,
            )

    # One-doc-per-imaging-study migration. The pre-0.9.5 ingest created a
    # documents row per DICOM frame (35 docs for a 35-frame ultrasound
    # study) and one per zip-member bundle file (DICOMDIR, JPEG previews,
    # LOCKFILE, VERSION). The new model is one canonical document per
    # study; bundle files live on disk under imaging-bundles/ but are not
    # separate documents. This migration collapses existing data:
    #   1. for each imaging_studies row, keep the documents row that
    #      study.document_id points to and rewrite its file_path to the
    #      study folder + file_hash to the deterministic
    #      ``asclepius-imaging-study:{uid_or_path}`` hash;
    #   2. delete every other ``doc_type='imaging_dicom'`` row whose
    #      file_path lives under that study's folder (the per-frame dupes);
    #   3. delete every ``doc_type='unknown_binary'`` row that lives under
    #      ``imaging-bundles/`` (the per-bundle-file dupes).
    # Idempotent — re-running finds no rows to collapse and leaves
    # already-cleaned canonical rows untouched.
    import hashlib as _hashlib
    cursor = await db.execute(
        "SELECT id, document_id, study_instance_uid, folder_path FROM imaging_studies"
    )
    studies_for_collapse = await cursor.fetchall()
    _collapsed_frames = 0
    _collapsed_bundles = 0
    _rewritten_docs = 0
    for srow in studies_for_collapse:
        canonical_doc_id = srow[1]
        study_uid = srow[2]
        folder_path = srow[3]
        if not folder_path or not canonical_doc_id:
            continue
        # 1. Rewrite the canonical document's identifying fields.
        study_key = study_uid or folder_path
        study_doc_hash = _hashlib.sha256(
            f"asclepius-imaging-study:{study_key}".encode("utf-8")
        ).hexdigest()
        study_folder_basename = folder_path.rsplit("/", 1)[-1] or folder_path
        # Only rewrite if not already in the new shape (file_path == folder
        # path AND file_hash == deterministic hash). Avoids unnecessary
        # writes on idempotent re-run.
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
                _rewritten_docs += 1
            except aiosqlite.IntegrityError:
                # Another row already holds the deterministic hash (e.g. the
                # migration was interrupted halfway). Skip — the duplicate
                # frame rows below will get cleaned up regardless.
                pass

        # 2. Delete the per-frame documents whose file_path lives under
        # this study's folder, except the canonical one.
        await db.execute(
            """DELETE FROM documents
               WHERE doc_type = 'imaging_dicom'
                 AND id != ?
                 AND file_path LIKE ?""",
            (canonical_doc_id, folder_path + "/%"),
        )
        _collapsed_frames += (await (await db.execute(
            "SELECT changes()"
        )).fetchone())[0]

    # 3. Drop bundle-file documents wholesale; the files stay on disk and
    # are now served via the imaging bundle-files endpoint.
    await db.execute(
        """DELETE FROM documents
           WHERE doc_type = 'unknown_binary'
             AND (file_path LIKE 'patients/%/imaging-bundles/%'
                  OR file_path LIKE 'unclassified/imaging-bundles/%')"""
    )
    _collapsed_bundles = (await (await db.execute(
        "SELECT changes()"
    )).fetchone())[0]

    if _rewritten_docs or _collapsed_frames or _collapsed_bundles:
        await db.commit()
        logger.info(
            "Migration: collapsed imaging documents — rewrote %d canonical, "
            "removed %d per-frame + %d bundle-file rows",
            _rewritten_docs, _collapsed_frames, _collapsed_bundles,
        )

    # Imaging-series cleanup. Two historical bugs corrupted the imaging
    # tables for any study ingested before the dicom_ingest fix:
    #   1. Frames whose DICOM file had no SeriesInstanceUID each created
    #      their own row in imaging_series (because ``WHERE
    #      series_instance_uid = NULL`` never matches in SQL), so a 35-
    #      frame ultrasound series ended up as 35 series of 1 frame.
    #   2. ``num_series`` on imaging_studies was set to 1 on study INSERT
    #      and never bumped, so a multi-series study still reported 1.
    # This block merges duplicate series rows (summing num_images into
    # the lowest-id keeper) and then recomputes both counters on every
    # parent study from the merged children. Idempotent — a clean DB
    # finds no duplicates and the counter recompute is a no-op.
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

    _merged_series = 0
    for grp in (*null_uid_groups, *uid_groups):
        # ``grp`` is a Row when row_factory is set, otherwise a tuple. Both
        # support index access. ids is a comma-separated list of row ids.
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
            _merged_series += 1

    # Recompute parent counters from the cleaned children. Run unconditionally
    # — re-running the migration after a fresh app version has been logging
    # correct counts is still a safe no-op.
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

    if _merged_series:
        await db.commit()
        logger.info(
            "Migration: merged %d duplicate imaging_series rows and recomputed study counters",
            _merged_series,
        )
    else:
        # Counter recompute may still have written rows; commit to flush.
        await db.commit()

    # 0.9.6: the parent document of an imaging study is now the radiology
    # REPORT, not the DICOM bundle. Existing rows with doc_type='imaging_dicom'
    # are flipped to 'imaging_report' and have file_path nulled out so they
    # become placeholders the user can populate by uploading the actual PDF.
    # imaging_studies gains a denormalised report_status flag.
    cursor = await db.execute("PRAGMA table_info(imaging_studies)")
    is_cols = [row[1] for row in await cursor.fetchall()]
    if "report_status" not in is_cols:
        await db.execute(
            "ALTER TABLE imaging_studies ADD COLUMN report_status TEXT NOT NULL DEFAULT 'placeholder'"
        )
        logger.info("Migration: added imaging_studies.report_status")

    # Convert pre-0.9.6 imaging documents in place. Their file_path used
    # to point at the DICOM study folder; from 0.9.6 onward that's a
    # placeholder until the user attaches a real PDF report.
    cursor = await db.execute(
        """SELECT d.id, COALESCE(s.modality, '') AS modality,
                  COALESCE(s.body_part, '') AS body_part,
                  COALESCE(s.study_date, '') AS study_date
           FROM documents d
           LEFT JOIN imaging_studies s ON s.document_id = d.id
           WHERE d.doc_type = 'imaging_dicom'"""
    )
    legacy_imaging_rows = await cursor.fetchall()
    _flipped = 0
    for r in legacy_imaging_rows:
        doc_pk = r[0]
        modality = (r[1] or "").strip()
        body_part = (r[2] or "").strip()
        study_date = (r[3] or "").strip()
        # Build a readable placeholder filename ("US ABDOMEN 2026-04-27 — report pending")
        bits = [b for b in (modality, body_part, study_date) if b]
        label = " ".join(bits) if bits else "Imaging"
        placeholder_name = f"{label} (report pending)"
        # documents.file_path is NOT NULL in the schema, so a placeholder
        # uses the empty string instead. Every consumer that checks for a
        # placeholder treats ``not file_path`` as "no PDF attached yet".
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
    # Set report_status = 'placeholder' for the studies whose document is
    # a placeholder (file_path is empty), 'attached' otherwise.
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

    # Compat view for external tooling that still expects the old
    # doctor_name / facility_name columns (see issue #16). Dropped and
    # recreated every init so the view re-binds to the current documents
    # columns after the date-unification migration above mutates them.
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
