"""Shared read-helpers for the ``norm_*_aliases`` tables.

Both :mod:`resolver` (one-shot alias cache used during extraction) and
:mod:`auto_merge` (bulk entry listing for the merge-proposal prompt)
need to pull rows out of the alias tables. They used to roll that
SELECT by hand; centralising it here means there is exactly one SQL
shape to audit when the schema changes.
"""

import aiosqlite


async def load_aliases_flat(
    db: aiosqlite.Connection, alias_table: str, fk_col: str,
) -> list[tuple[str, int]]:
    """Return every alias row as ``(alias_lower_stripped, parent_id)``.

    Blank aliases and null parent ids are dropped. Duplicates are
    preserved — callers that need uniqueness should feed the result into
    a dict or set.
    """
    cursor = await db.execute(
        f"SELECT alias, {fk_col} FROM {alias_table}"
    )
    rows = await cursor.fetchall()
    out: list[tuple[str, int]] = []
    for r in rows:
        alias, parent = r[0], r[1]
        if not alias or parent is None:
            continue
        out.append((str(alias).strip().lower(), int(parent)))
    return out


async def load_aliases_by_parent(
    db: aiosqlite.Connection, alias_table: str, fk_col: str,
) -> dict[int, list[str]]:
    """Return ``{parent_id: [alias, alias, ...]}`` keeping the raw casing.

    Aliases are returned in whatever order the DB yields them — callers
    that care about stability should sort themselves.
    """
    cursor = await db.execute(
        f"SELECT {fk_col} AS parent_id, alias FROM {alias_table}"
    )
    out: dict[int, list[str]] = {}
    for r in await cursor.fetchall():
        parent = r[0]
        alias = r[1]
        if parent is None or not alias:
            continue
        out.setdefault(int(parent), []).append(alias)
    return out
