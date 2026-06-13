"""Tests for the PRAGMA-correct connection helper (Phase 0 data-integrity fix).

Background workers and the pipeline used to open raw ``aiosqlite.connect()``
connections that skipped ``PRAGMA foreign_keys=ON``. Because foreign_keys is a
per-connection setting, ``ON DELETE CASCADE`` silently did not fire on those
connections, orphaning child rows. ``open_db()`` centralizes the PRAGMAs.
"""

import pytest
import aiosqlite

from asclepius.db.connection import open_db, set_db_path


@pytest.mark.asyncio
async def test_open_db_applies_pragmas(db, db_path):
    set_db_path(db_path)
    async with open_db() as conn:
        assert conn.row_factory is aiosqlite.Row
        fk = await (await conn.execute("PRAGMA foreign_keys")).fetchone()
        assert fk[0] == 1
        bt = await (await conn.execute("PRAGMA busy_timeout")).fetchone()
        assert bt[0] >= 5000


@pytest.mark.asyncio
async def test_open_db_cascade_delete_fires(db, db_path):
    set_db_path(db_path)
    async with open_db() as conn:
        cur = await conn.execute(
            "INSERT INTO patients (slug, display_name) VALUES ('casc', 'Cascade')"
        )
        pid = cur.lastrowid
        cur = await conn.execute(
            "INSERT INTO documents (patient_id, file_path, original_filename, status) "
            "VALUES (?, 'a/b.pdf', 'b.pdf', 'done')",
            (pid,),
        )
        did = cur.lastrowid
        await conn.execute(
            "INSERT INTO lab_results (document_id, patient_id, test_name_original, value) "
            "VALUES (?, ?, 'Hb', 14.0)",
            (did, pid),
        )
        await conn.commit()

        # Deleting the parent document must cascade to the lab_results child.
        await conn.execute("DELETE FROM documents WHERE id = ?", (did,))
        await conn.commit()

        remaining = await (
            await conn.execute("SELECT COUNT(*) FROM lab_results WHERE document_id = ?", (did,))
        ).fetchone()
        assert remaining[0] == 0
