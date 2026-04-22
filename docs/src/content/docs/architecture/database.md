---
title: "Database Schema"
---

Asclepius keeps all structured data in SQLite, with WAL (Write-Ahead Logging) for safe concurrent reads during pipeline writes and FTS5 for full-text search. The database file lives at `vault/asclepius.sqlite`.

<iframe src="../../assets/diagrams/data-model.html" width="100%" height="740" style="border:0;border-radius:8px;" title="Core data model"></iframe>

The diagram above is the core hub-and-spoke shape: `documents` in the middle, `patients` as the access boundary, and the medical-data tables (`lab_results`, `medications`, `encounters`, `imaging_studies`) hanging off both. Normalization tables (`norm_lab_tests`, etc.), audit logs, sessions, FTS triggers, and the per-page OCR cache are documented in the **Table Details** section below.

<details>
<summary>Full Entity-Relationship Diagram (mermaid source)</summary>

```mermaid
erDiagram
    users ||--o{ user_patient_access : has
    patients ||--o{ user_patient_access : has
    patients ||--o{ documents : has
    patients ||--o{ lab_results : has
    patients ||--o{ encounters : has
    patients ||--o{ medications : has
    patients ||--o{ vaccinations : has
    patients ||--o{ imaging_studies : has
    patients ||--o{ medical_events : has

    documents ||--o{ lab_results : contains
    documents ||--o{ encounters : contains
    documents ||--o{ medications : contains
    documents ||--o{ vaccinations : contains
    documents ||--o{ imaging_studies : contains
    documents ||--o{ invoice_items : contains
    documents ||--o{ document_links : source
    documents ||--o{ document_links : target
    documents ||--o{ document_event_links : linked
    documents ||--o{ document_sections : has

    medical_events ||--o{ document_event_links : linked

    doctors ||--o{ doctor_aliases : has
    doctors ||--o{ documents : referenced
    doctors ||--o{ encounters : referenced
    doctors ||--o{ imaging_studies : referenced
    facilities ||--o{ facility_aliases : has
    facilities ||--o{ documents : referenced
    facilities ||--o{ doctors : belongs_to
    facilities ||--o{ encounters : referenced
    facilities ||--o{ imaging_studies : referenced

    imaging_studies ||--o{ imaging_series : contains

    norm_lab_tests ||--o{ norm_lab_test_aliases : has
    norm_lab_tests ||--o{ lab_results : normalizes
    norm_specialties ||--o{ norm_specialty_aliases : has
    norm_diagnoses ||--o{ norm_diagnosis_aliases : has
    norm_medications ||--o{ norm_medication_aliases : has

    users ||--o{ chat_history : has
    users ||--o{ sessions : has
    users ||--o{ documents : uploaded

    users {
        int id PK
        text username UK
        text password_hash
        text display_name
        text role
        datetime created_at
    }

    sessions {
        text id PK
        int user_id FK
        datetime created_at
        datetime expires_at
        datetime last_seen_at
        text user_agent
        text ip_address
    }

    audit_log {
        int id PK
        datetime timestamp
        int user_id FK
        text event
        text target_type
        text target_id
        text details
    }

    ocr_page_cache {
        int document_id FK
        int page_number
        text ocr_text
        text ocr_engine
        real confidence
    }

    patients {
        int id PK
        text slug UK
        text display_name
        date date_of_birth
        text sex
    }

    user_patient_access {
        int user_id FK
        int patient_id FK
        text role
    }

    documents {
        int id PK
        int patient_id FK
        int uploaded_by_user_id FK
        text file_path
        text original_filename
        text suggested_filename
        text doc_type
        date doc_date
        int doctor_id FK
        text doctor_name
        int facility_id FK
        text facility_name
        int norm_specialty_id FK
        text specialty_original
        date date_issued
        date date_visit
        date date_received
        text summary_en
        text summary_original
        int event_id FK
        text notes
        text user_notes
        text tags
        int page_count
        int file_size
        text file_hash UK
        text ocr_text
        real ocr_confidence
        text ocr_engine
        text llm_provider
        text processing_flow
        json raw_extraction
        text status
        text error_message
        int retry_count
    }

    medical_events {
        int id PK
        int patient_id FK
        text title
        text event_type
        text description
        date date_start
        date date_end
        bool is_ongoing
        text severity
        text diagnosis_text
        text icd10_code
        text specialty_text
        text notes
        text color
    }

    document_event_links {
        int id PK
        int document_id FK
        int event_id FK
        text relevance
        bool auto_linked
    }

    document_sections {
        int id PK
        int document_id FK
        int section_index
        int page_start
        int page_end
        text section_type
        text ocr_text
        json raw_extraction
        text summary_en
    }

    document_links {
        int id PK
        int source_document_id FK
        int target_document_id FK
        text link_type
    }

    facilities {
        int id PK
        text name
        text slug UK
        text canonical_code UK
        text canonical_display
        text type
        text address
        text city
        text country
        text phone
        text email
        text website
    }

    facility_aliases {
        int id PK
        int facility_id FK
        text alias
        text language
        bool auto_mapped
    }

    doctors {
        int id PK
        text name
        text slug UK
        text canonical_code UK
        text canonical_display
        text title
        int norm_specialty_id FK
        int facility_id FK
        text phone
        text email
    }

    doctor_aliases {
        int id PK
        int doctor_id FK
        text alias
        text language
        bool auto_mapped
    }

    lab_results {
        int id PK
        int document_id FK
        int patient_id FK
        text test_name_original
        int norm_lab_test_id FK
        real value
        text value_text
        text unit
        real reference_range_low
        real reference_range_high
        bool is_abnormal
        text sample_type
        text panel_name
        date test_date
    }

    encounters {
        int id PK
        int document_id FK
        int patient_id FK
        int doctor_id FK
        int facility_id FK
        date encounter_date
        date admission_date
        date discharge_date
        int norm_diagnosis_id FK
        text diagnosis_original
        text findings
        text notes
        date follow_up_date
        text follow_up_instructions
    }

    medications {
        int id PK
        int document_id FK
        int patient_id FK
        int norm_medication_id FK
        text brand_name
        text active_ingredient_original
        text dosage
        text form
        text frequency
        text duration
        text quantity
        date prescribed_date
    }

    vaccinations {
        int id PK
        int document_id FK
        int patient_id FK
        text vaccine_name
        text manufacturer
        text lot_number
        int dose_number
        date date_administered
    }

    imaging_studies {
        int id PK
        int document_id FK
        int patient_id FK
        text modality
        text body_part
        text study_description
        date study_date
        bool is_dicom
        text folder_path
    }

    imaging_series {
        int id PK
        int study_id FK
        int series_number
        text series_description
        text modality
        int num_images
    }

    invoice_items {
        int id PK
        int document_id FK
        int patient_id FK
        text description
        real quantity
        real unit_price
        real amount
        text currency
        text tariff_code
        text category
    }

    chat_history {
        int id PK
        int user_id FK
        int patient_id FK
        text role
        text content
    }

    custom_prompts {
        int id PK
        text prompt_key UK
        text prompt_text
        text description
    }
```

</details>

## Table Details

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts with bcrypt password hashes |
| `patients` | Patient demographics; deliberately minimal (name, DOB, sex) since only those fields are passed to the LLM for extraction |
| `user_patient_access` | Maps users to patients with role (`owner` or `viewer`) |
| `documents` | Central document records with metadata, OCR text, and extraction results |

### Medical Data Tables

| Table | Purpose |
|-------|---------|
| `lab_results` | Individual lab test results with values, units, and reference ranges |
| `encounters` | Clinical encounters with diagnoses, findings, and follow-up instructions |
| `medications` | Prescribed medications with dosage, frequency, and duration |
| `vaccinations` | Vaccination records with manufacturer, lot number, and dose |
| `imaging_studies` | Imaging study metadata (modality, body part, DICOM info) |
| `imaging_series` | Individual series within an imaging study |
| `invoice_items` | Line items from medical invoices with amounts and tariff codes |

### Organization Tables

| Table | Purpose |
|-------|---------|
| `medical_events` | Medical events (diagnosis, surgery, treatment) that group related documents |
| `document_event_links` | Many-to-many links between documents and events with relevance level |
| `document_links` | Direct links between related documents (e.g., invoice_for, follow_up) |
| `document_sections` | Page-level sections for large documents with per-section OCR and extraction |
| `facilities` | Healthcare facilities (hospitals, clinics, labs) with normalization support |
| `facility_aliases` | Name aliases for facilities (for normalization/merge) |
| `doctors` | Doctors with specialty and facility affiliation, with normalization support |
| `doctor_aliases` | Name aliases for doctors (for normalization/merge) |

### Normalization Tables

| Table | Purpose |
|-------|---------|
| `norm_lab_tests` + `norm_lab_test_aliases` | Canonical lab test names with multi-language aliases |
| `norm_specialties` + `norm_specialty_aliases` | Medical specialties with aliases |
| `norm_diagnoses` + `norm_diagnosis_aliases` | Diagnosis codes (ICD-10) with aliases |
| `norm_medications` + `norm_medication_aliases` | Medication names (ATC codes) with aliases |

### Learning Tables

| Table | Purpose |
|-------|---------|
| `extraction_corrections` | Tracks user edits to LLM-extracted fields (before/after values) for correction-driven learning |

### System Tables

| Table | Purpose |
|-------|---------|
| `chat_history` | Persisted chat messages per user and patient |
| `custom_prompts` | User-customized LLM prompts (overrides defaults) |
| `documents_fts` | FTS5 virtual table for full-text search across OCR text and raw extractions |
| `sessions` | Server-side session records (id, user, IP, user-agent, last-seen, expiry). Backs the admin session-list / revoke UI and replaces the older cookie-only session model. |
| `audit_log` | Structured audit trail for admin actions (user create/delete, session revoke, settings mutations). Surfaced in the Settings → Audit Log view. |
| `ocr_page_cache` | Per-page OCR text keyed by `(document_id, page_number)`. Populated during OCR so the extractor and chunking pipeline can read individual pages without re-running OCR. |

### Configuration (not in the database)

Shared credentials (URL + API key + concurrency + retry policy) and LLM/OCR/Vision provider entries live in `config/settings.yaml`, not the SQLite database. Asclepius mutates that file at runtime when you edit providers/credentials from the UI. There is no `credentials` or `providers` table.

## Key Design Notes

- **Deduplication.** Documents have a unique `file_hash` (SHA-256) to prevent duplicate imports.
- **Denormalized names.** `documents.doctor_name` and `documents.facility_name` store the raw extracted names alongside normalized `doctor_id`/`facility_id` foreign keys.
- **Cascading deletes.** Deleting a document cascades to all child records (lab results, encounters, medications, etc.).
- **FTS triggers.** Insert/update/delete triggers keep the FTS5 index in sync with the documents table automatically.
- **WAL mode.** Enabled at connection time for concurrent reads during pipeline writes.
