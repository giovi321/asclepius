"""Normalization service — CRUD and merge logic."""

import aiosqlite

from asclepius.pipeline.entity_matching import canonicalize_code

# Whitelist of valid table and column names for normalization queries.
# All f-string SQL uses ONLY these validated names — never user input.
VALID_TABLES = {
    "norm_lab_tests",
    "norm_lab_test_aliases",
    "norm_specialties",
    "norm_specialty_aliases",
    "norm_diagnoses",
    "norm_diagnosis_aliases",
    "norm_medications",
    "norm_medication_aliases",
    "doctors",
    "doctor_aliases",
    "facilities",
    "facility_aliases",
    "lab_results",
    "encounters",
    "medications",
    "documents",
    "imaging_studies",
}

VALID_COLUMNS = {
    "norm_lab_test_id",
    "norm_specialty_id",
    "norm_diagnosis_id",
    "norm_medication_id",
    "doctor_id",
    "facility_id",
    "name",
}


def _validate_table(name: str) -> str:
    """Validate a table name against the whitelist. Raises ValueError if invalid."""
    if name not in VALID_TABLES:
        raise ValueError(f"Invalid table name: {name}")
    return name


def _validate_column(name: str) -> str:
    """Validate a column name against the whitelist. Raises ValueError if invalid."""
    if name not in VALID_COLUMNS:
        raise ValueError(f"Invalid column name: {name}")
    return name


class NormService:
    """Generic normalization table service."""

    def __init__(self, db: aiosqlite.Connection, tables: dict):
        self.db = db
        # Validate all table/column names at construction time
        self.main_table = _validate_table(tables["main"])
        self.alias_table = _validate_table(tables["aliases"])
        self.fk_col = _validate_column(tables["fk"])
        # Support multiple reference tables (for doctors/facilities that are referenced
        # from documents, encounters, etc.) — backward-compatible with single ref_table
        if "ref_tables" in tables:
            self.ref_tables = [
                (_validate_table(r["table"]), _validate_column(r["col"]))
                for r in tables["ref_tables"]
            ]
        else:
            self.ref_tables = [
                (_validate_table(tables["ref_table"]), _validate_column(tables["ref_col"]))
            ]
        # Tables to walk to find documents referencing this norm entry.
        # Each entry is (table, fk_col). `documents` is queried by its own id;
        # other tables must have a `document_id` column linking back to documents.
        self.doc_sources = [
            (_validate_table(t), _validate_column(c)) for (t, c) in tables.get("doc_sources", [])
        ]

    async def list_all(
        self, filter_unreviewed: bool = False, search: str | None = None
    ) -> list[dict]:
        """List all normalization entries with alias/unreviewed counts.

        Uses a single query with JOINs instead of N+1 per-row queries.
        """
        if search:
            like = f"%{search}%"
            query = f"""
                SELECT m.*,
                       COUNT(DISTINCT a_all.id) AS alias_count,
                       COUNT(DISTINCT a_unrev.id) AS unreviewed_count
                FROM {self.main_table} m
                LEFT JOIN {self.alias_table} a_all ON a_all.{self.fk_col} = m.id
                LEFT JOIN {self.alias_table} a_unrev ON a_unrev.{self.fk_col} = m.id AND a_unrev.auto_mapped = 1
                LEFT JOIN {self.alias_table} a_search ON a_search.{self.fk_col} = m.id
                WHERE m.canonical_display LIKE ? OR m.canonical_code LIKE ? OR a_search.alias LIKE ?
                GROUP BY m.id
                ORDER BY m.canonical_display
            """
            cursor = await self.db.execute(query, (like, like, like))
        else:
            query = f"""
                SELECT m.*,
                       COUNT(DISTINCT a_all.id) AS alias_count,
                       COUNT(DISTINCT a_unrev.id) AS unreviewed_count
                FROM {self.main_table} m
                LEFT JOIN {self.alias_table} a_all ON a_all.{self.fk_col} = m.id
                LEFT JOIN {self.alias_table} a_unrev ON a_unrev.{self.fk_col} = m.id AND a_unrev.auto_mapped = 1
                GROUP BY m.id
                ORDER BY m.canonical_display
            """
            cursor = await self.db.execute(query)

        items = []
        for row in await cursor.fetchall():
            item = dict(row)
            if filter_unreviewed and item.get("unreviewed_count", 0) == 0:
                continue
            items.append(item)
        return items

    async def get_with_aliases(self, norm_id: int) -> dict | None:
        cursor = await self.db.execute(f"SELECT * FROM {self.main_table} WHERE id = ?", (norm_id,))
        row = await cursor.fetchone()
        if not row:
            return None

        item = dict(row)

        alias_cursor = await self.db.execute(
            f"SELECT * FROM {self.alias_table} WHERE {self.fk_col} = ? ORDER BY alias",
            (norm_id,),
        )
        item["aliases"] = [dict(r) for r in await alias_cursor.fetchall()]
        return item

    async def update(
        self, norm_id: int, canonical_code: str | None, canonical_display: str | None
    ) -> dict:
        updates = {}
        if canonical_code is not None:
            updates["canonical_code"] = canonicalize_code(canonical_code) or canonical_code
        if canonical_display is not None:
            updates["canonical_display"] = canonical_display
            # For doctors/facilities the rest of the app reads the `name` column
            # (document lists, filter dropdowns, extractor slug matching). Keep
            # it in sync so an edit here is actually visible elsewhere.
            if self.main_table in ("doctors", "facilities"):
                updates["name"] = canonical_display

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [norm_id]
            await self.db.execute(f"UPDATE {self.main_table} SET {set_clause} WHERE id = ?", values)
            await self.db.commit()

        return await self.get_with_aliases(norm_id)

    async def create_entry(self, canonical_code: str, canonical_display: str) -> int:
        """Create a new canonical entry and return its id.

        For doctors/facilities the extra required columns (`name`, `slug`) are
        populated from canonical_display / canonical_code so the row matches
        what _upsert_facility / _upsert_doctor would have inserted. For the
        generic `norm_*` tables only the canonical pair is stored.
        """
        from asclepius.patients.service import slugify

        raw_code = (canonical_code or "").strip() or slugify(canonical_display)
        code = canonicalize_code(raw_code) or raw_code
        display = canonical_display.strip()

        if self.main_table in ("doctors", "facilities"):
            # Derive / validate slug — must be unique
            slug = code or slugify(display)
            # If slug collides, disambiguate with a numeric suffix
            n = 1
            base_slug = slug
            while True:
                cursor = await self.db.execute(
                    f"SELECT 1 FROM {self.main_table} WHERE slug = ?", (slug,)
                )
                if not await cursor.fetchone():
                    break
                n += 1
                slug = f"{base_slug}-{n}"

            cursor = await self.db.execute(
                f"INSERT INTO {self.main_table} (name, slug, canonical_code, canonical_display) VALUES (?, ?, ?, ?)",
                (display, slug, code or slug, display),
            )
            new_id = cursor.lastrowid
            # Seed an alias row so list/count queries behave consistently
            await self.db.execute(
                f"INSERT INTO {self.alias_table} ({self.fk_col}, alias, auto_mapped) VALUES (?, ?, 0)",
                (new_id, display),
            )
            await self.db.commit()
            return new_id

        # Generic norm_* table — canonical pair only
        cursor = await self.db.execute(
            f"INSERT INTO {self.main_table} (canonical_code, canonical_display) VALUES (?, ?)",
            (code, display),
        )
        new_id = cursor.lastrowid
        await self.db.commit()
        return new_id

    async def delete_entry(self, norm_id: int) -> None:
        """Delete a canonical entry.

        Clears every referencing FK back to NULL, removes aliases, then
        deletes the main row. Commits once.
        """
        # Null the FKs on every referencing table.
        for ref_table, ref_col in self.ref_tables:
            await self.db.execute(
                f"UPDATE {ref_table} SET {ref_col} = NULL WHERE {ref_col} = ?",
                (norm_id,),
            )
        # 3. Aliases: clean explicitly — alias tables use ON DELETE CASCADE on
        #    facility/doctor, but the norm_* alias tables may differ across
        #    older DBs. Explicit delete is safe either way.
        await self.db.execute(f"DELETE FROM {self.alias_table} WHERE {self.fk_col} = ?", (norm_id,))
        # 4. Finally, delete the main row.
        await self.db.execute(f"DELETE FROM {self.main_table} WHERE id = ?", (norm_id,))
        await self.db.commit()

    async def list_documents(self, norm_id: int) -> list[dict]:
        """Return all documents that reference this norm entry.

        Walks self.doc_sources — each entry is (table, fk_col). For `documents`
        the fk_col is on documents itself; for other tables (lab_results,
        encounters, medications, imaging_studies) it's a join via document_id.
        """
        doc_ids: set[int] = set()
        for table, fk_col in self.doc_sources:
            if table == "documents":
                sql = f"SELECT id FROM documents WHERE {fk_col} = ?"
            else:
                sql = f"SELECT DISTINCT document_id FROM {table} WHERE {fk_col} = ?"
            cursor = await self.db.execute(sql, (norm_id,))
            for row in await cursor.fetchall():
                if row[0]:
                    doc_ids.add(row[0])

        if not doc_ids:
            return []

        placeholders = ",".join("?" * len(doc_ids))
        cursor = await self.db.execute(
            f"""SELECT d.id, d.original_filename, d.doc_type, d.event_date,
                       d.patient_id, p.display_name AS patient_name
                FROM documents d
                LEFT JOIN patients p ON p.id = d.patient_id
                WHERE d.id IN ({placeholders})
                ORDER BY d.event_date DESC, d.id DESC""",
            list(doc_ids),
        )
        return [dict(r) for r in await cursor.fetchall()]

    async def add_alias(self, norm_id: int, alias: str, language: str | None) -> dict:
        await self.db.execute(
            f"INSERT INTO {self.alias_table} ({self.fk_col}, alias, language, auto_mapped) VALUES (?, ?, ?, 0)",
            (norm_id, alias, language),
        )
        await self.db.commit()
        return await self.get_with_aliases(norm_id)

    async def remove_alias(self, alias_id: int) -> None:
        await self.db.execute(f"DELETE FROM {self.alias_table} WHERE id = ?", (alias_id,))
        await self.db.commit()

    async def confirm_aliases(self, norm_id: int) -> None:
        await self.db.execute(
            f"UPDATE {self.alias_table} SET auto_mapped = 0 WHERE {self.fk_col} = ?",
            (norm_id,),
        )
        await self.db.commit()

    async def merge(self, source_id: int, target_id: int) -> None:
        """Merge source into target. Moves all aliases and references."""
        await self._merge_one(source_id, target_id)
        await self.db.commit()

    async def merge_batch(self, source_ids: list[int], target_id: int) -> None:
        """Merge multiple sources into a target in a single transaction."""
        for sid in source_ids:
            if sid == target_id:
                continue
            await self._merge_one(sid, target_id)
        await self.db.commit()

    async def _merge_one(self, source_id: int, target_id: int) -> None:
        """Merge logic without commit — caller is responsible for committing."""
        if source_id == target_id:
            return

        # Fetch target canonical_display once — used for denorm updates and correction logging
        cursor = await self.db.execute(
            f"SELECT canonical_display FROM {self.main_table} WHERE id = ?", (target_id,)
        )
        target_row = await cursor.fetchone()
        target_display = target_row[0] if target_row else None

        # Before touching FKs, capture correction data for documents that link to the source.
        # This teaches the few-shot retriever that "source name → target display".
        await self._log_merge_corrections(source_id, target_display)

        # Insert the source's own name as an alias on the target, so future extractions
        # of the source name resolve to the target via _upsert_* alias lookup.
        await self._copy_source_name_as_alias(source_id, target_id)

        # Move aliases
        await self.db.execute(
            f"UPDATE {self.alias_table} SET {self.fk_col} = ? WHERE {self.fk_col} = ?",
            (target_id, source_id),
        )

        # Update references in all data tables
        for ref_table, ref_col in self.ref_tables:
            await self.db.execute(
                f"UPDATE {ref_table} SET {ref_col} = ? WHERE {ref_col} = ?",
                (target_id, source_id),
            )

        # Delete source
        await self.db.execute(f"DELETE FROM {self.main_table} WHERE id = ?", (source_id,))

    async def _copy_source_name_as_alias(self, source_id: int, target_id: int) -> None:
        """Copy the source row's display name as an alias on the target.

        Only applies to entities whose main table has a `name` column (doctors, facilities).
        """
        if self.main_table not in ("doctors", "facilities"):
            return
        cursor = await self.db.execute(
            f"SELECT name FROM {self.main_table} WHERE id = ?", (source_id,)
        )
        row = await cursor.fetchone()
        if not row or not row[0]:
            return
        name = row[0]
        # Avoid dupes — check if target already has this alias
        dup_cursor = await self.db.execute(
            f"SELECT 1 FROM {self.alias_table} WHERE {self.fk_col} = ? AND alias = ? COLLATE NOCASE LIMIT 1",
            (target_id, name),
        )
        if await dup_cursor.fetchone():
            return
        await self.db.execute(
            f"INSERT INTO {self.alias_table} ({self.fk_col}, alias, auto_mapped) VALUES (?, ?, 0)",
            (target_id, name),
        )

    async def _log_merge_corrections(self, source_id: int, target_display: str | None) -> None:
        """Log extraction_corrections for documents affected by this merge.

        Only applies to doctor / facility merges — other norm tables don't
        surface free-text values on documents. The LLM value is recovered
        from raw_extraction JSON (which survived the denormalized-column
        drop) so the few-shot retriever can still learn from the merge.
        """
        import json

        if not target_display:
            return
        if self.main_table == "doctors":
            field_name = "doctor_name"
            fk_col = "doctor_id"
            raw_path = ("doctor", "name")
        elif self.main_table == "facilities":
            field_name = "facility_name"
            fk_col = "facility_id"
            raw_path = ("facility", "name")
        else:
            return
        cursor = await self.db.execute(
            f"""SELECT id, raw_extraction, doc_type, facility_id
                FROM documents
                WHERE {fk_col} = ? AND raw_extraction IS NOT NULL""",
            (source_id,),
        )
        rows = await cursor.fetchall()
        for r in rows:
            doc_id, raw_value, doc_type, facility_id = r[0], r[1], r[2], r[3]
            try:
                raw = json.loads(raw_value) if isinstance(raw_value, str) else raw_value
            except (TypeError, ValueError):
                continue
            llm_value = raw
            for key in raw_path:
                if not isinstance(llm_value, dict):
                    llm_value = None
                    break
                llm_value = llm_value.get(key)
            llm_value_str = str(llm_value) if llm_value is not None else None
            if llm_value_str == target_display:
                continue
            await self.db.execute(
                """INSERT INTO extraction_corrections
                   (document_id, field_name, llm_value, corrected_value, facility_id, doc_type)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (doc_id, field_name, llm_value_str, target_display, facility_id, doc_type),
            )
