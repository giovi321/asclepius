"""Child-table write helpers for the extraction pipeline.

Each function owns the INSERT (and, for lab results, the belt-and-braces
date back-fill) for one child table. They were lifted verbatim out of the
~440-line ``extract_and_store`` monolith in :mod:`extractor`; the SQL,
column order, dedup/clear semantics, resolver fallbacks, and the order in
which rows are written are unchanged. ``extract_and_store`` now calls these
in the same sequence it used to execute the blocks inline.

These writers depend on the salvage helpers
(:mod:`extraction_sanitize`) and the normalized-reference resolvers
(:mod:`extractor_db`, :mod:`entity_matching`); those are leaves relative to
this module, so there is no import cycle.
"""

import aiosqlite

from .entity_matching import _resolve_specialty_from_doctor
from .extraction_sanitize import _clean, _coerce_iso_date, _normalize_lab_row
from .extractor_db import (
    _resolve_diagnosis,
    _resolve_lab_test,
    _resolve_medication,
)


async def write_lab_results(
    db: aiosqlite.Connection,
    doc_id: int,
    patient_id: int,
    extraction: dict,
    doc_best_date,
    logger,
) -> None:
    """Insert lab_results rows, then back-fill any NULL test_date from the doc."""
    for lab in extraction.get("lab_results", []):
        if not isinstance(lab, dict):
            continue
        # Per-item schema drift salvage — promote aliases, parse combined
        # reference-range strings, unwrap '*' placeholders. See
        # _normalize_lab_row for the full list of heuristics.
        _normalize_lab_row(lab)
        if not lab.get("test_name_original"):
            logger.warning("Doc %d: skipping lab result with no test name: %s", doc_id, lab)
            continue
        # Pre-populated by resolve_extraction above. Fall back to the
        # legacy LLM-driven resolver for the edge case where
        # resolve_extraction wasn't called (error path / override).
        norm_id = lab.get("norm_lab_test_id")
        if norm_id is None:
            norm_id = await _resolve_lab_test(db, lab)
        # Strict ISO parse: garbage strings ("unknown", "n/a", malformed
        # dates) are dropped so the parent's event_date fallback fires.
        lab_test_date = _coerce_iso_date(lab.get("test_date")) or doc_best_date
        await db.execute(
            """INSERT INTO lab_results
               (document_id, patient_id, test_name_original, norm_lab_test_id,
                value, value_text, unit, reference_range_low, reference_range_high,
                is_abnormal, sample_type, panel_name, test_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                patient_id,
                _clean(lab.get("test_name_original")),
                norm_id,
                lab.get("value"),
                _clean(lab.get("value_text")),
                _clean(lab.get("unit")),
                lab.get("reference_range_low"),
                lab.get("reference_range_high"),
                lab.get("is_abnormal"),
                _clean(lab.get("sample_type")),
                _clean(lab.get("panel_name")),
                lab_test_date,
            ),
        )

    # Belt-and-braces: if any lab rows still have NULL test_date but the
    # parent document carries an event_date, copy it across. Covers the
    # edge case where event_date is stamped after the lab loop runs (some
    # extraction paths reorder).
    await db.execute(
        """UPDATE lab_results SET test_date = (
               SELECT event_date FROM documents WHERE id = ?
           )
           WHERE document_id = ? AND test_date IS NULL
             AND (SELECT event_date FROM documents WHERE id = ?) IS NOT NULL""",
        (doc_id, doc_id, doc_id),
    )


async def write_encounters(
    db: aiosqlite.Connection,
    doc_id: int,
    patient_id: int,
    extraction: dict,
    doctor_id,
    facility_id,
    doctor_data: dict,
    event_date_val,
) -> None:
    """Insert encounters/diagnoses rows for the document."""
    # Insert encounters/diagnoses
    encounter = extraction.get("encounter", {})
    if not isinstance(encounter, dict):
        encounter = {}
    for diag in extraction.get("diagnoses", []):
        if not isinstance(diag, dict):
            continue
        norm_diag_id = diag.get("norm_diagnosis_id")
        if norm_diag_id is None:
            norm_diag_id = await _resolve_diagnosis(db, diag)
        # Specialty resolution now populates doctor["norm_specialty_id"]
        # and encounter["norm_specialty_id"] directly. Prefer those, fall
        # back to the legacy doctor-specialty-canonical path.
        norm_spec_id = encounter.get("norm_specialty_id") or doctor_data.get("norm_specialty_id")
        if norm_spec_id is None and doctor_data.get("specialty_canonical"):
            norm_spec_id = await _resolve_specialty_from_doctor(db, doctor_data)

        await db.execute(
            """INSERT INTO encounters
               (document_id, patient_id, doctor_id, facility_id, encounter_date,
                admission_date, discharge_date, norm_diagnosis_id,
                diagnosis_original, diagnosis_code, norm_specialty_id,
                notes, findings, follow_up_date, follow_up_instructions)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                patient_id,
                doctor_id,
                facility_id,
                encounter.get("encounter_date") or event_date_val,
                encounter.get("admission_date"),
                encounter.get("discharge_date"),
                norm_diag_id,
                _clean(diag.get("diagnosis_original")),
                _clean(diag.get("icd10_code")),
                norm_spec_id,
                _clean(extraction.get("summary_en")),
                _clean(encounter.get("findings")),
                encounter.get("follow_up_date"),
                _clean(encounter.get("follow_up_instructions")),
            ),
        )

    # If no diagnoses but encounter data exists, still create encounter
    if not extraction.get("diagnoses") and encounter.get("encounter_date"):
        await db.execute(
            """INSERT INTO encounters
               (document_id, patient_id, doctor_id, facility_id, encounter_date,
                notes, findings, follow_up_date, follow_up_instructions)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                patient_id,
                doctor_id,
                facility_id,
                encounter.get("encounter_date"),
                _clean(extraction.get("summary_en")),
                _clean(encounter.get("findings")),
                encounter.get("follow_up_date"),
                _clean(encounter.get("follow_up_instructions")),
            ),
        )


async def write_medications(
    db: aiosqlite.Connection,
    doc_id: int,
    patient_id: int,
    extraction: dict,
    event_date_val,
) -> None:
    """Insert medications rows for the document."""
    # Insert medications
    for med in extraction.get("medications", []):
        if not isinstance(med, dict):
            continue
        norm_med_id = med.get("norm_medication_id")
        if norm_med_id is None:
            norm_med_id = await _resolve_medication(db, med)
        await db.execute(
            """INSERT INTO medications
               (document_id, patient_id, norm_medication_id, brand_name,
                active_ingredient_original, dosage, form, frequency,
                duration, quantity, prescribed_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                patient_id,
                norm_med_id,
                _clean(med.get("brand_name")),
                _clean(med.get("active_ingredient_original")),
                _clean(med.get("dosage")),
                _clean(med.get("form")),
                _clean(med.get("frequency")),
                _clean(med.get("duration")),
                _clean(med.get("quantity")),
                event_date_val,
            ),
        )


async def write_vaccinations(
    db: aiosqlite.Connection,
    doc_id: int,
    patient_id: int,
    extraction: dict,
) -> None:
    """Insert vaccinations rows for the document."""
    # Insert vaccinations
    for vax in extraction.get("vaccinations", []):
        if not isinstance(vax, dict):
            continue
        await db.execute(
            """INSERT INTO vaccinations
               (document_id, patient_id, vaccine_name, manufacturer,
                lot_number, dose_number, date_administered)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                patient_id,
                _clean(vax.get("vaccine_name")),
                _clean(vax.get("manufacturer")),
                _clean(vax.get("lot_number")),
                _clean(vax.get("dose_number")),
                vax.get("date_administered"),
            ),
        )


async def write_invoice_items(
    db: aiosqlite.Connection,
    doc_id: int,
    patient_id,
    cost_data: dict,
) -> None:
    """Insert invoice line items.

    Not gated on patient_id — invoices may not have a patient. The caller
    blanks ``cost_data`` to ``{}`` when ``invoice_items`` is outside the
    write scope, so the loop simply finds nothing to insert in that case.
    """
    for item in cost_data.get("line_items", []):
        if not isinstance(item, dict) or not item.get("description"):
            continue
        await db.execute(
            """INSERT INTO invoice_items
               (document_id, patient_id, description, quantity, unit_price,
                amount, currency, tariff_code, tax_rate, category)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                patient_id,
                _clean(item["description"]),
                item.get("quantity", 1),
                item.get("unit_price"),
                item.get("amount"),
                cost_data.get("currency", "CHF"),
                _clean(item.get("tariff_code")),
                cost_data.get("tax_rate"),
                _clean(item.get("category")),
            ),
        )
