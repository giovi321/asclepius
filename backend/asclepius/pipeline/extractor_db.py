"""Database resolvers for normalized reference tables.

These helpers translate raw LLM-emitted canonical codes / original strings
into ``norm_*`` table primary keys, creating rows on demand when a canonical
code is supplied and no match exists. Kept separate from entity_matching so
the patient/doctor/facility upserts can be reused without pulling in the
lab-results / diagnoses / medications machinery.
"""

import aiosqlite

from asclepius.pipeline.entity_matching import canonicalize_code


async def _resolve_norm(
    db: aiosqlite.Connection,
    *,
    main_table: str,
    alias_table: str,
    fk_col: str,
    canonical: str,
    original: str,
    extra_cols: dict[str, object] | None = None,
    lookup_by_canonical: bool = True,
    reselect_on_conflict: bool = False,
) -> int | None:
    """Shared resolver for the ``norm_*`` reference tables.

    Behaviour (identical to the per-entity resolvers it replaces):

    1. If ``canonical`` is set *and* ``lookup_by_canonical`` is True, look it
       up in ``main_table`` by ``canonical_code`` and return the existing id
       on a hit. (Lab tests pass ``lookup_by_canonical=False`` when the LLM
       did not flag the row as mapped — mirroring the old ``mapped and
       canonical`` gate, which only ever guarded this first lookup.)
    2. Otherwise (or on miss), look the ``original`` text up against
       ``alias_table`` by ``alias = ? COLLATE NOCASE`` and return that id.
    3. If ``canonical`` is set and still unmatched, create the canonical row
       (carrying any ``extra_cols``), insert the original as an
       ``auto_mapped=1`` alias, and return the new id. On an
       ``INSERT OR IGNORE`` that hit an existing row (no lastrowid), re-select
       by ``canonical_code``.

    Callers extract the canonical/original fields themselves because the
    source dict keys differ per entity.
    """
    if canonical and lookup_by_canonical:
        cursor = await db.execute(
            f"SELECT id FROM {main_table} WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    cursor = await db.execute(
        f"SELECT {fk_col} FROM {alias_table} WHERE alias = ? COLLATE NOCASE",
        (original,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    if canonical:
        display = canonical.replace("-", " ").replace("_", " ").title()
        extra_cols = extra_cols or {}
        col_names = ["canonical_code", "canonical_display", *extra_cols.keys()]
        placeholders = ", ".join(["?"] * len(col_names))
        params = [canonical, display, *extra_cols.values()]
        cursor = await db.execute(
            f"INSERT OR IGNORE INTO {main_table} "
            f"({', '.join(col_names)}) VALUES ({placeholders})",
            params,
        )
        if cursor.lastrowid:
            new_id = cursor.lastrowid
            await db.execute(
                f"INSERT OR IGNORE INTO {alias_table} "
                f"({fk_col}, alias, auto_mapped) VALUES (?, ?, 1)",
                (new_id, original),
            )
            return new_id
        # The INSERT was ignored (canonical_code already exists). Lab tests
        # re-select to recover the id; diagnosis/medication historically fell
        # through to ``None`` here, so they leave ``reselect_on_conflict``
        # False to preserve that.
        if reselect_on_conflict:
            cursor = await db.execute(
                f"SELECT id FROM {main_table} WHERE canonical_code = ?", (canonical,)
            )
            row = await cursor.fetchone()
            return row[0] if row else None

    return None


async def _resolve_specialty_from_data(
    db: aiosqlite.Connection, specialty_data: dict
) -> int | None:
    """Resolve specialty to norm_specialties ID from specialty extraction data."""
    canonical = canonicalize_code(specialty_data.get("canonical", "")) or ""

    if canonical:
        cursor = await db.execute(
            "SELECT id FROM norm_specialties WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    return None


async def _resolve_lab_test(db: aiosqlite.Connection, lab: dict) -> int | None:
    """Resolve lab test to norm_lab_tests ID, creating if needed."""
    canonical = canonicalize_code(lab.get("test_name_canonical", "")) or ""
    original = lab.get("test_name_original", "")
    mapped = lab.get("test_mapped", False)

    # Lab tests only trust the canonical *lookup* when the LLM flagged the row
    # as mapped; the auto-create path still uses ``canonical`` if present,
    # matching the original ``mapped and canonical`` / ``if canonical`` split.
    return await _resolve_norm(
        db,
        main_table="norm_lab_tests",
        alias_table="norm_lab_test_aliases",
        fk_col="norm_lab_test_id",
        canonical=canonical,
        original=original,
        lookup_by_canonical=mapped,
        reselect_on_conflict=True,
    )


async def _resolve_diagnosis(db: aiosqlite.Connection, diag: dict) -> int | None:
    """Resolve diagnosis to norm_diagnoses ID."""
    canonical = canonicalize_code(diag.get("diagnosis_canonical", "")) or ""
    original = diag.get("diagnosis_original", "")

    return await _resolve_norm(
        db,
        main_table="norm_diagnoses",
        alias_table="norm_diagnosis_aliases",
        fk_col="norm_diagnosis_id",
        canonical=canonical,
        original=original,
        extra_cols={"icd10_code": diag.get("icd10_code")},
    )


async def _resolve_medication(db: aiosqlite.Connection, med: dict) -> int | None:
    """Resolve medication to norm_medications ID."""
    canonical = canonicalize_code(med.get("active_ingredient_canonical", "")) or ""
    original = med.get("active_ingredient_original", "")

    return await _resolve_norm(
        db,
        main_table="norm_medications",
        alias_table="norm_medication_aliases",
        fk_col="norm_medication_id",
        canonical=canonical,
        original=original,
    )
