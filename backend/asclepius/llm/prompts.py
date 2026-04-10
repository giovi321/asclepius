"""LLM prompt templates for document extraction and chat."""

EXTRACTION_PROMPT = """You are a medical document parser. Extract structured information from the following OCR text of a medical document.

Known patients: {patient_list}
Known providers: {provider_list}
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
  "doc_date": "YYYY-MM-DD or null",
  "language_detected": "ISO 639-1 code",
  "provider": {{
    "name": "string or null",
    "specialty_original": "string in source language or null",
    "specialty_canonical": "canonical code or best English name",
    "specialty_mapped": true
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
    "amount": null,
    "currency": "ISO 4217 code",
    "line_items": [
      {{"description": "string", "amount": 0}}
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
  "summary_en": "1-3 sentence English summary of the document"
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
- documents(id, patient_id, file_path, original_filename, doc_type, doc_date, provider_id, ocr_text, raw_extraction, status)
- patients(id, slug, display_name, date_of_birth)
- providers(id, name, slug, specialty)
- lab_results(id, document_id, patient_id, test_name_original, norm_lab_test_id, value, value_text, unit, reference_range_low, reference_range_high, is_abnormal, sample_type, panel_name, test_date)
- encounters(id, document_id, patient_id, provider_id, encounter_date, admission_date, discharge_date, diagnosis_original, diagnosis_code, notes, findings, follow_up_date, follow_up_instructions)
- medications(id, document_id, patient_id, brand_name, active_ingredient_original, dosage, form, frequency, duration, quantity, prescribed_date)
- vaccinations(id, document_id, patient_id, vaccine_name, manufacturer, lot_number, dose_number, date_administered)
- imaging_studies(id, document_id, patient_id, study_date, modality, body_part, study_description, institution_name)
- norm_lab_tests(id, canonical_code, canonical_display, loinc_code, category, unit_preferred)
- norm_lab_test_aliases(id, norm_lab_test_id, alias, language)
- norm_diagnoses(id, canonical_code, canonical_display, icd10_code)
- norm_medications(id, canonical_code, canonical_display, atc_code)
"""
