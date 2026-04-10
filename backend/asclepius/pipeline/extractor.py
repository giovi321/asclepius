"""LLM-based data extraction and DB insertion."""

import json
import logging

import aiosqlite

from asclepius.config import AppConfig
from asclepius.llm.base import LLMProvider

logger = logging.getLogger(__name__)


async def build_extraction_context(db: aiosqlite.Connection) -> dict:
    """Build context dict for LLM extraction prompt."""
    # Get known patients
    cursor = await db.execute("SELECT id, slug, display_name FROM patients")
    patients = [{"id": r[0], "slug": r[1], "name": r[2]} for r in await cursor.fetchall()]

    # Get known facilities
    cursor = await db.execute("SELECT id, slug, name FROM facilities")
    facilities = [{"id": r[0], "slug": r[1], "name": r[2]} for r in await cursor.fetchall()]

    # Get known doctors
    cursor = await db.execute("SELECT id, slug, name FROM doctors")
    doctors = [{"id": r[0], "slug": r[1], "name": r[2]} for r in await cursor.fetchall()]

    # Get lab test mappings
    cursor = await db.execute(
        """SELECT nlt.canonical_code, nlta.alias
           FROM norm_lab_tests nlt
           JOIN norm_lab_test_aliases nlta ON nlta.norm_lab_test_id = nlt.id"""
    )
    lab_mappings = [{"canonical_code": r[0], "alias": r[1]} for r in await cursor.fetchall()]

    # Get specialty mappings
    cursor = await db.execute(
        """SELECT ns.canonical_code, nsa.alias
           FROM norm_specialties ns
           JOIN norm_specialty_aliases nsa ON nsa.norm_specialty_id = ns.id"""
    )
    specialty_mappings = [{"canonical_code": r[0], "alias": r[1]} for r in await cursor.fetchall()]

    # Get diagnosis mappings
    cursor = await db.execute(
        """SELECT nd.canonical_code, nda.alias
           FROM norm_diagnoses nd
           JOIN norm_diagnosis_aliases nda ON nda.norm_diagnosis_id = nd.id"""
    )
    diagnosis_mappings = [{"canonical_code": r[0], "alias": r[1]} for r in await cursor.fetchall()]

    # Get medication mappings
    cursor = await db.execute(
        """SELECT nm.canonical_code, nma.alias
           FROM norm_medications nm
           JOIN norm_medication_aliases nma ON nma.norm_medication_id = nm.id"""
    )
    medication_mappings = [{"canonical_code": r[0], "alias": r[1]} for r in await cursor.fetchall()]

    return {
        "patient_list": patients,
        "facility_list": facilities,
        "doctor_list": doctors,
        "lab_test_mappings": lab_mappings,
        "specialty_mappings": specialty_mappings,
        "diagnosis_mappings": diagnosis_mappings,
        "medication_mappings": medication_mappings,
    }


async def _extract_type_specific(llm: LLMProvider, ocr_text: str, doc_type: str, context: dict) -> dict:
    """Call the type-specific extraction prompt for phase 2."""
    from asclepius.llm.prompts import TYPE_EXTRACTION_PROMPTS

    prompt_template = TYPE_EXTRACTION_PROMPTS.get(doc_type)
    if not prompt_template:
        # No type-specific prompt for this doc_type — return empty
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

    # Use the LLM's internal generate + parse (works for both Ollama and Claude)
    if hasattr(llm, "_generate"):
        response_text = await llm._generate(prompt)
        return llm._parse_json(response_text)
    else:
        # Fallback: use extract with the formatted prompt as ocr_text
        # This shouldn't normally happen since both providers have _generate
        return {}


VALID_DOC_TYPES = {
    "bloodtest", "labtest_other", "prescription", "invoice", "receipt",
    "insurance_claim", "insurance_doc", "referral", "discharge",
    "specialist_report", "radiology_report", "pathology_report",
    "surgical_report", "er_report", "vaccination", "allergy", "sick_leave",
    "medical_cert", "physio_report", "dental", "ophthalmology",
    "mental_health", "consent", "advance_directive", "imaging_dicom",
    "imaging_other", "correspondence", "other",
}

# Fuzzy mapping for common LLM mistakes
_DOC_TYPE_ALIASES = {
    "blood test": "bloodtest", "blood_test": "bloodtest", "lab": "bloodtest",
    "lab test": "bloodtest", "lab_test": "bloodtest", "laboratory": "bloodtest",
    "report": "specialist_report", "visit": "specialist_report",
    "consultation": "specialist_report", "checkup": "specialist_report",
    "follow-up": "specialist_report", "follow_up_report": "specialist_report",
    "specialist": "specialist_report", "visit_report": "specialist_report",
    "medical_report": "specialist_report", "clinical_report": "specialist_report",
    "bill": "invoice", "fattura": "invoice", "rechnung": "invoice",
    "receipt_payment": "receipt", "payment": "receipt",
    "discharge_letter": "discharge", "discharge_summary": "discharge",
    "radiology": "radiology_report", "xray": "radiology_report",
    "x-ray": "radiology_report", "imaging_report": "radiology_report",
    "pathology": "pathology_report", "histology": "pathology_report",
    "surgery": "surgical_report", "operation": "surgical_report",
    "emergency": "er_report", "er": "er_report",
    "vaccine": "vaccination", "immunization": "vaccination",
    "referral_letter": "referral", "letter": "correspondence",
    "sick_note": "sick_leave", "certificate": "medical_cert",
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
        # Phase 1: Classify
        logger.info("Phase 1 — classifying doc %d", doc_id)
        classification = await llm.classify(ocr_text, context)

        if "error" in classification:
            logger.error("Classification failed for doc %d: %s", doc_id, classification.get("error"))
            await db.execute(
                "UPDATE documents SET status = 'failed', raw_extraction = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (json.dumps(classification), doc_id),
            )
            await db.commit()
            return classification

        # Normalize doc_type to valid code
        doc_type = _normalize_doc_type(classification.get("doc_type", "other"))
        classification["doc_type"] = doc_type

        # Phase 2: Type-specific extraction
        logger.info("Phase 2 — extracting type-specific data for doc %d (type=%s)", doc_id, doc_type)
        type_extraction = await _extract_type_specific(llm, ocr_text, doc_type, context)

        # Merge: classification provides the base, type-specific adds structured arrays
        extraction = {**classification, **type_extraction}

    # Delegate to extract_and_store for DB writes
    return await extract_and_store(db, llm, doc_id, ocr_text, config, extraction_override=extraction)


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

    if "error" in extraction:
        logger.error("LLM extraction failed for doc %d: %s", doc_id, extraction.get("error"))
        await db.execute(
            "UPDATE documents SET status = 'failed', raw_extraction = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (json.dumps(extraction), doc_id),
        )
        await db.commit()
        return extraction

    # Store raw extraction
    await db.execute(
        "UPDATE documents SET raw_extraction = ?, llm_provider = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (json.dumps(extraction), config.llm.provider, doc_id),
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
    if extraction.get("doc_date"):
        updates["doc_date"] = extraction["doc_date"]
    if extraction.get("date_issued"):
        updates["date_issued"] = extraction["date_issued"]
    if extraction.get("date_visit"):
        updates["date_visit"] = extraction["date_visit"]
    if extraction.get("language_detected"):
        updates["language_source"] = extraction["language_detected"]
    if extraction.get("summary_en"):
        updates["summary_en"] = extraction["summary_en"]
    if extraction.get("summary_original"):
        updates["summary_original"] = extraction["summary_original"]
    cost_data = extraction.get("cost", {})
    if cost_data.get("total_amount"):
        updates["cost_amount"] = cost_data["total_amount"]
        updates["cost_currency"] = cost_data.get("currency")
    elif cost_data.get("amount"):
        updates["cost_amount"] = cost_data["amount"]
        updates["cost_currency"] = cost_data.get("currency")

    # Insurance info from extraction
    insurance = extraction.get("insurance", {})
    if insurance.get("company"):
        updates["insurance_company"] = insurance["company"]
    if insurance.get("policy_number"):
        updates["insurance_policy"] = insurance["policy_number"]

    # Specialty info on the document itself
    specialty_data = extraction.get("specialty", {})
    if specialty_data.get("original"):
        updates["specialty_original"] = specialty_data["original"]
    if specialty_data.get("canonical"):
        norm_spec_id = await _resolve_specialty_from_data(db, specialty_data)
        if norm_spec_id:
            updates["norm_specialty_id"] = norm_spec_id

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [doc_id]
        await db.execute(f"UPDATE documents SET {set_clause} WHERE id = ?", values)

    # Upsert facility
    facility_id = None
    facility_data = extraction.get("facility", {})
    if facility_data.get("name"):
        facility_id = await _upsert_facility(db, facility_data)
        facility_name_text = normalize_name(facility_data["name"])
        await db.execute(
            "UPDATE documents SET facility_id = ?, facility_name = ? WHERE id = ?",
            (facility_id, facility_name_text, doc_id),
        )

    # Upsert doctor
    doctor_id = None
    doctor_data = extraction.get("doctor", {})
    if doctor_data.get("name"):
        doctor_id = await _upsert_doctor(db, doctor_data, facility_id)
        doctor_name_text = normalize_name(doctor_data["name"])
        await db.execute(
            "UPDATE documents SET doctor_id = ?, doctor_name = ? WHERE id = ?",
            (doctor_id, doctor_name_text, doc_id),
        )

    # Insert lab results
    if patient_id:
        for lab in extraction.get("lab_results", []):
            norm_id = await _resolve_lab_test(db, lab)
            await db.execute(
                """INSERT INTO lab_results
                   (document_id, patient_id, test_name_original, norm_lab_test_id,
                    value, value_text, unit, reference_range_low, reference_range_high,
                    is_abnormal, sample_type, panel_name, test_date)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, patient_id, lab.get("test_name_original"),
                 norm_id, lab.get("value"), lab.get("value_text"),
                 lab.get("unit"), lab.get("reference_range_low"),
                 lab.get("reference_range_high"), lab.get("is_abnormal"),
                 lab.get("sample_type"), lab.get("panel_name"),
                 extraction.get("doc_date")),
            )

        # Insert encounters/diagnoses
        encounter = extraction.get("encounter", {})
        for diag in extraction.get("diagnoses", []):
            norm_diag_id = await _resolve_diagnosis(db, diag)
            norm_spec_id = None
            if doctor_data.get("specialty_canonical"):
                norm_spec_id = await _resolve_specialty_from_doctor(db, doctor_data)

            await db.execute(
                """INSERT INTO encounters
                   (document_id, patient_id, doctor_id, facility_id, encounter_date,
                    admission_date, discharge_date, norm_diagnosis_id,
                    diagnosis_original, diagnosis_code, norm_specialty_id,
                    notes, findings, follow_up_date, follow_up_instructions)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, patient_id, doctor_id, facility_id,
                 encounter.get("encounter_date") or extraction.get("doc_date"),
                 encounter.get("admission_date"), encounter.get("discharge_date"),
                 norm_diag_id, diag.get("diagnosis_original"),
                 diag.get("icd10_code"), norm_spec_id,
                 extraction.get("summary_en"),
                 encounter.get("findings"),
                 encounter.get("follow_up_date"),
                 encounter.get("follow_up_instructions")),
            )

        # If no diagnoses but encounter data exists, still create encounter
        if not extraction.get("diagnoses") and encounter.get("encounter_date"):
            await db.execute(
                """INSERT INTO encounters
                   (document_id, patient_id, doctor_id, facility_id, encounter_date,
                    notes, findings, follow_up_date, follow_up_instructions)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, patient_id, doctor_id, facility_id,
                 encounter.get("encounter_date"),
                 extraction.get("summary_en"),
                 encounter.get("findings"),
                 encounter.get("follow_up_date"),
                 encounter.get("follow_up_instructions")),
            )

        # Insert medications
        for med in extraction.get("medications", []):
            norm_med_id = await _resolve_medication(db, med)
            await db.execute(
                """INSERT INTO medications
                   (document_id, patient_id, norm_medication_id, brand_name,
                    active_ingredient_original, dosage, form, frequency,
                    duration, quantity, prescribed_date)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, patient_id, norm_med_id, med.get("brand_name"),
                 med.get("active_ingredient_original"), med.get("dosage"),
                 med.get("form"), med.get("frequency"),
                 med.get("duration"), med.get("quantity"),
                 extraction.get("doc_date")),
            )

        # Insert vaccinations
        for vax in extraction.get("vaccinations", []):
            await db.execute(
                """INSERT INTO vaccinations
                   (document_id, patient_id, vaccine_name, manufacturer,
                    lot_number, dose_number, date_administered)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, patient_id, vax.get("vaccine_name"),
                 vax.get("manufacturer"), vax.get("lot_number"),
                 vax.get("dose_number"), vax.get("date_administered")),
            )

    # Insert invoice line items (not gated on patient_id — invoices may not have a patient)
    cost_data = extraction.get("cost", {})
    for item in cost_data.get("line_items", []):
        if not item.get("description"):
            continue
        await db.execute(
            """INSERT INTO invoice_items
               (document_id, patient_id, description, quantity, unit_price,
                amount, currency, tariff_code, tax_rate, category)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (doc_id, patient_id, item["description"],
             item.get("quantity", 1), item.get("unit_price"),
             item.get("amount"), cost_data.get("currency", "CHF"),
             item.get("tariff_code"), cost_data.get("tax_rate"),
             item.get("category")),
        )

    await db.commit()
    return extraction


def normalize_name(name: str) -> str:
    """Normalize doctor/facility name capitalization.

    - Title-cases the name
    - Handles common prefixes: "Dr.", "Prof.", "Dr. med."
    - Handles particles: "von", "della", "de" stay lowercase
    - Example: "GIOVANNI CRAPELLI" -> "Giovanni Crapelli"
    - Example: "dr. hans müller" -> "Dr. Hans Müller"
    - Example: "prof. dr. med. anna von berg" -> "Prof. Dr. med. Anna von Berg"
    """
    if not name:
        return name

    # Particles that should stay lowercase (when not at start)
    particles = {"von", "della", "del", "de", "di", "van", "den", "der", "la", "le", "da"}
    # Prefixes that have specific capitalization
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

    # Simple fuzzy match: try exact, then LIKE
    cursor = await db.execute(
        "SELECT id FROM patients WHERE display_name = ? COLLATE NOCASE",
        (name,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    # Try partial match
    cursor = await db.execute(
        "SELECT id FROM patients WHERE display_name LIKE ? COLLATE NOCASE",
        (f"%{name}%",),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    # Try matching parts of the name
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


async def _upsert_facility(db: aiosqlite.Connection, facility_data: dict) -> int:
    """Insert or get existing facility."""
    from asclepius.patients.service import slugify

    name = normalize_name(facility_data["name"])
    slug = slugify(name)

    cursor = await db.execute("SELECT id FROM facilities WHERE slug = ?", (slug,))
    row = await cursor.fetchone()
    if row:
        return row[0]

    cursor = await db.execute(
        """INSERT INTO facilities (name, slug, type, address, city, country, phone)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (name, slug,
         facility_data.get("type"),
         facility_data.get("address"),
         facility_data.get("city"),
         facility_data.get("country"),
         facility_data.get("phone")),
    )
    return cursor.lastrowid


async def _upsert_doctor(db: aiosqlite.Connection, doctor_data: dict, facility_id: int | None = None) -> int:
    """Insert or get existing doctor."""
    from asclepius.patients.service import slugify

    name = normalize_name(doctor_data["name"])
    slug = slugify(name)

    cursor = await db.execute("SELECT id FROM doctors WHERE slug = ?", (slug,))
    row = await cursor.fetchone()
    if row:
        return row[0]

    # Resolve specialty for the doctor
    norm_spec_id = None
    if doctor_data.get("specialty_canonical"):
        norm_spec_id = await _resolve_specialty_from_doctor(db, doctor_data)

    cursor = await db.execute(
        """INSERT INTO doctors (name, slug, title, norm_specialty_id, specialty_original, facility_id)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (name, slug,
         doctor_data.get("title"),
         norm_spec_id,
         doctor_data.get("specialty_original"),
         facility_id),
    )
    return cursor.lastrowid


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


async def _resolve_specialty_from_data(db: aiosqlite.Connection, specialty_data: dict) -> int | None:
    """Resolve specialty to norm_specialties ID from specialty extraction data."""
    canonical = specialty_data.get("canonical", "")

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
    canonical = lab.get("test_name_canonical", "")
    original = lab.get("test_name_original", "")
    mapped = lab.get("test_mapped", False)

    if mapped and canonical:
        cursor = await db.execute(
            "SELECT id FROM norm_lab_tests WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    # Try alias lookup
    cursor = await db.execute(
        "SELECT norm_lab_test_id FROM norm_lab_test_aliases WHERE alias = ? COLLATE NOCASE",
        (original,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    # Create new entry if canonical provided
    if canonical:
        display = canonical.replace("_", " ").title()
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
        else:
            cursor = await db.execute(
                "SELECT id FROM norm_lab_tests WHERE canonical_code = ?", (canonical,)
            )
            row = await cursor.fetchone()
            return row[0] if row else None

    return None


async def _resolve_diagnosis(db: aiosqlite.Connection, diag: dict) -> int | None:
    """Resolve diagnosis to norm_diagnoses ID."""
    canonical = diag.get("diagnosis_canonical", "")
    original = diag.get("diagnosis_original", "")

    if canonical:
        cursor = await db.execute(
            "SELECT id FROM norm_diagnoses WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    # Try alias
    cursor = await db.execute(
        "SELECT norm_diagnosis_id FROM norm_diagnosis_aliases WHERE alias = ? COLLATE NOCASE",
        (original,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    if canonical:
        display = canonical.replace("_", " ").title()
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
    canonical = med.get("active_ingredient_canonical", "")
    original = med.get("active_ingredient_original", "")

    if canonical:
        cursor = await db.execute(
            "SELECT id FROM norm_medications WHERE canonical_code = ?", (canonical,)
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

    # Try alias
    cursor = await db.execute(
        "SELECT norm_medication_id FROM norm_medication_aliases WHERE alias = ? COLLATE NOCASE",
        (original,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]

    if canonical:
        display = canonical.replace("_", " ").title()
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
