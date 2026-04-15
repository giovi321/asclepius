"""LLM prompt templates for document extraction and chat."""

# ---------------------------------------------------------------------------
# Phase 1: Classification prompt (same for ALL document types)
# ---------------------------------------------------------------------------

CLASSIFICATION_PROMPT = """You are a medical document classifier. Read the document below, then fill in the JSON schema that follows.

Known patients: {patient_list}
Known facilities: {facility_list}
Known doctors: {doctor_list}

The OCR text may be plain text, Markdown, or HTML with data-bbox/data-label attributes (from Chandra OCR).
In HTML format: data-label="Page-Header" = letterhead (facility, NOT the patient), "Page-Footer" = ignore,
"Text" = content. The PATIENT name is usually top-right. The SIGNING DOCTOR is near the bottom with "Dott."/"Dr."
"Responsabile" in headers = department head, NOT the treating doctor.

--- DOCUMENT START ---
{ocr_text}
--- DOCUMENT END ---

Now classify the document above. Use these rules:
- "FATTURA"/"Rechnung"/"Invoice"/"TARMED" with prices → "invoice"
- "RICEVUTA"/"Quittung"/"Receipt" → "receipt"
- "RICETTA"/"Rezept"/"Prescription" → "prescription"
- "REFERTO"/"Befund"/"Report"/"visita"/"controllo" → "specialist_report"
- "DIMISSIONE"/"Austritt"/"Discharge" → "discharge"
- "ANALISI"/"Blutbild"/"lab"/"emocromo" with numeric values → "bloodtest"
- "RADIOLOGIA"/"Röntgen"/"X-ray"/"CT"/"MRI" → "radiology_report"
- "VACCINAZIONE"/"Impfung"/"Vaccination" → "vaccination"
- When in doubt, use "specialist_report" rather than "other"

The DOCTOR is whoever SIGNED the document or performed the exam (bottom of page), not department heads in letterheads.

IMPORTANT: You MUST respond with ONLY this exact JSON structure. Do not add extra keys. Do not use markdown.

{{
  "patient_name": "string or null",
  "doc_type": "invoice|receipt|prescription|specialist_report|discharge|bloodtest|labtest_other|radiology_report|pathology_report|surgical_report|er_report|vaccination|referral|allergy|sick_leave|medical_cert|physio_report|dental|ophthalmology|mental_health|insurance_claim|insurance_doc|consent|advance_directive|correspondence|other",
  "doc_date": "YYYY-MM-DD or null",
  "date_issued": "YYYY-MM-DD or null",
  "date_visit": "YYYY-MM-DD or null",
  "language_detected": "ISO 639-1 code",
  "doctor": {{ "name": "string or null", "title": "string or null", "specialty_original": "string or null", "specialty_canonical": "string or null", "specialty_mapped": false }},
  "facility": {{ "name": "string or null", "type": "hospital|clinic|lab|pharmacy|imaging_center|other|null", "address": "string or null", "city": "string or null", "country": "string or null", "phone": "string or null" }},
  "specialty": {{ "original": "string or null", "canonical": "string or null", "mapped": false }},
  "insurance": {{ "company": "string or null", "policy_number": "string or null" }},
  "summary_en": "1-3 sentence English summary of the document",
  "summary_original": "1-3 sentence summary in the document's source language"
}}"""


# ---------------------------------------------------------------------------
# Phase 2: Type-specific extraction prompts
# ---------------------------------------------------------------------------

TYPE_EXTRACTION_PROMPTS = {
    # --- Lab tests ---
    "bloodtest": """You are a medical lab result parser. Extract ONLY the lab test results from this document.

Known lab test mappings: {lab_test_mappings}

When a test name matches an existing mapping, use the canonical_code. If no mapping exists,
provide your best English canonical name and set "test_mapped": false.

Respond in JSON only. No markdown.

{{
  "lab_results": [
    {{
      "test_name_original": "name as written in document",
      "test_name_canonical": "canonical code (e.g. LOINC short name) or best English name",
      "test_mapped": true,
      "value": null,
      "value_text": "string for non-numeric (e.g. 'positive', 'reactive')",
      "unit": "string",
      "reference_range_low": null,
      "reference_range_high": null,
      "is_abnormal": false,
      "sample_type": "blood|urine|stool|saliva|csf|other|null",
      "panel_name": "string or null (e.g. 'CBC', 'lipid panel')"
    }}
  ]
}}

OCR text:
---
{ocr_text}
---""",

    "labtest_other": """You are a medical lab result parser. Extract ONLY the lab test results from this document.

Known lab test mappings: {lab_test_mappings}

When a test name matches an existing mapping, use the canonical_code. If no mapping exists,
provide your best English canonical name and set "test_mapped": false.

Respond in JSON only. No markdown.

{{
  "lab_results": [
    {{
      "test_name_original": "name as written in document",
      "test_name_canonical": "canonical code or best English name",
      "test_mapped": true,
      "value": null,
      "value_text": "string for non-numeric",
      "unit": "string",
      "reference_range_low": null,
      "reference_range_high": null,
      "is_abnormal": false,
      "sample_type": "blood|urine|stool|saliva|csf|other|null",
      "panel_name": "string or null"
    }}
  ]
}}

OCR text:
---
{ocr_text}
---""",

    # --- Clinical reports ---
    "specialist_report": """You are a medical report parser. Extract diagnoses, encounter details, and medications from this specialist report.

Known diagnosis mappings: {diagnosis_mappings}
Known medication mappings: {medication_mappings}
Known specialty mappings: {specialty_mappings}

Use canonical_code from mappings when available. Set "mapped": false for new terms.

Respond in JSON only. No markdown.

{{
  "diagnoses": [
    {{
      "diagnosis_original": "text as written",
      "diagnosis_canonical": "canonical code or best English name",
      "diagnosis_mapped": true,
      "icd10_code": "ICD-10 code or null"
    }}
  ],
  "medications": [
    {{
      "brand_name": "string or null",
      "active_ingredient_original": "as written",
      "active_ingredient_canonical": "INN name or best English name",
      "medication_mapped": true,
      "dosage": "string (e.g. '500mg')",
      "form": "tablet|capsule|cream|injection|syrup|drops|inhaler|patch|suppository|other|null",
      "frequency": "string (e.g. '2x daily')",
      "duration": "string or null",
      "quantity": "string or null"
    }}
  ],
  "encounter": {{
    "encounter_date": "YYYY-MM-DD or null",
    "findings": "string or null",
    "follow_up_date": "YYYY-MM-DD or null",
    "follow_up_instructions": "string or null"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    "discharge": """You are a medical report parser. Extract diagnoses, encounter details, medications, and follow-up info from this discharge letter.

Known diagnosis mappings: {diagnosis_mappings}
Known medication mappings: {medication_mappings}
Known specialty mappings: {specialty_mappings}

Use canonical_code from mappings when available. Set "mapped": false for new terms.

Respond in JSON only. No markdown.

{{
  "diagnoses": [
    {{
      "diagnosis_original": "text as written",
      "diagnosis_canonical": "canonical code or best English name",
      "diagnosis_mapped": true,
      "icd10_code": "ICD-10 code or null"
    }}
  ],
  "medications": [
    {{
      "brand_name": "string or null",
      "active_ingredient_original": "as written",
      "active_ingredient_canonical": "INN name or best English name",
      "medication_mapped": true,
      "dosage": "string",
      "form": "tablet|capsule|cream|injection|syrup|drops|inhaler|patch|suppository|other|null",
      "frequency": "string",
      "duration": "string or null",
      "quantity": "string or null"
    }}
  ],
  "encounter": {{
    "encounter_date": "YYYY-MM-DD or null",
    "admission_date": "YYYY-MM-DD or null",
    "discharge_date": "YYYY-MM-DD or null",
    "findings": "string or null",
    "follow_up_date": "YYYY-MM-DD or null",
    "follow_up_instructions": "string or null"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    "radiology_report": """You are a radiology report parser. Extract encounter details with imaging findings.

Known diagnosis mappings: {diagnosis_mappings}

Respond in JSON only. No markdown.

{{
  "diagnoses": [
    {{
      "diagnosis_original": "text as written",
      "diagnosis_canonical": "canonical code or best English name",
      "diagnosis_mapped": true,
      "icd10_code": "ICD-10 code or null"
    }}
  ],
  "encounter": {{
    "encounter_date": "YYYY-MM-DD or null",
    "findings": "string — the full radiology findings text",
    "follow_up_date": "YYYY-MM-DD or null",
    "follow_up_instructions": "string or null"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    "pathology_report": """You are a pathology report parser. Extract encounter details with pathology findings.

Known diagnosis mappings: {diagnosis_mappings}

Respond in JSON only. No markdown.

{{
  "diagnoses": [
    {{
      "diagnosis_original": "text as written",
      "diagnosis_canonical": "canonical code or best English name",
      "diagnosis_mapped": true,
      "icd10_code": "ICD-10 code or null"
    }}
  ],
  "encounter": {{
    "encounter_date": "YYYY-MM-DD or null",
    "findings": "string — the full pathology findings text",
    "follow_up_date": "YYYY-MM-DD or null",
    "follow_up_instructions": "string or null"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    "surgical_report": """You are a surgical report parser. Extract encounter details with operative findings.

Known diagnosis mappings: {diagnosis_mappings}
Known medication mappings: {medication_mappings}

Respond in JSON only. No markdown.

{{
  "diagnoses": [
    {{
      "diagnosis_original": "text as written",
      "diagnosis_canonical": "canonical code or best English name",
      "diagnosis_mapped": true,
      "icd10_code": "ICD-10 code or null"
    }}
  ],
  "medications": [
    {{
      "brand_name": "string or null",
      "active_ingredient_original": "as written",
      "active_ingredient_canonical": "INN name or best English name",
      "medication_mapped": true,
      "dosage": "string",
      "form": "tablet|capsule|cream|injection|syrup|drops|inhaler|patch|suppository|other|null",
      "frequency": "string",
      "duration": "string or null",
      "quantity": "string or null"
    }}
  ],
  "encounter": {{
    "encounter_date": "YYYY-MM-DD or null",
    "admission_date": "YYYY-MM-DD or null",
    "discharge_date": "YYYY-MM-DD or null",
    "findings": "string — the operative findings",
    "follow_up_date": "YYYY-MM-DD or null",
    "follow_up_instructions": "string or null"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    "er_report": """You are an emergency report parser. Extract encounter details, diagnoses, and medications.

Known diagnosis mappings: {diagnosis_mappings}
Known medication mappings: {medication_mappings}

Respond in JSON only. No markdown.

{{
  "diagnoses": [
    {{
      "diagnosis_original": "text as written",
      "diagnosis_canonical": "canonical code or best English name",
      "diagnosis_mapped": true,
      "icd10_code": "ICD-10 code or null"
    }}
  ],
  "medications": [
    {{
      "brand_name": "string or null",
      "active_ingredient_original": "as written",
      "active_ingredient_canonical": "INN name or best English name",
      "medication_mapped": true,
      "dosage": "string",
      "form": "tablet|capsule|cream|injection|syrup|drops|inhaler|patch|suppository|other|null",
      "frequency": "string",
      "duration": "string or null",
      "quantity": "string or null"
    }}
  ],
  "encounter": {{
    "encounter_date": "YYYY-MM-DD or null",
    "admission_date": "YYYY-MM-DD or null",
    "discharge_date": "YYYY-MM-DD or null",
    "findings": "string or null",
    "follow_up_date": "YYYY-MM-DD or null",
    "follow_up_instructions": "string or null"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    # --- Medications ---
    "prescription": """You are a prescription parser. Extract ONLY the prescribed medications.

Known medication mappings: {medication_mappings}

Use canonical_code from mappings when available. Set "medication_mapped": false for new terms.

Respond in JSON only. No markdown.

{{
  "medications": [
    {{
      "brand_name": "string or null",
      "active_ingredient_original": "as written",
      "active_ingredient_canonical": "INN name or best English name",
      "medication_mapped": true,
      "dosage": "string (e.g. '500mg')",
      "form": "tablet|capsule|cream|injection|syrup|drops|inhaler|patch|suppository|other|null",
      "frequency": "string (e.g. '2x daily')",
      "duration": "string or null",
      "quantity": "string or null"
    }}
  ]
}}

OCR text:
---
{ocr_text}
---""",

    # --- Financial ---
    "invoice": """You are a medical invoice parser. Extract cost information with all line items.

Respond in JSON only. No markdown.

{{
  "cost": {{
    "total_amount": null,
    "currency": "ISO 4217 code",
    "subtotal": null,
    "tax_amount": null,
    "tax_rate": null,
    "line_items": [
      {{
        "description": "string",
        "quantity": 1,
        "unit_price": null,
        "amount": 0,
        "tariff_code": "string or null",
        "category": "consultation|procedure|medication|lab|imaging|admin|other"
      }}
    ]
  }},
  "insurance": {{
    "company": "string or null",
    "policy_number": "string or null",
    "claim_status": "approved|partially_approved|denied|pending|null"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    "receipt": """You are a medical receipt parser. Extract cost totals.

Respond in JSON only. No markdown.

{{
  "cost": {{
    "total_amount": null,
    "currency": "ISO 4217 code"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    "insurance_claim": """You are an insurance claim parser. Extract cost and insurance details.

Respond in JSON only. No markdown.

{{
  "cost": {{
    "total_amount": null,
    "currency": "ISO 4217 code",
    "subtotal": null,
    "tax_amount": null,
    "tax_rate": null,
    "line_items": [
      {{
        "description": "string",
        "quantity": 1,
        "unit_price": null,
        "amount": 0,
        "tariff_code": "string or null",
        "category": "consultation|procedure|medication|lab|imaging|admin|other"
      }}
    ]
  }},
  "insurance": {{
    "company": "string or null",
    "policy_number": "string or null",
    "claim_status": "approved|partially_approved|denied|pending|null"
  }}
}}

OCR text:
---
{ocr_text}
---""",

    # --- Vaccinations ---
    "vaccination": """You are a vaccination record parser. Extract ONLY vaccination details.

Respond in JSON only. No markdown.

{{
  "vaccinations": [
    {{
      "vaccine_name": "string",
      "manufacturer": "string or null",
      "lot_number": "string or null",
      "dose_number": null,
      "date_administered": "YYYY-MM-DD or null"
    }}
  ]
}}

OCR text:
---
{ocr_text}
---""",
}


# ---------------------------------------------------------------------------
# Legacy monolithic prompt (kept for fallback / backward compat)
# ---------------------------------------------------------------------------

EXTRACTION_PROMPT_LEGACY = """You are a medical document parser. Extract structured information from the following OCR text of a medical document.

CRITICAL RULES:

1. PATIENT IDENTIFICATION:
   - The PATIENT is the person RECEIVING medical care, NOT the doctor/provider/sender.
   - On invoices/bills: the patient is the person being BILLED (often labeled "Patient", "Paziente", "Assicurato", "Versicherter"). The sender/header is the FACILITY, not the patient.
   - On reports: the patient name is usually near "Patient:", "Paziente:", "Name:", etc.
   - If known patients are listed below, MATCH against them. Use the known patient name if it appears anywhere in the document.
   - NEVER confuse the doctor's name, clinic name, or letterhead with the patient name.

2. DOCUMENT CLASSIFICATION (doc_type):
   - "specialist_report" = any visit report, consultation, checkup, follow-up, "visita di controllo", "referto", "Befund". This is the MOST COMMON type.
   - "bloodtest" = ONLY if the document contains a table/list of lab test values with numbers and units
   - "prescription" = ONLY if the document is a prescription/recipe for medications ("ricetta", "Rezept")
   - "invoice" = ONLY if the document contains prices, amounts, payment details, billing codes, TARMED, tariff points
   - "receipt" = payment confirmation, "Quittung", "ricevuta"
   - "discharge" = hospital discharge letter ("lettera di dimissione", "Austrittsbrief")
   - "radiology_report" = radiology/imaging report with findings from X-ray, CT, MRI, ultrasound
   - "referral" = a letter referring the patient to another doctor/specialist
   - Look for the document TITLE or HEADING first — it usually tells you the type directly.
   - When in doubt, use "specialist_report" rather than "prescription" or "other".

3. INVOICES/BILLS:
   - The "doctor" field should be the treating doctor if mentioned, or null if not applicable.
   - The "facility" field should be the billing entity (clinic, hospital, practice).
   - Extract ALL line items with amounts, tariff codes, and categories.
   - The letterhead/sender is the FACILITY, not the patient and not the doctor.

Known patients: {patient_list}
Known facilities: {facility_list}
Known doctors: {doctor_list}
Known lab test mappings: {lab_test_mappings}
Known specialty mappings: {specialty_mappings}
Known diagnosis mappings: {diagnosis_mappings}
Known medication mappings: {medication_mappings}

When you encounter a term (lab test name, specialty, diagnosis, medication) that matches an
existing mapping, use the canonical_code from that mapping. If no mapping exists, provide
your best English canonical name and set "mapped": false so the system can create a new mapping.

Respond in JSON only. No markdown, no explanation.

{{
  "patient_name": "string or null",
  "doc_type": "one of: bloodtest, labtest_other, prescription, invoice, receipt, insurance_claim, insurance_doc, referral, discharge, specialist_report, radiology_report, pathology_report, surgical_report, er_report, vaccination, allergy, sick_leave, medical_cert, physio_report, dental, ophthalmology, mental_health, consent, advance_directive, imaging_dicom, imaging_other, correspondence, other",
  "doc_date": "YYYY-MM-DD or null (most generic date; fallback)",
  "date_issued": "YYYY-MM-DD or null (when the document was issued/printed)",
  "date_visit": "YYYY-MM-DD or null (when the visit/exam actually happened)",
  "language_detected": "ISO 639-1 code",
  "doctor": {{
    "name": "string or null (the treating/signing doctor's name)",
    "title": "string or null (e.g. 'Dr.', 'Prof.')",
    "specialty_original": "string in source language or null",
    "specialty_canonical": "canonical code or best English name",
    "specialty_mapped": true
  }},
  "facility": {{
    "name": "string or null (hospital, clinic, lab name)",
    "type": "hospital|clinic|lab|pharmacy|imaging_center|other|null",
    "address": "string or null",
    "city": "string or null",
    "country": "string or null",
    "phone": "string or null"
  }},
  "specialty": {{
    "original": "string in source language or null (the medical specialty of this document)",
    "canonical": "canonical code or best English name",
    "mapped": true
  }},
  "lab_results": [
    {{
      "test_name_original": "name as written in document",
      "test_name_canonical": "canonical code (e.g. LOINC short name) or best English name",
      "test_mapped": true,
      "value": null,
      "value_text": "string for non-numeric (e.g. 'positive', 'reactive')",
      "unit": "string",
      "reference_range_low": null,
      "reference_range_high": null,
      "is_abnormal": false,
      "sample_type": "blood|urine|stool|saliva|csf|other|null",
      "panel_name": "string or null (e.g. 'CBC', 'lipid panel')"
    }}
  ],
  "diagnoses": [
    {{
      "diagnosis_original": "text as written in document",
      "diagnosis_canonical": "canonical code or best English name",
      "diagnosis_mapped": true,
      "icd10_code": "ICD-10 code or null"
    }}
  ],
  "medications": [
    {{
      "brand_name": "string or null",
      "active_ingredient_original": "as written",
      "active_ingredient_canonical": "INN name or best English name",
      "medication_mapped": true,
      "dosage": "string (e.g. '500mg')",
      "form": "tablet|capsule|cream|injection|syrup|drops|inhaler|patch|suppository|other|null",
      "frequency": "string (e.g. '2x daily')",
      "duration": "string or null",
      "quantity": "string or null"
    }}
  ],
  "cost": {{
    "total_amount": null,
    "currency": "ISO 4217 code",
    "subtotal": null,
    "tax_amount": null,
    "tax_rate": null,
    "line_items": [
      {{
        "description": "string",
        "quantity": 1,
        "unit_price": null,
        "amount": 0,
        "tariff_code": "string or null",
        "category": "consultation|procedure|medication|lab|imaging|admin|other"
      }}
    ]
  }},
  "insurance": {{
    "company": "string or null",
    "policy_number": "string or null",
    "claim_status": "approved|partially_approved|denied|pending|null"
  }},
  "encounter": {{
    "encounter_date": "YYYY-MM-DD or null",
    "admission_date": "YYYY-MM-DD or null",
    "discharge_date": "YYYY-MM-DD or null",
    "findings": "string or null",
    "follow_up_date": "YYYY-MM-DD or null",
    "follow_up_instructions": "string or null"
  }},
  "vaccinations": [
    {{
      "vaccine_name": "string",
      "manufacturer": "string or null",
      "lot_number": "string or null",
      "dose_number": null,
      "date_administered": "YYYY-MM-DD or null"
    }}
  ],
  "summary_en": "1-3 sentence English summary of the document",
  "summary_original": "1-3 sentence summary in the document's source language"
}}

OCR text:
---
{ocr_text}
---"""

# Keep backward-compat alias
EXTRACTION_PROMPT = EXTRACTION_PROMPT_LEGACY


# ---------------------------------------------------------------------------
# Page classification prompt (for multi-page document sectioning)
# ---------------------------------------------------------------------------

PAGE_CLASSIFICATION_PROMPT = """Classify each page of this multi-page medical document.
For each page, determine what type of content it contains.

Page types:
- lab_results_page: tables of lab test values with numbers and units
- clinical_notes: doctor's narrative notes, observations, assessments
- nursing_notes: nursing diary, care records
- vital_signs: vital signs charts, temperature, blood pressure tables
- consent_form: consent forms, privacy documents, signatures
- cover_page: front page with patient info, admission details
- medication_chart: medication administration records
- operative_notes: surgical/procedure descriptions
- discharge_summary: discharge letter/summary
- imaging_report: radiology findings, imaging descriptions
- correspondence: letters, referrals
- invoice_page: billing, costs, prices
- other: anything that doesn't fit above

I will give you the OCR text for multiple pages separated by "--- PAGE X ---" markers.

Respond in JSON only:
{{
  "pages": [
    {{"page": 1, "type": "cover_page", "brief": "Patient admission form with demographics"}},
    {{"page": 2, "type": "clinical_notes", "brief": "Initial assessment by Dr. Smith"}}
  ]
}}

OCR text:
---
{pages_text}
---"""


DOCUMENT_EDIT_PROMPT = """You are a medical document metadata editor. The user is correcting or adding information about a medical document.

Current document data:
{current_data}

Known patients: {patient_list}
Known facilities: {facility_list}
Known doctors: {doctor_list}

The user says:
"{user_instruction}"

Based on the user's instruction, produce an UPDATED version of the document data as JSON.
Rules:
- Keep all existing fields that the user did NOT mention — do not clear them.
- Only modify the fields the user explicitly mentions.
- If the user mentions a patient name, match it against known patients and set "patient_name" to the exact known name.
- If the user mentions a doctor, set the "doctor" object.
- If the user mentions a facility/hospital/clinic, set the "facility" object.
- If the user mentions a date, determine which date field it belongs to (doc_date, date_issued, date_visit).
- If the user mentions a document type, set "doc_type" using the standard codes.
- If the user mentions a diagnosis, add it to "diagnoses".
- If the user mentions medications, add them to "medications".
- Respond in JSON only. Use the same schema as the extraction output.

Respond in JSON only. No markdown, no explanation.

{json_schema}"""


SQL_GENERATION_PROMPT = """You are a SQL query generator for a medical records database.
Generate a read-only SELECT query to answer the user's question.

Database schema:
{schema}

Patient context:
{context}

Rules:
- Only SELECT queries. No INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
- Use proper JOINs when querying across tables.
- Use normalization tables to resolve names when appropriate.
- Limit results to 100 rows maximum.
- Return the SQL query inside ```sql``` code block.

Question: {question}"""


CHAT_SYSTEM_PROMPT = """You are Asclepius, a helpful medical records assistant. You help users
understand their medical history by querying a structured database of their medical records.

You have access to the following patient data:
{patient_context}

When answering questions:
- Be factual and reference specific dates, values, and document sources
- If you're unsure, say so rather than guessing
- Don't provide medical advice — just help navigate the records
- Reference specific lab values, dates, and providers when available
- If the data doesn't contain the answer, say so clearly"""


DB_SCHEMA_FOR_CHAT = """
Tables:
- documents(id, patient_id, file_path, original_filename, doc_type, doc_date, doctor_id, facility_id, date_issued, date_visit, date_received, summary_en, summary_original, norm_specialty_id, specialty_original, insurance_company, insurance_policy, notes, tags, ocr_text, raw_extraction, status)
- patients(id, slug, display_name, date_of_birth, sex, blood_type, allergies, notes, phone, email, address, insurance_company, insurance_number)
- facilities(id, name, slug, type, address, city, country, phone, email, website)
- doctors(id, name, slug, title, norm_specialty_id, specialty_original, facility_id, phone, email)
- document_links(id, source_document_id, target_document_id, link_type)
- lab_results(id, document_id, patient_id, test_name_original, norm_lab_test_id, value, value_text, unit, reference_range_low, reference_range_high, is_abnormal, sample_type, panel_name, test_date)
- encounters(id, document_id, patient_id, doctor_id, facility_id, encounter_date, admission_date, discharge_date, diagnosis_original, diagnosis_code, notes, findings, follow_up_date, follow_up_instructions)
- medications(id, document_id, patient_id, brand_name, active_ingredient_original, dosage, form, frequency, duration, quantity, prescribed_date)
- vaccinations(id, document_id, patient_id, vaccine_name, manufacturer, lot_number, dose_number, date_administered)
- imaging_studies(id, document_id, patient_id, doctor_id, facility_id, study_date, modality, body_part, study_description, institution_name)
- norm_lab_tests(id, canonical_code, canonical_display, loinc_code, category, unit_preferred)
- norm_lab_test_aliases(id, norm_lab_test_id, alias, language)
- norm_diagnoses(id, canonical_code, canonical_display, icd10_code)
- norm_medications(id, canonical_code, canonical_display, atc_code)
"""


FILENAME_GENERATION_PROMPT = """Generate a short, descriptive filename for a medical document.

Document metadata:
- Type: {doc_type}
- Date: {doc_date}
- Doctor: {doctor_name}
- Facility: {facility_name}
- Summary: {summary}

Rules:
- Return ONLY the filename stem (no extension, no date prefix — those are added automatically)
- Use 3-6 words maximum, separated by hyphens
- Be specific and descriptive: capture WHAT the document is about
- Use lowercase English words
- Examples of GOOD filenames: "blood-test-cholesterol-panel", "knee-mri-report", "cardiology-consultation", "prescription-antibiotics", "discharge-summary-appendectomy", "invoice-dermatology-visit"
- Examples of BAD filenames: "medical-document", "report", "test-results" (too vague), "complete-blood-count-with-differential-and-metabolic-panel-results" (too long)
- Do NOT include the date, patient name, or file extension
- If the document is an invoice/receipt, mention what it's for (e.g. "invoice-orthopedic-visit")

Respond with ONLY the filename stem, nothing else. No quotes, no explanation."""


LINK_SUGGESTION_PROMPT = """You are a medical records analyst. Given a document and a list of other documents for the same patient, suggest which documents are likely related.

Current document:
- ID: {doc_id}
- Type: {doc_type}
- Date: {doc_date}
- Doctor: {doctor_name}
- Facility: {facility_name}
- Summary: {summary}

Other documents for the same patient:
{other_documents}

Link types:
- "invoice_for" = an invoice/bill for a visit or procedure documented elsewhere
- "report_for" = a report (lab, radiology, pathology) related to a visit
- "imaging_for" = imaging study related to a clinical report
- "follow_up" = a follow-up visit to a previous visit
- "related" = otherwise clinically related documents

Rules:
- Only suggest links with high confidence.
- Consider date proximity, same doctor/facility, and clinical context.
- An invoice near the same date from the same facility likely relates to a specialist report.
- Lab results near a visit date likely relate to that visit.
- Do NOT suggest links between completely unrelated specialties unless there is a clear reason.

Respond in JSON only. No markdown.

{{
  "suggestions": [
    {{
      "document_id": 0,
      "link_type": "one of: invoice_for, report_for, imaging_for, follow_up, related",
      "reason": "brief explanation"
    }}
  ]
}}"""
