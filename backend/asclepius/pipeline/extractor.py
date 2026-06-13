"""LLM-based data extraction orchestrator.

Phase 1 (classification + universal fields) and phase 2 (type-specific
structured arrays) both live here. DB-specific upsert/lookup helpers live
in :mod:`entity_matching` (patient / doctor / facility) and
:mod:`extractor_db` (normalized reference tables). Those modules are
re-exported below so the existing ``from asclepius.pipeline.extractor
import _upsert_doctor, _match_patient, …`` call sites keep working.

The supporting vocabulary and heuristics were split into focused leaf
modules and re-exported here so existing importers (``chunked_extraction``,
``section_processor``, ``reprocessor``, ``processor``, …) keep working
against the historic ``asclepius.pipeline.extractor`` paths:

* :mod:`doc_types` — ``VALID_DOC_TYPES``, the alias table, ``_normalize_doc_type``.
* :mod:`extraction_sanitize` — the LLM-output salvage/coercion helpers.
* :mod:`extractor_writers` — the per-child-table DB-write helpers that
  ``extract_and_store`` orchestrates.
"""

import json
import logging

import aiosqlite

from asclepius.config import AppConfig
from asclepius.llm.base import LLMProvider
from asclepius.llm.prompts import canonical_language_directive as _canonical_language_directive

from . import extractor_writers
from .doc_types import (
    VALID_DOC_TYPES,
    _DOC_TYPE_ALIASES,
    _normalize_doc_type,
)
from .entity_matching import (
    _match_patient,
    _resolve_specialty_from_doctor,
    _upsert_doctor,
    _upsert_facility,
    normalize_name,
    strip_doctor_title,
)
from .extraction_sanitize import (
    _ARRAY_KEY_ALIASES,
    _ISO_DATE_RE,
    _PLACEHOLDER_SENTINELS,
    _clean,
    _coerce_iso_date,
    _is_missing,
    _normalize_lab_row,
    _parse_reference_range,
    _salvage_array_keys,
    _salvage_classification,
)
from .extractor_db import (
    _resolve_diagnosis,
    _resolve_lab_test,
    _resolve_medication,
    _resolve_specialty_from_data,
)

__all__ = [
    "build_extraction_context",
    "classify_and_extract",
    "extract_and_store",
    "strip_doctor_title",
    "normalize_name",
    "_match_patient",
    "_upsert_doctor",
    "_upsert_facility",
    "_resolve_specialty_from_doctor",
    "_resolve_specialty_from_data",
    "_resolve_lab_test",
    "_resolve_diagnosis",
    "_resolve_medication",
    # Re-exported from doc_types / extraction_sanitize so importers that
    # reference them via ``asclepius.pipeline.extractor`` keep working.
    "VALID_DOC_TYPES",
    "_DOC_TYPE_ALIASES",
    "_normalize_doc_type",
    "_salvage_classification",
    "_salvage_array_keys",
    "_ARRAY_KEY_ALIASES",
    "_PLACEHOLDER_SENTINELS",
    "_is_missing",
    "_clean",
    "_parse_reference_range",
    "_normalize_lab_row",
    "_ISO_DATE_RE",
    "_coerce_iso_date",
]

logger = logging.getLogger(__name__)


async def build_extraction_context(db: aiosqlite.Connection) -> dict:
    """Build context dict for LLM extraction prompt."""
    # Get known patients. DOB + sex are included so the extractor can
    # disambiguate the right patient on multi-name documents and so
    # type-specific prompts (lab ranges, medication doses) see the context
    # they'd normally depend on. The rest of the patient profile is not
    # useful to the LLM and intentionally not stored.
    cursor = await db.execute("SELECT id, slug, display_name, date_of_birth, sex FROM patients")
    patients = [
        {
            "id": r[0],
            "slug": r[1],
            "name": r[2],
            "date_of_birth": r[3],
            "sex": r[4],
        }
        for r in await cursor.fetchall()
    ]

    # Get known facilities
    cursor = await db.execute("SELECT id, slug, name FROM facilities")
    facilities = [{"id": r[0], "slug": r[1], "name": r[2]} for r in await cursor.fetchall()]

    # Get known doctors
    cursor = await db.execute("SELECT id, slug, name FROM doctors")
    doctors = [{"id": r[0], "slug": r[1], "name": r[2]} for r in await cursor.fetchall()]

    # NOTE: lab_test / medication / diagnosis / specialty mappings are
    # deliberately NOT fetched here any more. Shipping the full alias
    # table as prompt context grew to hundreds of kilobytes on real
    # installs, which blew past small-model context limits and destroyed
    # schema adherence. Mapping now happens deterministically after
    # extraction via ``asclepius.normalization.resolver``. The LLM just
    # emits ``*_original`` text; Python does the lookup.

    # Canonical output language — pulled from app config so every LLM call can
    # see it without a second round-trip. Providers prepend the directive via
    # _canonical_language_directive() before the actual prompt.
    try:
        from asclepius.config import get_config as _get_config

        canonical_language = _get_config().llm.canonical_language or "English"
    except Exception:
        canonical_language = "English"

    return {
        "patient_list": patients,
        "facility_list": facilities,
        "doctor_list": doctors,
        "canonical_language": canonical_language,
        # NOTE: lab_test/medication/diagnosis/specialty mappings are
        # intentionally absent from the context. Prompt templates no
        # longer reference them — the post-extraction
        # ``asclepius.normalization.resolver`` pass does deterministic
        # alias matching (with rapidfuzz fallback) and auto-creates
        # unmapped canonical rows for the user to review in the
        # Normalization UI.
    }


async def _extract_type_specific(
    llm: LLMProvider,
    ocr_text: str,
    doc_type: str,
    context: dict,
    db_path: str | None = None,
) -> dict:
    """Call the type-specific extraction prompt for phase 2."""
    from asclepius.llm.prompts import TYPE_EXTRACTION_PROMPTS

    # Try custom prompt first
    prompt_template = None
    if db_path:
        from asclepius.llm.prompt_manager import get_prompt

        custom_key = f"extraction_{doc_type}"
        try:
            custom = await get_prompt(db_path, custom_key)
            if custom:
                prompt_template = custom
        except Exception:
            pass

    if not prompt_template:
        prompt_template = TYPE_EXTRACTION_PROMPTS.get(doc_type)
    if not prompt_template:
        return {}

    # Build format kwargs with only the placeholders that exist in this template
    format_kwargs: dict[str, str] = {"ocr_text": ocr_text}
    import json as _json

    mapping_keys = {
        "lab_test_mappings": "lab_test_mappings",
        "specialty_mappings": "specialty_mappings",
        "diagnosis_mappings": "diagnosis_mappings",
        "medication_mappings": "medication_mappings",
    }
    for placeholder, ctx_key in mapping_keys.items():
        if "{" + placeholder + "}" in prompt_template:
            format_kwargs[placeholder] = _json.dumps(context.get(ctx_key, []), indent=2)

    prompt = prompt_template.format(**format_kwargs)
    # Force outputs into the user-selected canonical language.
    prompt = _canonical_language_directive(context.get("canonical_language", "English")) + prompt

    # Use the LLM's internal generate + parse (works for both Ollama and Claude)
    if hasattr(llm, "_generate"):
        response_text = await llm._generate(prompt)
        return llm._parse_json(response_text)
    else:
        # Fallback: use extract with the formatted prompt as ocr_text
        # This shouldn't normally happen since both providers have _generate
        return {}


async def classify_and_extract(
    db: aiosqlite.Connection,
    llm: LLMProvider,
    doc_id: int,
    ocr_text: str,
    config: AppConfig,
    extraction_override: dict | None = None,
) -> dict:
    """Two-phase extraction: classify first, then extract type-specific data.

    Phase 1: Classify document and extract universal fields (patient, doctor,
             facility, dates, summary).
    Phase 2: Run a type-specific prompt to extract structured data (lab results,
             medications, diagnoses, etc.)

    If extraction_override is provided, skip both LLM calls and use that data directly.
    """
    context = await build_extraction_context(db)

    if extraction_override:
        extraction = extraction_override
    else:
        # Retrieve few-shot examples from similar documents
        few_shot_str = ""
        try:
            from asclepius.pipeline.few_shot import find_few_shot_examples, format_few_shot_examples

            examples = await find_few_shot_examples(db, ocr_text, current_doc_id=doc_id)
            few_shot_str = format_few_shot_examples(examples)
        except Exception:
            logger.debug("Few-shot example retrieval failed (non-fatal)", exc_info=True)

        # Add few-shot examples to context so provider .classify() methods can use them
        context["few_shot_examples"] = few_shot_str

        # Phase 1: Classify. The provider resolves the UI-customized
        # "classification" prompt itself (falling back to the default), so the
        # main, chunked, and section paths all honor a prompt override through
        # the same code path instead of this one wiring it up by hand.
        logger.info("Phase 1 — classifying doc %d", doc_id)
        classification = await llm.classify(ocr_text, context)

        if "error" in classification:
            logger.error(
                "Classification failed for doc %d: %s", doc_id, classification.get("error")
            )
            await db.execute(
                "UPDATE documents SET status = 'failed', raw_extraction = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (json.dumps(classification), doc_id),
            )
            await db.commit()
            return classification

        # Salvage data from non-conforming LLM responses — small models often
        # ignore the schema and return their own key names
        _salvage_classification(classification)

        # Normalize doc_type to valid code
        doc_type = _normalize_doc_type(classification.get("doc_type", "other"))
        classification["doc_type"] = doc_type

        # Phase 2: Type-specific extraction
        logger.info(
            "Phase 2 — extracting type-specific data for doc %d (type=%s)", doc_id, doc_type
        )
        type_extraction = await _extract_type_specific(
            llm, ocr_text, doc_type, context, db_path=config.database.path
        )

        # Merge: classification provides the base, type-specific adds structured arrays
        extraction = {**classification, **type_extraction}

    # Log what we're about to write — helps diagnose "no data" issues
    _summary_keys = {
        k: type(v).__name__ if isinstance(v, (dict, list)) else repr(v)[:80]
        for k, v in extraction.items()
        if v
    }
    logger.info("Extraction for doc %d: %s", doc_id, _summary_keys)

    # Delegate to extract_and_store for DB writes
    return await extract_and_store(
        db, llm, doc_id, ocr_text, config, extraction_override=extraction
    )


async def extract_and_store(
    db: aiosqlite.Connection,
    llm: LLMProvider,
    doc_id: int,
    ocr_text: str,
    config: AppConfig,
    extraction_override: dict | None = None,
    scope: set[str] | None = None,
) -> dict:
    """Run LLM extraction and write results to DB tables.

    If ``extraction_override`` is provided, skip the LLM call and use that
    data directly.

    ``scope`` (when set) restricts the write side to a subset of the
    child tables — valid entries are ``lab_results``, ``encounters``,
    ``medications``, ``vaccinations``, ``invoice_items``. Document-level
    metadata (doc_type, dates, summary, doctor, facility, etc.) is left
    untouched in scoped mode. Used by the AI editor to "only overwrite
    lab tests" (or any subset) without disturbing the rest of the
    document. ``None`` keeps the original whole-document behaviour.

    The per-child-table INSERTs live in :mod:`extractor_writers`; this
    function is the orchestrator that prepares document-level state and
    invokes each writer in the historic order.
    """
    _all_children = {"lab_results", "encounters", "medications", "vaccinations", "invoice_items"}
    _scope = scope if scope is not None else _all_children
    _scoped_run = scope is not None
    context = await build_extraction_context(db)
    if extraction_override:
        extraction = extraction_override
    else:
        extraction = await llm.extract(ocr_text, context)

    # Salvage common key-name drift (e.g. "results" → "lab_results") before we
    # sanitize types, so the rename doesn't get wiped out.
    _salvage_array_keys(extraction)

    # Sanitize extraction — LLMs sometimes return strings instead of dicts/lists
    for key in ("doctor", "facility", "specialty", "insurance", "encounter", "cost"):
        if key in extraction and not isinstance(extraction[key], dict):
            extraction[key] = {}
    for key in ("lab_results", "diagnoses", "medications", "vaccinations"):
        if key in extraction and not isinstance(extraction[key], list):
            extraction[key] = []

    # Deterministic normalization — exact-match, fuzzy-match, or
    # auto-create canonical entries for every referenced lab test /
    # medication / diagnosis / specialty. Fills in ``norm_*_id`` fields
    # on each row so the insert loops below can use them directly.
    # Runs before the error/truncation branches so partial extractions
    # (e.g. response hit token cap mid-list) still get their usable rows
    # mapped.
    if "error" not in extraction:
        try:
            from asclepius.normalization.resolver import resolve_extraction

            await resolve_extraction(db, extraction)
        except Exception:
            logger.warning(
                "Doc %d: normalization resolver failed (non-fatal)",
                doc_id,
                exc_info=True,
            )

    if "error" in extraction:
        if extraction.get("_truncation_suspected"):
            logger.error(
                "LLM extraction failed for doc %d (TRUNCATION SUSPECTED, response_len=%s): %s — "
                "raise llm.extraction_max_output_tokens in settings.yaml.",
                doc_id,
                extraction.get("_response_length"),
                extraction.get("error"),
            )
        else:
            logger.error("LLM extraction failed for doc %d: %s", doc_id, extraction.get("error"))
        await db.execute(
            "UPDATE documents SET status = 'failed', raw_extraction = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (json.dumps(extraction), doc_id),
        )
        await db.commit()
        return extraction
    if extraction.get("_truncated"):
        logger.warning(
            "Doc %d: LLM response was truncated; kept partial extraction "
            "(%d lab_results, %d medications, %d diagnoses). "
            "Consider raising llm.extraction_max_output_tokens.",
            doc_id,
            len(extraction.get("lab_results") or []),
            len(extraction.get("medications") or []),
            len(extraction.get("diagnoses") or []),
        )

    # Clear prior child rows so re-extraction overwrites old data instead
    # of appending duplicates. In ``scope``-restricted runs (e.g. AI edit
    # for "labs only"), only the in-scope tables get cleared so the rest
    # of the document's data survives.
    for _child in _all_children:
        if _child in _scope:
            await db.execute(f"DELETE FROM {_child} WHERE document_id = ?", (doc_id,))

    # Store raw extraction — use the provider label if available
    llm_label = getattr(llm, "provider_label", "") or "unknown"
    await db.execute(
        "UPDATE documents SET raw_extraction = ?, llm_provider = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (json.dumps(extraction), llm_label, doc_id),
    )

    # Get the document's patient_id (always — needed for child inserts).
    cursor = await db.execute("SELECT patient_id FROM documents WHERE id = ?", (doc_id,))
    row = await cursor.fetchone()
    patient_id = row[0] if row else None

    if not patient_id and not _scoped_run:
        # Try to match patient from extraction — auto-assign. Skipped on
        # scoped runs because a partial extraction may not even include
        # patient_name, and we don't want a scoped re-extract to
        # accidentally re-assign the patient.
        patient_id = await _match_patient(db, extraction.get("patient_name"))
        if patient_id:
            await db.execute(
                "UPDATE documents SET patient_id = ? WHERE id = ?", (patient_id, doc_id)
            )

    # Document-level metadata + facility/doctor/insurance/cost. Skipped
    # entirely in ``scope``-restricted runs so AI edit "overwrite labs"
    # doesn't wipe the document's doc_type / summary / doctor etc. when
    # the partial OCR text doesn't carry those fields.
    facility_id = None
    doctor_id = None
    doctor_data: dict = {}
    event_date_val = None

    if _scoped_run:
        # Read back the existing facility / doctor ids so child inserts
        # below can populate FK columns consistently with the rest of the
        # document. Same query the legacy path effectively does via the
        # upserts.
        cursor = await db.execute(
            "SELECT facility_id, doctor_id, event_date FROM documents WHERE id = ?",
            (doc_id,),
        )
        row = await cursor.fetchone()
        if row:
            facility_id = row[0]
            doctor_id = row[1]
            event_date_val = row[2]
    else:
        # Update document metadata (full-run path).
        updates: dict = {}
        if extraction.get("doc_type"):
            updates["doc_type"] = extraction["doc_type"]
        # Collapse the historic three-date LLM schema (date_visit >
        # date_issued > doc_date) into the canonical event_date. Prefer an
        # explicit event_date if the LLM already emitted one.
        event_date_val = (
            extraction.get("event_date")
            or extraction.get("date_visit")
            or extraction.get("date_issued")
            or extraction.get("doc_date")
        )
        if event_date_val:
            updates["event_date"] = event_date_val
        issued_date_val = extraction.get("issued_date") or extraction.get("date_issued")
        if issued_date_val:
            updates["issued_date"] = issued_date_val
        if lang := _clean(extraction.get("language_detected")):
            updates["language_source"] = lang
        if sum_en := _clean(extraction.get("summary_en")):
            updates["summary_en"] = sum_en
        if sum_orig := _clean(extraction.get("summary_original")):
            updates["summary_original"] = sum_orig
        cost_data = extraction.get("cost", {})
        if cost_data.get("total_amount"):
            updates["cost_amount"] = cost_data["total_amount"]
            updates["cost_currency"] = cost_data.get("currency")
        elif cost_data.get("amount"):
            updates["cost_amount"] = cost_data["amount"]
            updates["cost_currency"] = cost_data.get("currency")

        # Insurance info from extraction
        insurance = extraction.get("insurance", {})
        if ins_co := _clean(insurance.get("company")):
            updates["insurance_company"] = ins_co
        if ins_pol := _clean(insurance.get("policy_number")):
            updates["insurance_policy"] = ins_pol

        # Specialty info on the document itself
        specialty_data = extraction.get("specialty", {})
        if spec_orig := _clean(specialty_data.get("original")):
            updates["specialty_original"] = spec_orig
        # resolve_extraction() populates specialty["norm_specialty_id"] from
        # the original text; fall back to the legacy canonical-based
        # resolver when that wasn't run (error / override path).
        if specialty_data.get("norm_specialty_id"):
            updates["norm_specialty_id"] = specialty_data["norm_specialty_id"]
        elif specialty_data.get("canonical"):
            norm_spec_id = await _resolve_specialty_from_data(db, specialty_data)
            if norm_spec_id:
                updates["norm_specialty_id"] = norm_spec_id

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [doc_id]
            await db.execute(f"UPDATE documents SET {set_clause} WHERE id = ?", values)
            logger.info("Doc %d metadata updated: %s", doc_id, list(updates.keys()))
        else:
            logger.warning("Doc %d: no metadata fields to update from extraction", doc_id)

        # Upsert facility
        facility_data = extraction.get("facility", {})
        if facility_data.get("name"):
            facility_id = await _upsert_facility(db, facility_data)
            await db.execute(
                "UPDATE documents SET facility_id = ? WHERE id = ?",
                (facility_id, doc_id),
            )

        # Upsert doctor
        doctor_data = extraction.get("doctor", {})
        if doctor_data.get("name"):
            doctor_id = await _upsert_doctor(db, doctor_data, facility_id)
            await db.execute(
                "UPDATE documents SET doctor_id = ? WHERE id = ?",
                (doctor_id, doc_id),
            )

    # Insert child rows. Each block is gated on ``scope`` so a focused AI
    # edit (e.g. "labs only") only touches the matching table.
    doc_best_date = None
    if patient_id:
        # Default test_date for every lab/medication/encounter row that
        # doesn't carry its own. Read back from the DB so any dates the
        # user manually set pre-extraction are respected.
        cursor = await db.execute(
            "SELECT event_date FROM documents WHERE id = ?",
            (doc_id,),
        )
        drow = await cursor.fetchone()
        doc_best_date = drow[0] if drow else None

    if patient_id and "lab_results" in _scope:
        await extractor_writers.write_lab_results(
            db, doc_id, patient_id, extraction, doc_best_date, logger
        )

    if patient_id and "encounters" in _scope:
        await extractor_writers.write_encounters(
            db,
            doc_id,
            patient_id,
            extraction,
            doctor_id,
            facility_id,
            doctor_data,
            event_date_val,
        )

    if patient_id and "medications" in _scope:
        await extractor_writers.write_medications(
            db, doc_id, patient_id, extraction, event_date_val
        )

    if patient_id and "vaccinations" in _scope:
        await extractor_writers.write_vaccinations(db, doc_id, patient_id, extraction)

    # Insert invoice line items (not gated on patient_id — invoices may not
    # have a patient). Skipped when ``invoice_items`` is outside the scope.
    cost_data = extraction.get("cost", {})
    if not isinstance(cost_data, dict):
        cost_data = {}
    if "invoice_items" not in _scope:
        cost_data = {}
    await extractor_writers.write_invoice_items(db, doc_id, patient_id, cost_data)

    await db.commit()
    return extraction
