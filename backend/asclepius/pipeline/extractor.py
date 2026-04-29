"""LLM-based data extraction orchestrator.

Phase 1 (classification + universal fields) and phase 2 (type-specific
structured arrays) both live here. DB-specific upsert/lookup helpers live
in :mod:`entity_matching` (patient / doctor / facility) and
:mod:`extractor_db` (normalized reference tables). Those modules are
re-exported below so the existing ``from asclepius.pipeline.extractor
import _upsert_doctor, _match_patient, …`` call sites keep working.
"""

import json
import logging
import re
from datetime import date

import aiosqlite

from asclepius.config import AppConfig
from asclepius.llm.base import LLMProvider
from asclepius.llm.prompts import canonical_language_directive as _canonical_language_directive

from .entity_matching import (
    _match_patient,
    _resolve_specialty_from_doctor,
    _upsert_doctor,
    _upsert_facility,
    normalize_name,
    strip_doctor_title,
)
from .extractor_db import (
    _resolve_diagnosis,
    _resolve_lab_test,
    _resolve_medication,
    _resolve_specialty_from_data,
)

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _coerce_iso_date(value) -> str | None:
    """Return ``value`` as an ISO ``YYYY-MM-DD`` string, or None if unparseable.

    The LLM occasionally emits placeholders like ``"unknown"``, ``"n/a"``, or
    a malformed date such as ``"2024-13-40"``. We accept only strict ISO so
    the document's ``event_date`` fallback can fire downstream.
    """
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    if not s or not _ISO_DATE_RE.match(s):
        return None
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


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


VALID_DOC_TYPES = {
    "invoice",
    "prescription",
    "specialist_report",
    "surgical_report",
    "discharge",
    "lab_test",
    "vaccination",
    "medical_certificate",
    "imaging_report",
    "other",
}

# Fuzzy mapping for common LLM mistakes and legacy values. Maps any
# old/aliased value to one of the canonical 10 codes in VALID_DOC_TYPES.
_DOC_TYPE_ALIASES = {
    # Lab tests
    "bloodtest": "lab_test",
    "blood test": "lab_test",
    "blood_test": "lab_test",
    "labtest_other": "lab_test",
    "lab": "lab_test",
    "laboratory": "lab_test",
    "labtest": "lab_test",
    # Specialist reports (catch-all for visits, consults, retired specialty types)
    "report": "specialist_report",
    "visit": "specialist_report",
    "consultation": "specialist_report",
    "checkup": "specialist_report",
    "follow-up": "specialist_report",
    "follow_up_report": "specialist_report",
    "specialist": "specialist_report",
    "visit_report": "specialist_report",
    "medical_report": "specialist_report",
    "clinical_report": "specialist_report",
    "referto": "specialist_report",
    "befund": "specialist_report",
    "visita": "specialist_report",
    "controllo": "specialist_report",
    "pathology": "specialist_report",
    "pathology_report": "specialist_report",
    "histology": "specialist_report",
    "er_report": "specialist_report",
    "emergency": "specialist_report",
    "er": "specialist_report",
    "physio_report": "specialist_report",
    "physiotherapy": "specialist_report",
    "dental": "specialist_report",
    "dentistry": "specialist_report",
    "ophthalmology": "specialist_report",
    "mental_health": "specialist_report",
    "psychiatry": "specialist_report",
    "psychology": "specialist_report",
    # Surgical
    "surgery": "surgical_report",
    "operation": "surgical_report",
    "operative_notes": "surgical_report",
    "op_bericht": "surgical_report",
    # Imaging (consolidated to imaging_report)
    "radiology": "imaging_report",
    "radiology_report": "imaging_report",
    "xray": "imaging_report",
    "x-ray": "imaging_report",
    "imaging_dicom": "imaging_report",
    "imaging_other": "imaging_report",
    "imaging": "imaging_report",
    # Invoices (incl. receipts)
    "bill": "invoice",
    "fattura": "invoice",
    "rechnung": "invoice",
    "billing": "invoice",
    "nota": "invoice",
    "conto": "invoice",
    "tarmed": "invoice",
    "honorarnote": "invoice",
    "receipt": "invoice",
    "receipt_payment": "invoice",
    "payment": "invoice",
    "ricevuta": "invoice",
    "quittung": "invoice",
    # Prescriptions (incl. referrals)
    "ricetta": "prescription",
    "rezept": "prescription",
    "referral": "prescription",
    "referral_letter": "prescription",
    "ueberweisung": "prescription",
    "uberweisung": "prescription",
    # Discharge
    "discharge_letter": "discharge",
    "discharge_summary": "discharge",
    # Vaccinations
    "vaccine": "vaccination",
    "immunization": "vaccination",
    "impfung": "vaccination",
    # Medical certificates (incl. sick leave)
    "medical_cert": "medical_certificate",
    "certificate": "medical_certificate",
    "sick_leave": "medical_certificate",
    "sick_note": "medical_certificate",
    "zeugnis": "medical_certificate",
    "arbeitsunfaehigkeit": "medical_certificate",
    # Catch-all for retired types
    "allergy": "other",
    "insurance_claim": "other",
    "insurance_doc": "other",
    "consent": "other",
    "advance_directive": "other",
    "correspondence": "other",
    "letter": "other",
}


def _normalize_doc_type(raw: str | None) -> str:
    """Normalize a doc_type from LLM output to a valid code."""
    if not raw:
        return "other"
    cleaned = raw.strip().lower().replace(" ", "_").replace("-", "_")
    if cleaned in VALID_DOC_TYPES:
        return cleaned
    if cleaned in _DOC_TYPE_ALIASES:
        return _DOC_TYPE_ALIASES[cleaned]
    # Partial match
    for alias, code in _DOC_TYPE_ALIASES.items():
        if alias in cleaned or cleaned in alias:
            return code
    logger.warning("Unknown doc_type '%s', defaulting to 'other'", raw)
    return "other"


def _salvage_classification(c: dict) -> None:
    """Try to map non-standard LLM keys to the expected classification schema.

    Small models (e.g. qwen2.5:7b) often ignore the requested JSON schema and
    return their own key names. This attempts to rescue useful data.
    """
    # Doctor name — LLM might use "responsible", "signing_doctor", "medico", etc.
    if not c.get("doctor") or (isinstance(c.get("doctor"), dict) and not c["doctor"].get("name")):
        for alt_key in ("responsible", "signing_doctor", "medico", "physician", "arzt"):
            val = c.get(alt_key)
            if val and isinstance(val, str):
                c["doctor"] = {"name": val}
                break
            elif val and isinstance(val, dict) and val.get("name"):
                c["doctor"] = val
                break

    # Facility — LLM might use "department", "hospital", "clinic", "struttura"
    if not c.get("facility") or (
        isinstance(c.get("facility"), dict) and not c["facility"].get("name")
    ):
        for alt_key in ("department", "hospital", "clinic", "struttura", "krankenhaus"):
            val = c.get(alt_key)
            if val and isinstance(val, str):
                c["facility"] = {"name": val.split("\n")[0].strip()}
                break
            elif val and isinstance(val, dict) and val.get("name"):
                c["facility"] = val
                break

    # Summary — LLM might use "conclusions", "summary", "riassunto", "zusammenfassung"
    if not c.get("summary_en"):
        for alt_key in ("conclusions", "summary", "riassunto", "zusammenfassung", "description"):
            val = c.get(alt_key)
            if val and isinstance(val, str):
                c["summary_en"] = val[:500]
                break
            elif val and isinstance(val, list):
                c["summary_en"] = "; ".join(str(x) for x in val[:5])[:500]
                break

    # Date — LLM might use "date", "visit_date", "data", "datum". We write
    # the salvaged value back into the legacy doc_date key; the caller
    # collapses doc_date/date_visit/date_issued/event_date into event_date
    # before the DB write.
    if not c.get("event_date") and not c.get("doc_date") and not c.get("date_visit"):
        for alt_key in ("date", "visit_date", "data", "datum", "consultation_date"):
            val = c.get(alt_key)
            if val and isinstance(val, str) and len(val) >= 8:
                c["doc_date"] = val
                break

    # Visit type → doc_type mapping
    if not c.get("doc_type"):
        visit_type = c.get("visit_type") or c.get("type") or c.get("document_type")
        if visit_type and isinstance(visit_type, str):
            c["doc_type"] = visit_type

    # Patient name
    if not c.get("patient_name"):
        patient = c.get("patient")
        if isinstance(patient, dict):
            c["patient_name"] = patient.get("name") or patient.get("full_name")
        elif isinstance(patient, str):
            c["patient_name"] = patient


# Aliases for extraction array keys. Small models (qwen2.5:14b and below)
# frequently drop the "lab_" / "-es" prefixes/suffixes from the requested
# schema. We remap anything list-shaped under a known alias into the
# canonical key, but only if the canonical key is absent or empty.
_ARRAY_KEY_ALIASES: dict[str, tuple[str, ...]] = {
    "lab_results": ("results", "tests", "lab_tests", "test_results", "labResults", "blood_tests"),
    "diagnoses": ("diagnosis", "diagnoses_list", "findings"),
    "medications": ("medication", "drugs", "prescriptions"),
    "vaccinations": ("vaccination", "vaccines", "immunizations"),
    "encounters": ("encounter", "visits"),
    "invoice_items": ("items", "line_items", "invoice_lines"),
}


def _salvage_array_keys(extraction: dict) -> None:
    """Remap common LLM key-naming drift back onto the canonical keys."""
    for canonical, aliases in _ARRAY_KEY_ALIASES.items():
        existing = extraction.get(canonical)
        if isinstance(existing, list) and existing:
            continue
        for alt in aliases:
            val = extraction.get(alt)
            if isinstance(val, list) and val:
                extraction[canonical] = val
                extraction.pop(alt, None)
                logger.info("Salvaged LLM key '%s' → '%s' (%d items)", alt, canonical, len(val))
                break


# Strings the LLM emits when it could not find a real value. We treat
# them as "no value" everywhere we read string fields, instead of letting
# them bleed into the DB and the UI as if they were real content.
_PLACEHOLDER_SENTINELS = {
    "",
    "*",
    "-",
    "—",
    "–",
    "_",
    ".",
    "..",
    "...",
    "n/a",
    "n/a.",
    "na",
    "n.a.",
    "n.a",
    "n/d",
    "nd",
    "null",
    "none",
    "nil",
    "nan",
    "*/*",
    "unknown",
    "unspecified",
    "not specified",
    "not available",
    "not provided",
    "not applicable",
    "no value",
    "missing",
    "illegible",
    "unreadable",
    "indecipherable",
    "(empty)",
    "(none)",
    "(null)",
    "(unknown)",
    "(blank)",
    "tbd",
    "to be determined",
}

# Backwards-compatible alias for the lab-only call sites that pre-dated
# the broader sanitization sweep.
_LAB_MISSING_SENTINELS = _PLACEHOLDER_SENTINELS


def _is_missing(val) -> bool:
    """True if the LLM emitted a placeholder meaning 'no value'."""
    if val is None:
        return True
    if isinstance(val, str):
        return val.strip().lower() in _PLACEHOLDER_SENTINELS
    return False


def _clean(val):
    """Normalize an LLM-extracted string field for DB insert.

    Returns ``None`` for ``None``, empty strings, and any of the
    ``_PLACEHOLDER_SENTINELS`` markers (case- and whitespace-insensitive).
    Otherwise returns the value with surrounding whitespace stripped.
    Non-string values pass through unchanged so numeric / boolean / date
    fields aren't mangled.
    """
    if val is None:
        return None
    if not isinstance(val, str):
        return val
    stripped = val.strip()
    if not stripped:
        return None
    if stripped.lower() in _PLACEHOLDER_SENTINELS:
        return None
    return stripped


def _parse_reference_range(raw: str) -> tuple[float | None, float | None]:
    """Parse strings like '[12 - 43]', '0.5–2.1', '< 5', '* - *' → (low, high).

    Returns (None, None) when neither bound is a real number.
    """
    if not isinstance(raw, str):
        return None, None
    s = raw.strip().strip("[]()").strip()
    if not s:
        return None, None
    # Normalize dash variants (en/em/minus) into ASCII "-"
    for ch in ("–", "—", "−"):
        s = s.replace(ch, "-")
    low_s, high_s = None, None
    if s.startswith("<"):
        high_s = s[1:].strip().lstrip("=").strip()
    elif s.startswith(">"):
        low_s = s[1:].strip().lstrip("=").strip()
    elif "-" in s:
        parts = s.split("-", 1)
        low_s, high_s = parts[0].strip(), parts[1].strip()

    def _coerce(x):
        if x is None or _is_missing(x):
            return None
        try:
            return float(x.replace(",", "."))
        except (ValueError, AttributeError):
            return None

    return _coerce(low_s), _coerce(high_s)


def _normalize_lab_row(lab: dict) -> None:
    """Make a single LLM-produced lab_results item match our schema.

    Small models drift on key names (``analysis`` instead of ``test_name_original``,
    ``result`` instead of ``value``) and embed abnormal markers like ``*`` into
    the unit field. Rewrite the row in place so the caller doesn't have to
    duplicate the logic.
    """
    # 1. Test name — support more aliases including 'analysis' / 'exam' / 'item'.
    if not lab.get("test_name_original"):
        for alt in (
            "test_name",
            "name",
            "test",
            "test_name_canonical",
            "analyte",
            "parameter",
            "analysis",
            "exam",
            "item",
            "label",
        ):
            v = lab.get(alt)
            if isinstance(v, str) and v.strip():
                lab["test_name_original"] = v.strip()
                break

    # 2. Value — 'result' / 'measurement' / 'observed_value' etc.
    if lab.get("value") is None and not lab.get("value_text"):
        raw_val = None
        for alt in ("result", "measurement", "observed_value", "observed", "reading", "quantity"):
            if alt in lab:
                raw_val = lab[alt]
                break
        if not _is_missing(raw_val):
            if isinstance(raw_val, (int, float)):
                lab["value"] = float(raw_val)
            elif isinstance(raw_val, str):
                s = raw_val.strip().replace(",", ".")
                try:
                    lab["value"] = float(s)
                except ValueError:
                    lab["value_text"] = raw_val.strip()

    # 3. Reference range — accept a single 'reference_range' string.
    if lab.get("reference_range_low") is None and lab.get("reference_range_high") is None:
        raw_range = lab.get("reference_range") or lab.get("range") or lab.get("ref_range")
        low, high = _parse_reference_range(raw_range) if raw_range else (None, None)
        if low is not None:
            lab["reference_range_low"] = low
        if high is not None:
            lab["reference_range_high"] = high

    # 4. Unit — some models prepend '*' as an abnormal marker (e.g. '* U/L').
    #    Strip it and treat it as an abnormal hint if is_abnormal wasn't set.
    unit = lab.get("unit")
    if isinstance(unit, str):
        stripped = unit.strip()
        if stripped.startswith("*"):
            lab["unit"] = stripped.lstrip("*").strip() or None
            if lab.get("is_abnormal") is None:
                lab["is_abnormal"] = True
        elif _is_missing(stripped):
            lab["unit"] = None


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

        # Phase 1: Classify (use custom prompt if configured)
        logger.info("Phase 1 — classifying doc %d", doc_id)
        from asclepius.llm.prompt_manager import get_prompt

        custom_classification = await get_prompt(config.database.path, "classification")
        if custom_classification and hasattr(llm, "_generate"):
            try:
                formatted = custom_classification.format(
                    patient_list=json.dumps(context.get("patient_list", []), indent=2),
                    facility_list=json.dumps(context.get("facility_list", []), indent=2),
                    doctor_list=json.dumps(context.get("doctor_list", []), indent=2),
                    ocr_text=ocr_text,
                    few_shot_examples=few_shot_str,
                )
                formatted = (
                    _canonical_language_directive(context.get("canonical_language", "English"))
                    + formatted
                )
                response_text = await llm._generate(formatted)
                classification = llm._parse_json(response_text)
                logger.info(
                    "Classification result for doc %d: doc_type=%s, summary=%s, event=%s, issued=%s, doctor=%s",
                    doc_id,
                    classification.get("doc_type"),
                    repr(classification.get("summary_en", ""))[:60],
                    classification.get("event_date")
                    or classification.get("date_visit")
                    or classification.get("date_issued")
                    or classification.get("doc_date"),
                    classification.get("issued_date") or classification.get("date_issued"),
                    classification.get("doctor", {}).get("name")
                    if isinstance(classification.get("doctor"), dict)
                    else classification.get("doctor"),
                )
            except Exception as e:
                logger.warning(
                    "Classification prompt failed for doc %d: %s, using default", doc_id, e
                )
                classification = await llm.classify(ocr_text, context)
        else:
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
) -> dict:
    """Run LLM extraction and write results to DB tables.

    If extraction_override is provided, skip the LLM call and use that data directly.
    """
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

    # Clear any prior child rows for this document so re-extraction overwrites
    # old data instead of appending duplicates. Both the full pipeline and the
    # reprocess path funnel through extract_and_store, so doing the cleanup
    # here makes every extraction idempotent.
    for _child in ("lab_results", "encounters", "medications", "vaccinations", "invoice_items"):
        await db.execute(f"DELETE FROM {_child} WHERE document_id = ?", (doc_id,))

    # Store raw extraction — use the provider label if available
    llm_label = getattr(llm, "provider_label", "") or "unknown"
    await db.execute(
        "UPDATE documents SET raw_extraction = ?, llm_provider = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (json.dumps(extraction), llm_label, doc_id),
    )

    # Get the document's patient_id
    cursor = await db.execute("SELECT patient_id FROM documents WHERE id = ?", (doc_id,))
    row = await cursor.fetchone()
    patient_id = row[0] if row else None

    if not patient_id:
        # Try to match patient from extraction — auto-assign
        patient_id = await _match_patient(db, extraction.get("patient_name"))
        if patient_id:
            await db.execute(
                "UPDATE documents SET patient_id = ? WHERE id = ?", (patient_id, doc_id)
            )

    # Update document metadata
    updates = {}
    if extraction.get("doc_type"):
        updates["doc_type"] = extraction["doc_type"]
    # Collapse the historic three-date LLM schema (date_visit > date_issued >
    # doc_date) into the canonical event_date. Prefer an explicit event_date
    # if the LLM already emitted one.
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
    # resolve_extraction() populates specialty["norm_specialty_id"] from the
    # original text; fall back to the legacy canonical-based resolver when
    # that wasn't run (error / override path).
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
    facility_id = None
    facility_data = extraction.get("facility", {})
    if facility_data.get("name"):
        facility_id = await _upsert_facility(db, facility_data)
        await db.execute(
            "UPDATE documents SET facility_id = ? WHERE id = ?",
            (facility_id, doc_id),
        )

    # Upsert doctor
    doctor_id = None
    doctor_data = extraction.get("doctor", {})
    if doctor_data.get("name"):
        doctor_id = await _upsert_doctor(db, doctor_data, facility_id)
        await db.execute(
            "UPDATE documents SET doctor_id = ? WHERE id = ?",
            (doctor_id, doc_id),
        )

    # Insert lab results
    if patient_id:
        # Default test_date for every lab row that doesn't carry its own.
        # Read back from the DB rather than the extraction dict so any dates
        # the user manually set pre-extraction are respected.
        cursor = await db.execute(
            "SELECT event_date FROM documents WHERE id = ?",
            (doc_id,),
        )
        drow = await cursor.fetchone()
        doc_best_date = drow[0] if drow else None

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
            norm_spec_id = encounter.get("norm_specialty_id") or doctor_data.get(
                "norm_specialty_id"
            )
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

    # Insert invoice line items (not gated on patient_id — invoices may not have a patient)
    cost_data = extraction.get("cost", {})
    if not isinstance(cost_data, dict):
        cost_data = {}
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

    await db.commit()
    return extraction
