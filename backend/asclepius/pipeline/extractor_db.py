"""Database resolvers for normalized reference tables.

These helpers translate raw LLM-emitted canonical codes / original strings
into ``norm_*`` table primary keys, creating rows on demand when a canonical
code is supplied and no match exists. Kept separate from entity_matching so
the patient/doctor/facility upserts can be reused without pulling in the
lab-results / diagnoses / medications machinery.
"""

import aiosqlite

from asclepius.pipeline.entity_matching import canonicalize_code


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

    if mapped and canonical:
        cursor = await db.execute(
            "SELECT id FROM norm_lab_tests WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    cursor = await db.execute(
        "SELECT norm_lab_test_id FROM norm_lab_test_aliases WHERE alias = ? COLLATE NOCASE",
        (original,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    if canonical:
        display = canonical.replace("-", " ").replace("_", " ").title()
        cursor = await db.execute(
            "INSERT OR IGNORE INTO norm_lab_tests (canonical_code, canonical_display) VALUES (?, ?)",
            (canonical, display),
        )
        if cursor.lastrowid:
            test_id = cursor.lastrowid
            await db.execute(
                "INSERT OR IGNORE INTO norm_lab_test_aliases (norm_lab_test_id, alias, auto_mapped) VALUES (?, ?, 1)",
                (test_id, original),
            )
            return test_id
        cursor = await db.execute(
            "SELECT id FROM norm_lab_tests WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        return row[0] if row else None

    return None


async def _resolve_diagnosis(db: aiosqlite.Connection, diag: dict) -> int | None:
    """Resolve diagnosis to norm_diagnoses ID."""
    canonical = canonicalize_code(diag.get("diagnosis_canonical", "")) or ""
    original = diag.get("diagnosis_original", "")

    if canonical:
        cursor = await db.execute(
            "SELECT id FROM norm_diagnoses WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    cursor = await db.execute(
        "SELECT norm_diagnosis_id FROM norm_diagnosis_aliases WHERE alias = ? COLLATE NOCASE",
        (original,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    if canonical:
        display = canonical.replace("-", " ").replace("_", " ").title()
        cursor = await db.execute(
            "INSERT OR IGNORE INTO norm_diagnoses (canonical_code, canonical_display, icd10_code) VALUES (?, ?, ?)",
            (canonical, display, diag.get("icd10_code")),
        )
        if cursor.lastrowid:
            diag_id = cursor.lastrowid
            await db.execute(
                "INSERT OR IGNORE INTO norm_diagnosis_aliases (norm_diagnosis_id, alias, auto_mapped) VALUES (?, ?, 1)",
                (diag_id, original),
            )
            return diag_id

    return None


async def _resolve_medication(db: aiosqlite.Connection, med: dict) -> int | None:
    """Resolve medication to norm_medications ID."""
    canonical = canonicalize_code(med.get("active_ingredient_canonical", "")) or ""
    original = med.get("active_ingredient_original", "")

    if canonical:
        cursor = await db.execute(
            "SELECT id FROM norm_medications WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    cursor = await db.execute(
        "SELECT norm_medication_id FROM norm_medication_aliases WHERE alias = ? COLLATE NOCASE",
        (original,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    if canonical:
        display = canonical.replace("-", " ").replace("_", " ").title()
        cursor = await db.execute(
            "INSERT OR IGNORE INTO norm_medications (canonical_code, canonical_display) VALUES (?, ?)",
            (canonical, display),
        )
        if cursor.lastrowid:
            med_id = cursor.lastrowid
            await db.execute(
                "INSERT OR IGNORE INTO norm_medication_aliases (norm_medication_id, alias, auto_mapped) VALUES (?, ?, 1)",
                (med_id, original),
            )
            return med_id

    return None
