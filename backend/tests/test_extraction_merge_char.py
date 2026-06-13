"""Characterization tests for the extraction-merge strategies.

Asclepius historically had THREE different merge paths that combine per-chunk
/ per-section / per-page extractions into one result, each with DIFFERENT
dedup semantics. Phase 4 unified all three onto the single canonical merger in
``asclepius.pipeline.extraction_merge`` (``merge_pair`` / ``merge_section_
extractions`` / ``merge_extraction_dicts``). The canonical contract is:

    * ARRAY fields (lab_results, diagnoses, medications, vaccinations,
      encounters, invoice_items, and the nested cost.line_items) →
      CONCATENATE across all inputs, then DEDUP by an explicit per-array
      composite key (``extraction_merge.ARRAY_DEDUP_KEYS``):
        lab: test_name_original; medication: brand_name+active_ingredient;
        diagnosis: diagnosis_original; vaccination: name+date; cost line item:
        description+amount. First row per key wins.
    * SCALAR / metadata fields → first non-empty value wins.

The three paths now differ only in two intentional knobs:

    1. ``chunked_extraction.merge_extractions(base, additional)`` →
       ``merge_pair``. Still a pairwise, in-place merge that only touches the
       array fields and leaves every scalar/metadata field (including the
       singular ``encounter``) exactly as ``base`` had it. Behaviour is
       unchanged from before unification — the canonical keys were DERIVED from
       this implementation.

    2. ``section_processor._merge_section_extractions(list_of_dicts)`` →
       ``merge_section_extractions``. Folds a LIST of section dicts. Phase 4:
       arrays are now concatenated AND deduped (they used to be ``extend``-ed
       verbatim). Still keeps the FIRST ``encounter`` bearing an
       ``encounter_date`` and always returns the full fixed key skeleton.

    3. Vision merge (inline in ``vision_extractor.extract_with_vision``) →
       ``merge_extraction_dicts(..., fill_scalars=True)``. Phase 4: arrays now
       concatenate+dedup across pages (they used to be first-page-list-wins).
       Scalar/metadata fields still take the first non-empty value per key.

These are pure-function tests — no DB, no network.
"""

from __future__ import annotations

import copy

from asclepius.pipeline.chunked_extraction import merge_extractions
from asclepius.pipeline.extraction_merge import merge_extraction_dicts
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


def test_section_merge_concatenates_and_dedups_rows():
    """Phase 4: unified merge — was extend-all (duplicates survive), now
    concatenate+dedup. The page-boundary-overlap WBC / Lisinopril /
    Hypertension rows collapse to a single occurrence each, identical to what
    the chunked merge produces for the same input."""
    merged = _merge_section_extractions([copy.deepcopy(CHUNK_A), copy.deepcopy(CHUNK_B)])

    # Phase 4: unified merge — was ["WBC","RBC","WBC","Glucose"] (dup WBC),
    # now concatenate+dedup → the second WBC is dropped.
    lab_names = [r["test_name_original"] for r in merged["lab_results"]]
    assert lab_names == ["WBC", "RBC", "Glucose"]
    # First-occurrence wins: chunk-A's WBC value is kept, chunk-B's 5.1 dropped.
    wbc = next(r for r in merged["lab_results"] if r["test_name_original"] == "WBC")
    assert wbc["value"] == "5.0"

    # Phase 4: unified merge — was [Zestril/Lisinopril, Zestril/Lisinopril,
    # Bayer/Aspirin] (dup Lisinopril), now concatenate+dedup → one Lisinopril.
    med_keys = [
        (m["brand_name"], m["active_ingredient_original"]) for m in merged["medications"]
    ]
    assert med_keys == [
        ("Zestril", "Lisinopril"),
        ("Bayer", "Aspirin"),
    ]

    # Phase 4: unified merge — was [Hypertension, Hypertension, Type 2 diabetes]
    # (dup Hypertension), now concatenate+dedup → one Hypertension.
    assert [d["diagnosis_original"] for d in merged["diagnoses"]] == [
        "Hypertension",
        "Type 2 diabetes",
    ]

    # Vaccinations: same name + different date stays DISTINCT (date is part of
    # the composite key); same name+date dedups.
    assert [(v["vaccine_name"], v["date_administered"]) for v in merged["vaccinations"]] == [
        ("Influenza", "2024-01-02"),
        ("Influenza", "2025-01-02"),
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


def test_section_merge_cost_dedups_items_and_takes_first_total():
    a = {
        "cost": {
            "line_items": [{"description": "X", "amount": "1"}],
            "total_amount": "10",
            "currency": "EUR",
        }
    }
    b = {
        "cost": {
            # Same description+amount as A -> duplicate; Y is new.
            "line_items": [
                {"description": "X", "amount": "1"},
                {"description": "Y", "amount": "2"},
            ],
            "total_amount": "20",
            "currency": "USD",
        }
    }
    merged = _merge_section_extractions([a, b])
    # Phase 4: unified merge — was extend-all (duplicate X survives), now
    # concatenate+dedup by description+amount → the second X is dropped.
    assert [li["description"] for li in merged["cost"]["line_items"]] == ["X", "Y"]
    # Quirk preserved: first total/currency wins (cost totals are NOT summed).
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
    expected is concatenated+deduped, but a non-list value for a list key is
    ignored. (Unchanged by Phase 4 — the robustness guard is the same.)"""
    merged = _merge_section_extractions(
        [
            "garbage",  # skipped (not a dict)
            {"lab_results": "not a list"},  # lab_results ignored (not a list)
            {"lab_results": [{"test_name_original": "WBC"}]},
        ]
    )
    assert [r["test_name_original"] for r in merged["lab_results"]] == ["WBC"]


# ==========================================================================
# Strategy 3: vision merge — now the canonical ``merge_extraction_dicts``.
# ==========================================================================
#
# The vision flow (``vision_extractor.extract_with_vision``) used to merge its
# per-page extractions with an inline loop:
#
#     merged = {}
#     for ex in all_extractions:
#         for key, val in ex.items():
#             if val and not merged.get(key):
#                 merged[key] = val
#
# i.e. first-non-empty value per top-level key, lists taken whole (no concat,
# no dedup). Phase 4 replaced that loop with
# ``merge_extraction_dicts(all_extractions, fill_scalars=True)``: scalar keys
# keep first-non-empty-wins, but ARRAY keys now concatenate+dedup across pages.


def _vision_merge(all_extractions):
    """The current vision merge, exactly as ``extract_with_vision`` calls it."""
    return merge_extraction_dicts(all_extractions, fill_scalars=True)


def test_vision_merge_scalar_fields_first_non_empty_wins():
    """Scalar/metadata fields are UNCHANGED by Phase 4: first non-empty value
    per key wins; a key left empty/falsy by page 1 can be filled by page 2, but
    a set key is never overwritten."""
    page1 = {
        "doc_type": "lab_report",
        "summary": "",  # falsy -> does not claim the key
    }
    page2 = {
        "doc_type": "OVERWRITE-ATTEMPT",  # ignored: doc_type already set
        "summary": "Filled in by page 2",  # claims the previously-empty key
        "patient_name": "Jane",  # new key
    }
    merged = _vision_merge([page1, page2])

    assert merged["doc_type"] == "lab_report"  # first non-empty wins
    assert merged["summary"] == "Filled in by page 2"  # empty -> later fills it
    assert merged["patient_name"] == "Jane"


def test_vision_merge_arrays_now_concatenate_and_dedup():
    """Phase 4: unified merge — was first-page-list-wins (page 2's array
    dropped whole), now concatenate+dedup across pages."""
    page1 = {"lab_results": [{"test_name_original": "WBC"}]}
    page2 = {
        "lab_results": [
            {"test_name_original": "WBC"},  # duplicate of page 1 -> dropped
            {"test_name_original": "Glucose"},  # new -> kept
        ]
    }
    merged = _vision_merge([page1, page2])

    # Phase 4: unified merge — was [{"test_name_original":"WBC"}] (page 2's
    # whole list dropped because the key was already set), now concatenate+dedup
    # → page 2's Glucose is appended and its duplicate WBC is dropped.
    assert [r["test_name_original"] for r in merged["lab_results"]] == ["WBC", "Glucose"]


def test_vision_merge_full_synthetic_matches_chunked_output():
    """Phase 4: feeding the shared CHUNK_A / CHUNK_B multi-part input through
    the vision merge now yields the SAME deduped child-row sets as the chunked
    and section paths — the whole point of unification.

    Was (old first-page-wins vision loop): lab_results=[WBC, RBC];
    medications=[Zestril/Lisinopril]; diagnoses=[Hypertension];
    vaccinations=[(Influenza,2024-01-02)]; cost=[Blood panel].
    """
    merged = _vision_merge([copy.deepcopy(CHUNK_A), copy.deepcopy(CHUNK_B)])

    # Phase 4: unified merge — was [WBC, RBC] (chunk B dropped), now
    # concatenate+dedup.
    assert [r["test_name_original"] for r in merged["lab_results"]] == ["WBC", "RBC", "Glucose"]
    # Phase 4: unified merge — was [Zestril/Lisinopril] only, now +Bayer/Aspirin.
    assert [
        (m["brand_name"], m["active_ingredient_original"]) for m in merged["medications"]
    ] == [("Zestril", "Lisinopril"), ("Bayer", "Aspirin")]
    # Phase 4: unified merge — was [Hypertension] only, now +Type 2 diabetes.
    assert [d["diagnosis_original"] for d in merged["diagnoses"]] == [
        "Hypertension",
        "Type 2 diabetes",
    ]
    # Phase 4: unified merge — was [(Influenza,2024-01-02)] only, now the
    # second date survives as a distinct row.
    assert [(v["vaccine_name"], v["date_administered"]) for v in merged["vaccinations"]] == [
        ("Influenza", "2024-01-02"),
        ("Influenza", "2025-01-02"),
    ]
    # Phase 4: unified merge — was [Blood panel] only, now +Office visit.
    assert [(li["description"], li["amount"]) for li in merged["cost"]["line_items"]] == [
        ("Blood panel", "50.00"),
        ("Office visit", "120.00"),
    ]
    # Scalar fields unchanged: first non-empty doc_type / encounter win.
    assert merged["doc_type"] == "lab_report"
    assert merged["encounter"] == {"encounter_date": "2024-01-02", "provider": "Dr A"}
