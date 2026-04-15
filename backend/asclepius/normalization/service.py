"""Normalization service — CRUD and merge logic."""

import aiosqlite

# Whitelist of valid table and column names for normalization queries.
# All f-string SQL uses ONLY these validated names — never user input.
VALID_TABLES = {
    "norm_lab_tests", "norm_lab_test_aliases",
    "norm_specialties", "norm_specialty_aliases",
    "norm_diagnoses", "norm_diagnosis_aliases",
    "norm_medications", "norm_medication_aliases",
    "doctors", "doctor_aliases",
    "facilities", "facility_aliases",
    "lab_results", "encounters", "medications",
    "documents", "imaging_studies",
}

VALID_COLUMNS = {
    "norm_lab_test_id", "norm_specialty_id",
    "norm_diagnosis_id", "norm_medication_id",
    "doctor_id", "facility_id",
    "doctor_name", "facility_name",
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
        # Optional denormalized text columns to update on merge (e.g. documents.doctor_name)
        self.denorm_updates = [
            {"table": _validate_table(u["table"]),
             "fk_col": _validate_column(u["fk_col"]),
             "text_col": _validate_column(u["text_col"])}
            for u in tables.get("denorm_updates", [])
        ]

    async def list_all(self, filter_unreviewed: bool = False, search: str | None = None) -> list[dict]:
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
        cursor = await self.db.execute(
            f"SELECT * FROM {self.main_table} WHERE id = ?", (norm_id,)
        )
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
            updates["canonical_code"] = canonical_code
        if canonical_display is not None:
            updates["canonical_display"] = canonical_display

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [norm_id]
            await self.db.execute(
                f"UPDATE {self.main_table} SET {set_clause} WHERE id = ?", values
            )
            await self.db.commit()

        return await self.get_with_aliases(norm_id)

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

        # Update denormalized text fields (e.g. documents.doctor_name → target's canonical_display)
        if self.denorm_updates:
            cursor = await self.db.execute(
                f"SELECT canonical_display FROM {self.main_table} WHERE id = ?", (target_id,)
            )
            row = await cursor.fetchone()
            if row and row[0]:
                for upd in self.denorm_updates:
                    await self.db.execute(
                        f"UPDATE {upd['table']} SET {upd['text_col']} = ? WHERE {upd['fk_col']} = ?",
                        (row[0], target_id),
                    )

        # Delete source
        await self.db.execute(
            f"DELETE FROM {self.main_table} WHERE id = ?", (source_id,)
        )
        await self.db.commit()
