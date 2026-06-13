"""Canonical extraction-merge strategy.

Asclepius historically had THREE diverged merge paths that combined per-chunk
/ per-section / per-page extractions into one result, each with different
dedup semantics:

    1. chunked (``chunked_extraction.merge_extractions``)  — composite-key
       dedup, first-occurrence-wins per array, lazy ``setdefault``; only the
       array fields were merged, every scalar/metadata field stayed exactly
       as the base had it.
    2. section (``section_processor._merge_section_extractions``) — NO dedup
       (extended everything), first-encounter-with-a-date wins, fixed
       array/encounter/cost skeleton.
    3. vision  (inline loop in ``vision_extractor.extract_with_vision``) —
       first-non-empty value per top-level key wins, lists taken whole (no
       concat, no dedup).

This module is now the single source of truth for all three. The canonical
semantics are:

    * ARRAY fields (``lab_results``, ``diagnoses``, ``medications``,
      ``vaccinations``, ``encounters``, ``invoice_items``, and the nested
      ``cost.line_items``) → CONCATENATE across all inputs, then DEDUP by an
      explicit per-array composite key (see ``ARRAY_DEDUP_KEYS``). First row
      seen for a given key wins; later duplicates are dropped.

    * The singular ``encounter`` dict and the scalar ``cost`` fields
      (``total_amount``, ``currency``, …) → first non-empty value wins, never
      overwritten once set.

    * Other SCALAR / metadata fields → first non-empty value wins *when
      scalar-fill is enabled* (the vision path). The chunked and section
      paths historically did NOT pull scalar/metadata fields out of the
      array-bearing dicts at all — their document-level fields come from a
      separate classification dict — so those two call sites disable
      scalar-fill to stay behaviour-equivalent.

The per-array composite keys are DERIVED from the chunked
``merge_extractions`` implementation (the one path that already did correct
composite-key dedup) and applied uniformly to every path. They are declared
centrally in ``ARRAY_DEDUP_KEYS`` so the dedup contract is auditable in one
place.

Pure functions — no DB, no network.
"""

from __future__ import annotations

from typing import Any, Iterable

# --------------------------------------------------------------------------
# Explicit, auditable per-array dedup contract.
#
# Maps an array field name → the tuple of row sub-keys that form its
# composite dedup key. Two rows in the same array are duplicates iff every
# listed sub-key compares equal (a missing sub-key reads as ``None``, matching
# the chunked merge's ``.get(...)`` behaviour). The FIRST row seen for a given
# composite key is kept; later ones are dropped.
#
# These come straight from chunked_extraction.merge_extractions:
#   lab_results   -> test_name_original
#   medications   -> brand_name + active_ingredient_original
#   diagnoses     -> diagnosis_original
#   vaccinations  -> vaccine_name + date_administered
#   invoice items -> description + amount   (cost.line_items, see below)
#
# ``encounters`` (the plural array) was never deduped by any prior path — the
# chunked merge has no encounter-array handling and the section merge folds
# the singular ``encounter`` dict instead. It is included here for
# completeness because it is one of the canonical child arrays; its composite
# key is the natural (date, diagnosis) identity so concatenated duplicates
# collapse the same way the other arrays do.
# --------------------------------------------------------------------------
ARRAY_DEDUP_KEYS: dict[str, tuple[str, ...]] = {
    "lab_results": ("test_name_original",),
    "diagnoses": ("diagnosis_original",),
    "medications": ("brand_name", "active_ingredient_original"),
    "vaccinations": ("vaccine_name", "date_administered"),
    "encounters": ("encounter_date", "diagnosis_original"),
    "invoice_items": ("description", "amount"),
}

# The nested cost line-item array lives under ``cost.line_items`` rather than
# at the top level. It shares the ``invoice_items`` dedup contract.
COST_LINE_ITEM_KEYS: tuple[str, ...] = ARRAY_DEDUP_KEYS["invoice_items"]

# Top-level array fields the canonical merge concatenates+dedups. Excludes
# ``invoice_items`` because in the extraction dict that data is carried as
# ``cost.line_items`` (handled separately); a literal top-level
# ``invoice_items`` array, if ever present, is still deduped via the generic
# path below.
_TOP_LEVEL_ARRAYS: tuple[str, ...] = (
    "lab_results",
    "diagnoses",
    "medications",
    "vaccinations",
    "encounters",
)


def _row_key(row: Any, key_fields: tuple[str, ...]) -> tuple:
    """Composite dedup key for a single array row.

    Mirrors the chunked merge: each sub-key is read via ``.get`` so a missing
    field dedups under ``None`` (a single-field key stays a 1-tuple, never a
    bare scalar, so distinct arrays never alias)."""
    if not isinstance(row, dict):
        # Non-dict rows can't collide on field values; key off repr so two
        # equal non-dict rows still dedup.
        return ("__nondict__", repr(row))
    return tuple(row.get(field) for field in key_fields)


def _dedup_concat(rows: Iterable[Any], key_fields: tuple[str, ...]) -> list:
    """Concatenate ``rows`` preserving order, dropping later composite-key dups."""
    seen: set[tuple] = set()
    out: list = []
    for row in rows:
        k = _row_key(row, key_fields)
        if k in seen:
            continue
        seen.add(k)
        out.append(row)
    return out


def _is_empty(value: Any) -> bool:
    """First-non-empty-wins emptiness test, matching the prior sites' ``if val``
    / ``if not merged.get(key)`` falsiness check."""
    return not value


def merge_extraction_dicts(
    extractions: Iterable[dict],
    *,
    fill_scalars: bool = True,
    encounter_requires_date: bool = False,
) -> dict:
    """Fold a sequence of extraction dicts into one canonical merged dict.

    * Array fields are concatenated across all inputs and deduped by their
      composite key (see ``ARRAY_DEDUP_KEYS``); first row per key wins.
    * The nested ``cost.line_items`` array is concatenated+deduped; scalar
      cost fields (``total_amount``, ``currency``, …) take the first non-empty
      value.
    * The singular ``encounter`` dict takes the first non-empty value (i.e.
      the first encounter with any content — for the canonical inputs this is
      the first one with an ``encounter_date``).
    * Other scalar/metadata fields take the first non-empty value **iff**
      ``fill_scalars`` is True (the vision path). When False (chunked /
      section paths) non-array scalar keys are left out of the result — those
      sites carry document-level metadata via a separate classification dict.

    Inputs that aren't dicts are skipped. Returns a fresh dict; the inputs are
    not mutated (rows are referenced, not deep-copied — same as the legacy
    paths).
    """
    result: dict = {}
    array_buckets: dict[str, list] = {name: [] for name in _TOP_LEVEL_ARRAYS}
    saw_array: dict[str, bool] = {name: False for name in _TOP_LEVEL_ARRAYS}
    extra_array_buckets: dict[str, list] = {}
    cost_line_items: list = []
    cost_scalars: dict = {}
    saw_cost = False

    for ext in extractions:
        if not isinstance(ext, dict):
            continue

        for key, val in ext.items():
            if key in _TOP_LEVEL_ARRAYS:
                if isinstance(val, list):
                    array_buckets[key].extend(val)
                    saw_array[key] = True
                continue
            if key == "cost":
                if isinstance(val, dict):
                    saw_cost = True
                    items = val.get("line_items")
                    if isinstance(items, list):
                        cost_line_items.extend(items)
                    for ck, cv in val.items():
                        if ck == "line_items" or _is_empty(cv):
                            continue
                        if _is_empty(cost_scalars.get(ck)):
                            cost_scalars[ck] = cv
                continue
            if key in ARRAY_DEDUP_KEYS and isinstance(val, list):
                # A literal top-level array field (e.g. ``invoice_items``) that
                # has an explicit dedup contract but isn't in the fixed set.
                extra_array_buckets.setdefault(key, []).extend(val)
                continue
            # ``encounter`` (singular dict) is a scalar/metadata field handled
            # specially so it survives even when ``fill_scalars`` is False (the
            # section path carries no other scalar metadata but DOES return an
            # encounter). When ``encounter_requires_date`` is set we reproduce
            # the section quirk exactly: a dateless encounter is skipped and the
            # first one bearing an ``encounter_date`` wins. Otherwise (vision)
            # it's plain first-non-empty-wins, matching the old inline loop.
            if key == "encounter":
                if encounter_requires_date:
                    if (
                        isinstance(val, dict)
                        and val.get("encounter_date")
                        and not result.get("encounter", {}).get("encounter_date")
                    ):
                        result[key] = val
                elif not _is_empty(val) and _is_empty(result.get(key)):
                    result[key] = val
                continue
            # Any other scalar / metadata field.
            if not fill_scalars:
                continue
            if not _is_empty(val) and _is_empty(result.get(key)):
                result[key] = val

    # Materialise deduped arrays only for keys some input actually supplied as
    # a list (preserves "don't invent array keys nobody provided").
    for name in _TOP_LEVEL_ARRAYS:
        if saw_array[name]:
            result[name] = _dedup_concat(array_buckets[name], ARRAY_DEDUP_KEYS[name])

    for name, rows in extra_array_buckets.items():
        result[name] = _dedup_concat(rows, ARRAY_DEDUP_KEYS[name])

    if saw_cost:
        cost_out: dict = {"line_items": _dedup_concat(cost_line_items, COST_LINE_ITEM_KEYS)}
        cost_out.update(cost_scalars)
        result["cost"] = cost_out

    return result


# Fixed key skeleton the section merge has always returned (even for empty
# input). Kept so the section path stays a drop-in for the old function.
def empty_section_skeleton() -> dict:
    return {
        "lab_results": [],
        "diagnoses": [],
        "medications": [],
        "vaccinations": [],
        "encounter": {},
        "cost": {"line_items": []},
    }


def merge_section_extractions(extractions: list[dict]) -> dict:
    """Canonical replacement for ``_merge_section_extractions``.

    Concatenate+dedup the array fields (now deduped, where the old section
    merge extended verbatim), keep the first encounter-with-a-date, and always
    return the full fixed key skeleton — even for empty input — so downstream
    code that reads ``merged["lab_results"]`` etc. unconditionally keeps
    working.
    """
    merged = merge_extraction_dicts(
        extractions, fill_scalars=False, encounter_requires_date=True
    )
    skeleton = empty_section_skeleton()
    for key in ("lab_results", "diagnoses", "medications", "vaccinations"):
        if key in merged:
            skeleton[key] = merged[key]
    if "encounter" in merged:
        skeleton["encounter"] = merged["encounter"]
    if "cost" in merged:
        cost = merged["cost"]
        cost.setdefault("line_items", [])
        skeleton["cost"] = cost
    return skeleton


def merge_pair(base: dict, additional: dict) -> dict:
    """Pairwise, in-place merge of ``additional`` into ``base`` — the canonical
    drop-in replacement for ``chunked_extraction.merge_extractions``.

    Only the array fields (and the nested cost line items) are merged:
    concatenate ``base``'s rows then ``additional``'s, deduped by composite
    key (first-occurrence-wins, base rows first). Every scalar/metadata field
    — including the singular ``encounter`` and the scalar cost fields — is left
    exactly as ``base`` had it, matching the old chunked merge which never read
    ``additional``'s non-array data. Mutates and returns ``base``.
    """
    merged = merge_extraction_dicts([base, additional], fill_scalars=False)
    for name in _TOP_LEVEL_ARRAYS:
        if name in merged:
            base[name] = merged[name]
    # Cost: dedup line items in place, but never let ``additional`` overwrite
    # ``base``'s scalar cost fields (old merge only appended line items).
    if "cost" in merged:
        merged_cost = merged["cost"]
        if isinstance(base.get("cost"), dict):
            base["cost"]["line_items"] = merged_cost.get("line_items", [])
        elif "cost" in base:
            # base.cost present but not a dict — leave as the old code did
            # (it would have raised; keep behaviour by only acting on dicts).
            pass
        else:
            # base had no cost at all: old merge read base.get("cost", {}),
            # mutated that throwaway, and never wrote it back — so base.cost
            # was NOT created. Preserve that: only line items from additional
            # but with nowhere to live means we drop them, exactly as before.
            pass
    return base
