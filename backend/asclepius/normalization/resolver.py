"""Deterministic normalization — match or create canonical entries in
Python, not in the LLM prompt.

Phase 2 extraction used to stuff every ``(canonical_code, alias)`` row
from ``norm_lab_test_aliases`` / ``norm_medication_aliases`` /
``norm_diagnosis_aliases`` / ``norm_specialty_aliases`` into the
extraction prompt so the LLM could "pick the canonical code". For a
moderately-used install the payload reached hundreds of kilobytes, which
blew past small-model context windows and made them ignore the schema
entirely (see the 437k-char prompt hang).

This module does the mapping where it belongs: in Python, using the DB.
The LLM emits ``_original`` text (the document's phrasing) and we:

1. Look it up by exact alias match (case-insensitive).
2. Fall back to fuzzy match via rapidfuzz on the alias list (score ≥
   ``FUZZY_THRESHOLD``).
3. If still no match, auto-create a new canonical row with
   ``canonical_display = original text`` and the original as an
   ``auto_mapped=1`` alias. The Normalization UI already surfaces
   auto-mapped entries for human review / merge.

Aliases are cached per ``(AliasCache, entity_type)`` to avoid re-reading
the whole alias table for every resolved row inside one extraction.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

import aiosqlite

from .alias_lookup import load_aliases_flat

logger = logging.getLogger(__name__)


# rapidfuzz score threshold for accepting a fuzzy match. The library's
# ``WRatio`` returns 0-100; 85 is strict enough to avoid "Glucose" ↔
# "Glucagon" collisions while catching real typos/language drift.
FUZZY_THRESHOLD = 85

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    """Produce a stable lowercase kebab-case slug usable as canonical_code fallback."""
    if not text:
        return ""
    return _SLUG_RE.sub("-", text.lower()).strip("-")


# ---------------------------------------------------------------------------
# Per-entity table metadata — kept in one place so the four resolvers
# share code instead of copy-pasting four near-identical SQL blocks.
# ---------------------------------------------------------------------------


@dataclass
class _EntityTables:
    canonical: str  # e.g. norm_lab_tests
    aliases: str  # e.g. norm_lab_test_aliases
    alias_fk: str  # e.g. norm_lab_test_id
    # Extra columns to preserve when inserting a new canonical row.
    extra_cols: list[str] = field(default_factory=list)


_ENTITIES = {
    "lab_test": _EntityTables(
        canonical="norm_lab_tests",
        aliases="norm_lab_test_aliases",
        alias_fk="norm_lab_test_id",
    ),
    "medication": _EntityTables(
        canonical="norm_medications",
        aliases="norm_medication_aliases",
        alias_fk="norm_medication_id",
    ),
    "diagnosis": _EntityTables(
        canonical="norm_diagnoses",
        aliases="norm_diagnosis_aliases",
        alias_fk="norm_diagnosis_id",
        extra_cols=["icd10_code"],
    ),
    "specialty": _EntityTables(
        canonical="norm_specialties",
        aliases="norm_specialty_aliases",
        alias_fk="norm_specialty_id",
    ),
}


# ---------------------------------------------------------------------------
# Per-extraction alias cache — rebuilt at the start of each
# ``resolve_extraction`` call so changes from the normalization UI are
# always picked up on the next run. Within one extraction we read the
# alias table at most once per entity type.
# ---------------------------------------------------------------------------


@dataclass
class AliasCache:
    """Cache of ``(alias_lower, norm_id)`` tuples for each entity type."""

    _by_entity: dict[str, list[tuple[str, int]]] = field(default_factory=dict)
    _exact_by_entity: dict[str, dict[str, int]] = field(default_factory=dict)

    async def ensure_loaded(
        self,
        db: aiosqlite.Connection,
        entity: str,
    ) -> None:
        if entity in self._by_entity:
            return
        tables = _ENTITIES[entity]
        lowered = await load_aliases_flat(db, tables.aliases, tables.alias_fk)
        self._by_entity[entity] = lowered
        self._exact_by_entity[entity] = dict(lowered)  # last wins on dup; fine

    def exact(self, entity: str, text: str) -> int | None:
        return self._exact_by_entity.get(entity, {}).get(
            (text or "").strip().lower(),
        )

    def all_aliases(self, entity: str) -> list[tuple[str, int]]:
        return self._by_entity.get(entity, [])

    def remember(self, entity: str, alias: str, norm_id: int) -> None:
        key = (alias or "").strip().lower()
        if not key:
            return
        self._exact_by_entity.setdefault(entity, {})[key] = norm_id
        self._by_entity.setdefault(entity, []).append((key, norm_id))


# ---------------------------------------------------------------------------
# Core resolver — one function per entity but they all share the same shape.
# ---------------------------------------------------------------------------


async def _resolve_one(
    db: aiosqlite.Connection,
    cache: AliasCache,
    entity: str,
    original: str,
    *,
    extra: dict[str, Any] | None = None,
    auto_create: bool = True,
) -> int | None:
    """Resolve ``original`` to a ``norm_*.id``.

    1. Cached exact-lower alias match.
    2. Fuzzy match (rapidfuzz WRatio ≥ FUZZY_THRESHOLD).
    3. Auto-create with ``canonical_display = original`` and the original
       text as an ``auto_mapped=1`` alias. Returns the new id.

    When ``auto_create`` is False, steps 1 and 2 still run but an unmatched
    term returns ``None`` instead of creating a new canonical row. Use that
    when you don't own the write (e.g. read-only diagnostic).
    """
    if not original or not original.strip():
        return None
    cleaned = original.strip()
    await cache.ensure_loaded(db, entity)

    # 1. Exact alias lookup (cache).
    hit = cache.exact(entity, cleaned)
    if hit is not None:
        return hit

    # 2. Fuzzy match via rapidfuzz.
    aliases = cache.all_aliases(entity)
    if aliases:
        try:
            from rapidfuzz import process, fuzz

            best = process.extractOne(
                cleaned.lower(),
                [a for a, _ in aliases],
                scorer=fuzz.WRatio,
                score_cutoff=FUZZY_THRESHOLD,
            )
            if best is not None:
                _matched, score, idx = best
                norm_id = aliases[idx][1]
                # Record the original phrasing as a new alias so future
                # extractions hit step 1 instead of rerunning fuzzy.
                await _add_alias(db, entity, norm_id, cleaned, auto_mapped=True)
                cache.remember(entity, cleaned, norm_id)
                logger.debug(
                    "Resolver: fuzzy match %s → alias %r score=%.1f",
                    entity,
                    cleaned,
                    score,
                )
                return norm_id
        except Exception:
            logger.debug("rapidfuzz lookup failed for %s=%r", entity, cleaned, exc_info=True)

    if not auto_create:
        return None

    # 3. Auto-create. canonical_display keeps the source wording so the user
    # can recognise it in the normalization UI; canonical_code is a slug of
    # the original — stable enough to be unique, short enough to be useful.
    canonical_code = _slugify(cleaned) or f"auto-{abs(hash(cleaned)) & 0xFFFFFF:06x}"
    tables = _ENTITIES[entity]

    # Guard against collisions with an existing canonical_code (UNIQUE).
    cursor = await db.execute(
        f"SELECT id FROM {tables.canonical} WHERE canonical_code = ?",
        (canonical_code,),
    )
    row = await cursor.fetchone()
    if row:
        norm_id = int(row[0])
        await _add_alias(db, entity, norm_id, cleaned, auto_mapped=True)
        cache.remember(entity, cleaned, norm_id)
        return norm_id

    extra = extra or {}
    if tables.extra_cols:
        cols = ", ".join(["canonical_code", "canonical_display", *tables.extra_cols])
        placeholders = ", ".join(["?"] * (2 + len(tables.extra_cols)))
        params = [canonical_code, cleaned, *(extra.get(col) for col in tables.extra_cols)]
    else:
        cols = "canonical_code, canonical_display"
        placeholders = "?, ?"
        params = [canonical_code, cleaned]

    cursor = await db.execute(
        f"INSERT OR IGNORE INTO {tables.canonical} ({cols}) VALUES ({placeholders})",
        params,
    )
    norm_id = cursor.lastrowid
    if not norm_id:
        cursor = await db.execute(
            f"SELECT id FROM {tables.canonical} WHERE canonical_code = ?",
            (canonical_code,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        norm_id = int(row[0])

    await _add_alias(db, entity, norm_id, cleaned, auto_mapped=True)
    cache.remember(entity, cleaned, norm_id)
    logger.debug(
        "Resolver: auto-created %s id=%d canonical_code=%s display=%r",
        entity,
        norm_id,
        canonical_code,
        cleaned,
    )
    return norm_id


async def _add_alias(
    db: aiosqlite.Connection,
    entity: str,
    norm_id: int,
    alias: str,
    *,
    auto_mapped: bool,
) -> None:
    tables = _ENTITIES[entity]
    await db.execute(
        f"INSERT OR IGNORE INTO {tables.aliases} "
        f"({tables.alias_fk}, alias, auto_mapped) VALUES (?, ?, ?)",
        (norm_id, alias, 1 if auto_mapped else 0),
    )


# ---------------------------------------------------------------------------
# Public API — one helper per entity type, plus a batch helper that walks
# an extraction dict and resolves every referenced term in-place.
# ---------------------------------------------------------------------------


async def resolve_lab_test(
    db: aiosqlite.Connection,
    cache: AliasCache,
    original: str,
) -> int | None:
    return await _resolve_one(db, cache, "lab_test", original)


async def resolve_medication(
    db: aiosqlite.Connection,
    cache: AliasCache,
    original: str,
) -> int | None:
    return await _resolve_one(db, cache, "medication", original)


async def resolve_diagnosis(
    db: aiosqlite.Connection,
    cache: AliasCache,
    original: str,
    *,
    icd10_code: str | None = None,
) -> int | None:
    return await _resolve_one(
        db,
        cache,
        "diagnosis",
        original,
        extra={"icd10_code": icd10_code},
    )


async def resolve_specialty(
    db: aiosqlite.Connection,
    cache: AliasCache,
    original: str,
) -> int | None:
    return await _resolve_one(db, cache, "specialty", original)


async def resolve_extraction(
    db: aiosqlite.Connection,
    extraction: dict,
) -> dict:
    """Walk an extraction dict and fill in every ``norm_*_id`` field by
    resolving the corresponding ``*_original`` text. Returns the same
    dict, mutated in place.

    The LLM may omit ``norm_*_id`` fields entirely (we no longer send the
    mapping table as context); this helper populates them from Python.
    The LLM's hallucinated ``*_canonical`` / ``*_mapped`` fields are
    ignored.
    """
    cache = AliasCache()

    # Lab results.
    for lab in extraction.get("lab_results") or []:
        if not isinstance(lab, dict):
            continue
        original = lab.get("test_name_original") or lab.get("test_name") or ""
        if not original:
            continue
        norm_id = await resolve_lab_test(db, cache, original)
        if norm_id is not None:
            lab["norm_lab_test_id"] = norm_id

    # Medications.
    for med in extraction.get("medications") or []:
        if not isinstance(med, dict):
            continue
        original = med.get("active_ingredient_original") or med.get("brand_name") or ""
        if not original:
            continue
        norm_id = await resolve_medication(db, cache, original)
        if norm_id is not None:
            med["norm_medication_id"] = norm_id

    # Diagnoses.
    for diag in extraction.get("diagnoses") or []:
        if not isinstance(diag, dict):
            continue
        original = diag.get("diagnosis_original") or ""
        if not original:
            continue
        norm_id = await resolve_diagnosis(
            db,
            cache,
            original,
            icd10_code=diag.get("icd10_code"),
        )
        if norm_id is not None:
            diag["norm_diagnosis_id"] = norm_id

    # Specialty — on the top-level extraction ("specialty" dict) and on
    # per-encounter encounter.specialty_original when present.
    spec_block = extraction.get("specialty")
    if isinstance(spec_block, dict):
        original = spec_block.get("original") or spec_block.get("name") or ""
        if original:
            norm_id = await resolve_specialty(db, cache, original)
            if norm_id is not None:
                spec_block["norm_specialty_id"] = norm_id

    encounter = extraction.get("encounter")
    if isinstance(encounter, dict):
        original = encounter.get("specialty_original") or ""
        if original:
            norm_id = await resolve_specialty(db, cache, original)
            if norm_id is not None:
                encounter["norm_specialty_id"] = norm_id

    # Specialty on doctor extraction.
    doctor = extraction.get("doctor")
    if isinstance(doctor, dict):
        original = doctor.get("specialty_original") or ""
        if original:
            norm_id = await resolve_specialty(db, cache, original)
            if norm_id is not None:
                doctor["norm_specialty_id"] = norm_id

    await db.commit()
    return extraction
