"""Patient / doctor / facility matching and upsert helpers.

Shared by extractor.py, chunked_extraction.py, processor.py,
section_processor.py, dicom_ingest.py, and the AI-assist routes. Keep the
helpers here small and side-effect-free beyond the single DB write they
advertise: callers rely on them being idempotent.
"""

import re

import aiosqlite


def canonicalize_code(code: str | None) -> str | None:
    """Normalize a canonical_code to kebab-case.

    Rule: lowercase; every run of whitespace or underscores becomes a
    single hyphen; anything outside [a-z0-9-] is dropped. Used both at
    insert time (entity_matching helpers, normalization routes) and by
    the one-shot migration that rewrites legacy snake_case codes in
    existing databases.
    """
    if code is None:
        return None
    s = code.strip().lower()
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"[^a-z0-9-]", "", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


# Honorific / title tokens to strip from doctor names before storing them.
# We want the raw person-name in the database — the display layer can add
# "Dr." back if it wants. Covers the English + Italian + German titles we
# see most often in the documents we parse.
_DOCTOR_TITLE_TOKENS = {
    "dr",
    "dr.",
    "dr.ssa",
    "drssa",
    "doctor",
    "doctors",
    "dott",
    "dott.",
    "dott.ssa",
    "dottssa",
    "dott.essa",
    "dottessa",
    "dottore",
    "dottoressa",
    "prof",
    "prof.",
    "professor",
    "professore",
    "professoressa",
    "med",
    "med.",
    "mr",
    "mr.",
    "mrs",
    "mrs.",
    "ms",
    "ms.",
    "mme",
    "mme.",
    "md",
    "md.",
    "m.d.",
    "m.d",
    "phd",
    "ph.d",
    "ph.d.",
    "dds",
    "dds.",
    "pharm",
    "pharm.",
    "pharma",
    "ing",
    "ing.",
    "sig",
    "sig.",
    "sig.ra",
    "sig.ra.",
    "sig.na",
    "sig.na.",
}


def strip_doctor_title(name: str) -> str:
    """Remove leading / trailing honorific titles from a doctor's name.

    Handles stacked prefixes ("Prof. Dr. med. Hans Müller") and trailing
    post-nominals ("Anna Rossi MD"). Idempotent — safe to call twice.
    """
    if not name or not name.strip():
        return name
    tokens = name.split()
    while tokens and tokens[0].lower().rstrip(",") in _DOCTOR_TITLE_TOKENS:
        tokens.pop(0)
    while tokens and tokens[-1].lower().rstrip(",") in _DOCTOR_TITLE_TOKENS:
        tokens.pop()
    if tokens:
        tokens[-1] = tokens[-1].rstrip(",.;")
    return " ".join(tokens)


def normalize_facility_name(name: str) -> str:
    """Normalize a facility name without crushing acronyms.

    Title-cases lowercase tokens but preserves any token that already contains
    two or more consecutive uppercase letters — that's how Italian hospital
    networks (ASST, AOU, IRCCS, ATS, …) and most English acronyms are written.
    Particles ("de", "della", "von", …) are still lowered when they aren't the
    first word so "Ospedale Di Milano" → "Ospedale di Milano".

    Doctor names use ``normalize_name`` because they need title-case + the
    "Dr."/"Prof." prefix mapping; facilities don't.
    """
    if not name:
        return name

    particles = {"von", "della", "del", "de", "di", "van", "den", "der", "la", "le", "da"}
    words = name.split()
    result = []
    for i, word in enumerate(words):
        if any(c.isupper() for c in word[1:]) and sum(1 for c in word if c.isupper()) >= 2:
            # Token already carries an acronym shape (>=2 uppercase letters,
            # at least one of them past position 0). Trust it as-is.
            result.append(word)
            continue
        lower = word.lower().rstrip(".")
        if i > 0 and lower in particles:
            result.append(lower)
        else:
            result.append(word.capitalize())
    return " ".join(result)


def normalize_name(name: str) -> str:
    """Normalize doctor/facility name capitalization.

    Title-cases most tokens, keeps known particles lowercase ("von", "della",
    "de", …), preserves the dot-form of common honorific prefixes.
    """
    if not name:
        return name

    particles = {"von", "della", "del", "de", "di", "van", "den", "der", "la", "le", "da"}
    prefix_map = {
        "dr.": "Dr.",
        "dr": "Dr.",
        "prof.": "Prof.",
        "prof": "Prof.",
        "med.": "med.",
        "med": "med.",
        "ing.": "Ing.",
        "ing": "Ing.",
    }

    words = name.split()
    result = []
    for i, word in enumerate(words):
        lower = word.lower().rstrip(".")
        lower_with_dot = word.lower()

        if lower_with_dot in prefix_map:
            result.append(prefix_map[lower_with_dot])
        elif i > 0 and lower in particles:
            result.append(lower)
        else:
            result.append(word.capitalize())

    return " ".join(result)


async def _match_patient(db: aiosqlite.Connection, name: str | None) -> int | None:
    """Try to match a patient name from the extraction to a known patient."""
    if not name:
        return None

    cursor = await db.execute(
        "SELECT id FROM patients WHERE display_name = ? COLLATE NOCASE",
        (name,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    cursor = await db.execute(
        "SELECT id FROM patients WHERE display_name LIKE ? COLLATE NOCASE",
        (f"%{name}%",),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    parts = name.split()
    for part in parts:
        if len(part) < 3:
            continue
        cursor = await db.execute(
            "SELECT id FROM patients WHERE display_name LIKE ? COLLATE NOCASE",
            (f"%{part}%",),
        )
        rows = await cursor.fetchall()
        if len(rows) == 1:
            return rows[0][0]

    return None


async def _resolve_specialty_from_doctor(db: aiosqlite.Connection, doctor_data: dict) -> int | None:
    """Resolve specialty to norm_specialties ID from doctor extraction data."""
    canonical = doctor_data.get("specialty_canonical", "")

    if canonical:
        cursor = await db.execute(
            "SELECT id FROM norm_specialties WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    return None


async def _upsert_facility(db: aiosqlite.Connection, facility_data: dict) -> int:
    """Insert or get existing facility.

    Looks up by slug, canonical_code, case-insensitive name, and alias in
    that order. canonical_code has a UNIQUE index, so an INSERT that didn't
    find a matching slug but collides on canonical_code (possible after a
    merge or a manual rename) would 500 instead of reusing the existing
    row. Covering all four lookup paths avoids that.
    """
    from asclepius.patients.service import slugify

    name = normalize_facility_name(facility_data["name"])
    slug = slugify(name)

    cursor = await db.execute(
        "SELECT id FROM facilities WHERE slug = ? OR canonical_code = ?",
        (slug, slug),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    cursor = await db.execute(
        "SELECT id FROM facilities WHERE name = ? COLLATE NOCASE LIMIT 1",
        (name,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    cursor = await db.execute(
        "SELECT facility_id FROM facility_aliases WHERE alias = ? COLLATE NOCASE LIMIT 1",
        (name,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    try:
        cursor = await db.execute(
            """INSERT INTO facilities (name, slug, canonical_code, canonical_display, type, address, city, country, phone)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                name,
                slug,
                slug,
                name,
                facility_data.get("type"),
                facility_data.get("address"),
                facility_data.get("city"),
                facility_data.get("country"),
                facility_data.get("phone"),
            ),
        )
    except aiosqlite.IntegrityError:
        cursor = await db.execute(
            "SELECT id FROM facilities WHERE slug = ? OR canonical_code = ? LIMIT 1",
            (slug, slug),
        )
        row = await cursor.fetchone()
        if row:
            return row[0]
        raise
    facility_id = cursor.lastrowid
    # Seed the initial alias with the extracted name, already reviewed — it
    # is the canonical form, not a normalization guess.
    await db.execute(
        "INSERT INTO facility_aliases (facility_id, alias, auto_mapped) VALUES (?, ?, 0)",
        (facility_id, name),
    )
    return facility_id


async def _upsert_doctor(
    db: aiosqlite.Connection, doctor_data: dict, facility_id: int | None = None
) -> int:
    """Insert or get existing doctor.

    Same structure as ``_upsert_facility``: slug / canonical_code / name /
    alias lookups before insert, with UNIQUE-collision recovery.
    """
    from asclepius.patients.service import slugify

    name = normalize_name(strip_doctor_title(doctor_data["name"]))
    slug = slugify(name)

    cursor = await db.execute(
        "SELECT id FROM doctors WHERE slug = ? OR canonical_code = ?",
        (slug, slug),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    cursor = await db.execute(
        "SELECT id FROM doctors WHERE name = ? COLLATE NOCASE LIMIT 1",
        (name,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    cursor = await db.execute(
        "SELECT doctor_id FROM doctor_aliases WHERE alias = ? COLLATE NOCASE LIMIT 1",
        (name,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    # resolve_extraction() populates doctor["norm_specialty_id"] from the
    # doctor's specialty_original text; fall back to the legacy
    # canonical-based resolver when that wasn't run.
    norm_spec_id = doctor_data.get("norm_specialty_id")
    if norm_spec_id is None and doctor_data.get("specialty_canonical"):
        norm_spec_id = await _resolve_specialty_from_doctor(db, doctor_data)

    try:
        cursor = await db.execute(
            """INSERT INTO doctors (name, slug, canonical_code, canonical_display, title, norm_specialty_id, specialty_original, facility_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                name,
                slug,
                slug,
                name,
                doctor_data.get("title"),
                norm_spec_id,
                doctor_data.get("specialty_original"),
                facility_id,
            ),
        )
    except aiosqlite.IntegrityError:
        cursor = await db.execute(
            "SELECT id FROM doctors WHERE slug = ? OR canonical_code = ? LIMIT 1",
            (slug, slug),
        )
        row = await cursor.fetchone()
        if row:
            return row[0]
        raise
    doctor_id = cursor.lastrowid
    await db.execute(
        "INSERT INTO doctor_aliases (doctor_id, alias, auto_mapped) VALUES (?, ?, 0)",
        (doctor_id, name),
    )
    return doctor_id
