"""Characterization tests for the extraction-merge strategies.

Asclepius has THREE different merge paths that combine per-chunk / per-section
/ per-page extractions into one result, and they currently use DIFFERENT dedup
semantics:

    1. ``chunked_extraction.merge_extractions(base, additional)``
       — pairwise, in-place merge of two dicts. Deduplicates by composite keys
         (lab: test_name_original; medication: brand_name+active_ingredient;
         diagnosis: diagnosis_original; vaccination: name+date; cost line item:
         description+amount). Uses ``encounter`` via the classification blob
         (it does NOT merge an ``encounter`` key itself).

    2. ``section_processor._merge_section_extractions(list_of_dicts)``
       — folds a LIST of section dicts. Does NO dedup: every lab/diagnosis/
         medication/vaccination is ``extend``-ed verbatim. Keeps the FIRST
         ``encounter`` that has an ``encounter_date``. Always returns the full
         fixed key set (lab_results/diagnoses/medications/vaccinations/
         encounter/cost) even for empty input.

    3. Vision merge (inline in ``vision_extractor.extract_with_vision``)
       — first-non-empty value per top-level key wins; no list concatenation
         and no row-level dedup. It is not a standalone function, so it is
         characterized indirectly via a tiny re-implementation note below
         rather than a direct call (see ``test_vision_merge_semantics_note``).

The planned unification will collapse these into one strategy. Pinning each
one's CURRENT output makes that collapse a visible, intentional diff.

These are pure-function tests — no DB, no network.
"""

from __future__ import annotations

import copy

from asclepius.pipeline.chunked_extraction import merge_extractions
from asclepius.pipeline.section_processor import _merge_section_extractions


# --------------------------------------------------------------------------
# Synthetic multi-part extraction shared across the strategies.
# Chunk A and chunk B overlap (page-boundary overlap): WBC and "Lisinopril"
# and the "I10" diagnosis appear in BOTH. Each strategy treats the overlap
# differently.
# --------------------------------------------------------------------------

CHUNK_A = {
    "doc_type": "lab_report",
    "lab_results": [
        {"test_name_original": "WBC", "value": "5.0", "unit": "10^9/L"},
        {"test_name_original": "RBC", "value": "4.7", "unit": "10^12/L"},
    ],
    "medications": [
        {"brand_name": "Zestril", "active_ingredient_original": "Lisinopril"},
    ],
    "diagnoses": [
        {"diagnosis_original": "Hypertension", "code": "I10"},
    ],
    "vaccinations": [
        {"vaccine_name": "Influenza", "date_administered": "2024-01-02"},
    ],
    "cost": {
        "line_items": [
            {"description": "Blood panel", "amount": "50.00"},
        ]
    },
    "encounter": {"encounter_date": "2024-01-02", "provider": "Dr A"},
}

CHUNK_B = {
    "lab_results": [
        # WBC duplicates chunk A (same test_name_original); Glucose is new.
        {"test_name_original": "WBC", "value": "5.1", "unit": "10^9/L"},
        {"test_name_original": "Glucose", "value": "90", "unit": "mg/dL"},
    ],
    "medications": [
        # Same brand+ingredient as A -> duplicate; Aspirin is new.
        {"brand_name": "Zestril", "active_ingredient_original": "Lisinopril"},
        {"brand_name": "Bayer", "active_ingredient_original": "Aspirin"},
    ],
    "diagnoses": [
        # Same diagnosis_original -> duplicate; new one added.
        {"diagnosis_original": "Hypertension", "code": "I10"},
        {"diagnosis_original": "Type 2 diabetes", "code": "E11"},
    ],
    "vaccinations": [
        # Same vaccine+date -> duplicate; new date -> kept.
        {"vaccine_name": "Influenza", "date_administered": "2024-01-02"},
        {"vaccine_name": "Influenza", "date_administered": "2025-01-02"},
    ],
    "cost": {
        "line_items": [
            # Same description+amount -> duplicate; new item added.
            {"description": "Blood panel", "amount": "50.00"},
            {"description": "Office visit", "amount": "120.00"},
        ]
    },
    "encounter": {"encounter_date": "2024-02-02", "provider": "Dr B"},
}


# ==========================================================================
# Strategy 1: chunked merge_extractions — composite-key dedup.
# ==========================================================================


def test_chunked_merge_dedups_labs_by_test_name_keeping_first():
    base = copy.deepcopy(CHUNK_A)
    merged = merge_extractions(base, copy.deepcopy(CHUNK_B))
    labs = merged["lab_results"]
    # WBC appears once: the chunk-A value is KEPT (first wins), chunk-B's 5.1
    # is dropped. Glucose and RBC survive.
    assert [r["test_name_original"] for r in labs] == ["WBC", "RBC", "Glucose"]
    wbc = next(r for r in labs if r["test_name_original"] == "WBC")
    assert wbc["value"] == "5.0"  # first occurrence kept, not overwritten


def test_chunked_merge_dedups_medications_by_brand_and_ingredient():
    base = copy.deepcopy(CHUNK_A)
    merged = merge_extractions(base, copy.deepcopy(CHUNK_B))
    meds = merged["medications"]
    keys = [(m["brand_name"], m["active_ingredient_original"]) for m in meds]
    assert keys == [("Zestril", "Lisinopril"), ("Bayer", "Aspirin")]


def test_chunked_merge_dedups_diagnoses_by_original():
    base = copy.deepcopy(CHUNK_A)
    merged = merge_extractions(base, copy.deepcopy(CHUNK_B))
    diags = [d["diagnosis_original"] for d in merged["diagnoses"]]
    assert diags == ["Hypertension", "Type 2 diabetes"]


def test_chunked_merge_dedups_vaccinations_by_name_and_date():
    base = copy.deepcopy(CHUNK_A)
    merged = merge_extractions(base, copy.deepcopy(CHUNK_B))
    vax = [(v["vaccine_name"], v["date_administered"]) for v in merged["vaccinations"]]
    # Same name but different date is a DISTINCT row.
    assert vax == [
        ("Influenza", "2024-01-02"),
        ("Influenza", "2025-01-02"),
    ]


def test_chunked_merge_dedups_cost_line_items_by_description_and_amount():
    base = copy.deepcopy(CHUNK_A)
    merged = merge_extractions(base, copy.deepcopy(CHUNK_B))
    items = [(li["description"], li["amount"]) for li in merged["cost"]["line_items"]]
    assert items == [
        ("Blood panel", "50.00"),
        ("Office visit", "120.00"),
    ]


def test_chunked_merge_does_not_merge_encounter_key():
    """merge_extractions has no ``encounter`` handling — base's encounter is
    left untouched and additional's encounter is silently ignored."""
    base = copy.deepcopy(CHUNK_A)
    merged = merge_extractions(base, copy.deepcopy(CHUNK_B))
    assert merged["encounter"] == {"encounter_date": "2024-01-02", "provider": "Dr A"}


def test_chunked_merge_is_in_place_and_returns_base():
    base = copy.deepcopy(CHUNK_A)
    result = merge_extractions(base, copy.deepcopy(CHUNK_B))
    # The same object is mutated and returned.
    assert result is base


def test_chunked_merge_into_empty_base_creates_keys_on_demand():
    """When base lacks a list key, the first additional row creates it via
    ``setdefault`` — but keys with no additional rows are NEVER created."""
    base: dict = {}
    additional = {
        "lab_results": [{"test_name_original": "WBC"}],
        "medications": [{"brand_name": "X", "active_ingredient_original": "Y"}],
    }
    merged = merge_extractions(base, additional)
    assert merged["lab_results"] == [{"test_name_original": "WBC"}]
    assert merged["medications"] == [{"brand_name": "X", "active_ingredient_original": "Y"}]
    # diagnoses/vaccinations were never touched -> not present.
    assert "diagnoses" not in merged
    assert "vaccinations" not in merged
    # cost is only read (base.get("cost", {})) -> not created when absent.
    assert "cost" not in merged


def test_chunked_merge_dedup_treats_missing_key_as_none():
    """A lab row missing ``test_name_original`` dedups under the key ``None``;
    a second nameless row collides with it and is dropped."""
    base = {"lab_results": [{"value": "1"}]}  # test_name_original -> None
    additional = {"lab_results": [{"value": "2"}, {"test_name_original": "WBC"}]}
    merged = merge_extractions(base, additional)
    names = [r.get("test_name_original") for r in merged["lab_results"]]
    # First None kept, second None (the {"value":"2"} row) dropped, WBC added.
    assert names == [None, "WBC"]
    assert merged["lab_results"][0] == {"value": "1"}


# ==========================================================================
# Strategy 2: section merge — NO dedup, extend-everything.
# ==========================================================================


def test_section_merge_extends_all_rows_without_dedup():
    """_merge_section_extractions concatenates every list verbatim — the
    overlapping WBC / Lisinopril / Hypertension rows are NOT deduplicated, so
    duplicates survive (contrast with the chunked merge)."""
    merged = _merge_section_extractions([copy.deepcopy(CHUNK_A), copy.deepcopy(CHUNK_B)])

    # All 4 lab rows (2 + 2) survive, including the duplicate WBC.
    lab_names = [r["test_name_original"] for r in merged["lab_results"]]
    assert lab_names == ["WBC", "RBC", "WBC", "Glucose"]

    # All 3 medications (1 + 2), including the duplicate Lisinopril.
    med_keys = [
        (m["brand_name"], m["active_ingredient_original"]) for m in merged["medications"]
    ]
    assert med_keys == [
        ("Zestril", "Lisinopril"),
        ("Zestril", "Lisinopril"),
        ("Bayer", "Aspirin"),
    ]

    # All diagnoses concatenated, duplicate Hypertension included.
    assert [d["diagnosis_original"] for d in merged["diagnoses"]] == [
        "Hypertension",
        "Hypertension",
        "Type 2 diabetes",
    ]


def test_section_merge_keeps_first_encounter_with_date():
    merged = _merge_section_extractions([copy.deepcopy(CHUNK_A), copy.deepcopy(CHUNK_B)])
    # First section's encounter (has a date) wins; second is ignored.
    assert merged["encounter"] == {"encounter_date": "2024-01-02", "provider": "Dr A"}


def test_section_merge_encounter_skips_dateless_then_takes_next():
    """An encounter without ``encounter_date`` is skipped; the next one that
    HAS a date is adopted."""
    no_date = {"encounter": {"provider": "Dr NoDate"}}
    with_date = {"encounter": {"encounter_date": "2024-03-03", "provider": "Dr Real"}}
    merged = _merge_section_extractions([no_date, with_date])
    assert merged["encounter"] == {"encounter_date": "2024-03-03", "provider": "Dr Real"}


def test_section_merge_cost_extends_items_and_takes_first_total():
    a = {"cost": {"line_items": [{"description": "X", "amount": "1"}], "total_amount": "10", "currency": "EUR"}}
    b = {"cost": {"line_items": [{"description": "Y", "amount": "2"}], "total_amount": "20", "currency": "USD"}}
    merged = _merge_section_extractions([a, b])
    # Items concatenated; first total/currency wins.
    assert [li["description"] for li in merged["cost"]["line_items"]] == ["X", "Y"]
    assert merged["cost"]["total_amount"] == "10"
    assert merged["cost"]["currency"] == "EUR"


def test_section_merge_empty_input_returns_full_fixed_key_set():
    """Even with no sections, the section merge returns the complete fixed
    skeleton (contrast: chunked merge creates keys lazily)."""
    merged = _merge_section_extractions([])
    assert merged == {
        "lab_results": [],
        "diagnoses": [],
        "medications": [],
        "vaccinations": [],
        "encounter": {},
        "cost": {"line_items": []},
    }


def test_section_merge_ignores_non_dict_and_non_list_entries():
    """Non-dict section entries are skipped; a list-typed value where a list is
    expected is extended, but a non-list value for a list key is ignored."""
    merged = _merge_section_extractions(
        [
            "garbage",  # skipped (not a dict)
            {"lab_results": "not a list"},  # lab_results ignored (not a list)
            {"lab_results": [{"test_name_original": "WBC"}]},
        ]
    )
    assert [r["test_name_original"] for r in merged["lab_results"]] == ["WBC"]


# ==========================================================================
# Strategy 3: vision merge — documented, not directly callable.
# ==========================================================================


def test_vision_merge_semantics_note():
    """The vision merge is inline in ``extract_with_vision`` and not a callable
    function, so we pin its semantics by replicating the exact loop:

        merged = {}
        for ex in all_extractions:
            for key, val in ex.items():
                if val and not merged.get(key):
                    merged[key] = val

    i.e. first-non-empty value per top-level key wins; later pages can fill a
    key the earlier page left empty/falsy, but never overwrite a set key, and
    lists are taken whole (no row concatenation, no dedup). This test exercises
    that algorithm so the refactor can confirm the replacement preserves it.
    """

    def vision_merge(all_extractions):
        merged: dict = {}
        for ex in all_extractions:
            for key, val in ex.items():
                if val and not merged.get(key):
                    merged[key] = val
        return merged

    page1 = {
        "doc_type": "lab_report",
        "lab_results": [{"test_name_original": "WBC"}],
        "summary": "",  # falsy -> does not claim the key
    }
    page2 = {
        "doc_type": "OVERWRITE-ATTEMPT",  # ignored: doc_type already set
        "lab_results": [{"test_name_original": "Glucose"}],  # ignored: list already set
        "summary": "Filled in by page 2",  # claims the previously-empty key
        "patient_name": "Jane",  # new key
    }
    merged = vision_merge([page1, page2])

    assert merged["doc_type"] == "lab_report"  # first non-empty wins
    # The WHOLE first list is kept; page2's lab_results are NOT concatenated.
    assert merged["lab_results"] == [{"test_name_original": "WBC"}]
    assert merged["summary"] == "Filled in by page 2"  # empty -> later fills it
    assert merged["patient_name"] == "Jane"
