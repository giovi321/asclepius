"""Normalization service — CRUD and merge logic."""

import aiosqlite


class NormService:
    """Generic normalization table service."""

    def __init__(self, db: aiosqlite.Connection, tables: dict):
        self.db = db
        self.main_table = tables["main"]
        self.alias_table = tables["aliases"]
        self.fk_col = tables["fk"]
        self.ref_table = tables["ref_table"]
        self.ref_col = tables["ref_col"]

    async def list_all(self, filter_unreviewed: bool = False, search: str | None = None) -> list[dict]:
        if search:
            # Search in canonical_display, canonical_code, and aliases
            like = f"%{search}%"
            cursor = await self.db.execute(
                f"""SELECT DISTINCT m.* FROM {self.main_table} m
                    LEFT JOIN {self.alias_table} a ON a.{self.fk_col} = m.id
                    WHERE m.canonical_display LIKE ? OR m.canonical_code LIKE ? OR a.alias LIKE ?
                    ORDER BY m.canonical_display""",
                (like, like, like),
            )
        else:
            cursor = await self.db.execute(f"SELECT * FROM {self.main_table} ORDER BY canonical_display")

        items = []
        for row in await cursor.fetchall():
            item = dict(row)
            # Get alias counts
            alias_cursor = await self.db.execute(
                f"SELECT COUNT(*) FROM {self.alias_table} WHERE {self.fk_col} = ?",
                (item["id"],),
            )
            alias_count = (await alias_cursor.fetchone())[0]
            item["alias_count"] = alias_count

            # Get unreviewed count
            alias_cursor = await self.db.execute(
                f"SELECT COUNT(*) FROM {self.alias_table} WHERE {self.fk_col} = ? AND auto_mapped = 1",
                (item["id"],),
            )
            unreviewed = (await alias_cursor.fetchone())[0]
            item["unreviewed_count"] = unreviewed

            if filter_unreviewed and unreviewed == 0:
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

        # Update references in data tables
        await self.db.execute(
            f"UPDATE {self.ref_table} SET {self.ref_col} = ? WHERE {self.ref_col} = ?",
            (target_id, source_id),
        )

        # Delete source
        await self.db.execute(
            f"DELETE FROM {self.main_table} WHERE id = ?", (source_id,)
        )
        await self.db.commit()
