"""LLM prompt templates for document extraction and chat."""

EXTRACTION_PROMPT = """You are a medical document parser. Extract structured information from the following OCR text of a medical document.

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
