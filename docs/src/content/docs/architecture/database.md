---
title: "Database Schema"
---

Asclepius keeps all structured data in SQLite, with WAL (Write-Ahead Logging) for safe concurrent reads during pipeline writes and FTS5 for full-text search. The database file lives at `vault/asclepius.sqlite`.

<div style="background:#efeee5;border:1px solid rgba(28,25,23,0.12);border-radius:8px;padding:1rem;margin:1rem 0;overflow:hidden;">
<svg viewBox="0 0 920 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Core data model" style="display:block;width:100%;height:auto;max-width:100%;">
    <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.9" fill="rgba(28,25,23,0.10)"/>
      </pattern>
      <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#57534e"/>
      </marker>
    </defs>
    <rect width="100%" height="100%" fill="#efeee5"/>
    <rect width="100%" height="100%" fill="url(#dots)" opacity="0.6"/>
    <!-- ===== Relationship lines (z-order behind boxes) ===== -->
    <!-- patients -> documents -->
    <line x1="220" y1="200" x2="368" y2="220" stroke="#57534e" stroke-width="1"/>
    <rect x="268" y="192" width="36" height="12" rx="2" fill="#efeee5"/>
    <text x="286" y="201" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle" letter-spacing="0.06em">1—N</text>
    <!-- users -> documents (uploaded_by) -->
    <line x1="220" y1="100" x2="368" y2="200" stroke="#57534e" stroke-width="1" stroke-dasharray="4,3"/>
    <rect x="244" y="132" width="72" height="12" rx="2" fill="#efeee5"/>
    <text x="280" y="141" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle" letter-spacing="0.06em">UPLOADED_BY</text>
    <!-- documents -> lab_results -->
    <line x1="552" y1="248" x2="700" y2="100" stroke="#57534e" stroke-width="1"/>
    <rect x="612" y="160" width="36" height="12" rx="2" fill="#efeee5"/>
    <text x="630" y="169" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle" letter-spacing="0.06em">1—N</text>
    <!-- documents -> medications -->
    <line x1="552" y1="268" x2="700" y2="200" stroke="#57534e" stroke-width="1"/>
    <!-- documents -> encounters -->
    <line x1="552" y1="288" x2="700" y2="300" stroke="#57534e" stroke-width="1"/>
    <!-- documents -> imaging_studies -->
    <line x1="552" y1="308" x2="700" y2="400" stroke="#57534e" stroke-width="1"/>
    <!-- doctors -> documents -->
    <line x1="220" y1="400" x2="368" y2="288" stroke="#57534e" stroke-width="1"/>
    <rect x="236" y="342" width="56" height="12" rx="2" fill="#efeee5"/>
    <text x="264" y="351" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle" letter-spacing="0.06em">DOCTOR_ID</text>
    <!-- facilities -> documents -->
    <line x1="220" y1="500" x2="368" y2="308" stroke="#57534e" stroke-width="1"/>
    <rect x="232" y="442" width="60" height="12" rx="2" fill="#efeee5"/>
    <text x="262" y="451" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle" letter-spacing="0.06em">FACILITY_ID</text>
    <!-- medical_events <- document_event_links -> documents -->
    <line x1="552" y1="328" x2="700" y2="500" stroke="#57534e" stroke-width="1" stroke-dasharray="4,3"/>
    <rect x="616" y="424" width="72" height="12" rx="2" fill="#efeee5"/>
    <text x="652" y="433" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle" letter-spacing="0.06em">M—N · LINKS</text>
    <!-- documents -> ocr_page_cache (right side, into system cluster) -->
    <line x1="552" y1="340" x2="700" y2="568" stroke="#57534e" stroke-width="1" stroke-dasharray="4,3"/>
    <rect x="584" y="478" width="56" height="12" rx="2" fill="#efeee5"/>
    <text x="612" y="487" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle" letter-spacing="0.06em">PAGE CACHE</text>
    <!-- users -> system tables cluster -->
    <line x1="140" y1="140" x2="140" y2="556" stroke="#57534e" stroke-width="1" stroke-dasharray="4,3"/>
    <line x1="140" y1="556" x2="700" y2="580" stroke="#57534e" stroke-width="1" stroke-dasharray="4,3"/>
    <rect x="360" y="560" width="80" height="12" rx="2" fill="#efeee5"/>
    <text x="400" y="569" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle" letter-spacing="0.06em">SESSIONS · AUDIT</text>
    <!-- ===== USERS (left top) ===== -->
    <rect x="60" y="60" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="60" y="60" width="160" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="68" y="68" width="44" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="90" y="77" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">USERS</text>
    <text x="140" y="100" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">users</text>
    <text x="140" y="116" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">id · username · role</text>
    <text x="140" y="128" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">password_hash</text>
    <!-- ===== PATIENTS (left middle, focal) ===== -->
    <rect x="60" y="160" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="60" y="160" width="160" height="80" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <rect x="68" y="168" width="56" height="12" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
    <text x="96" y="177" font-family="'Geist Mono',monospace" font-size="7" fill="#8E4449" text-anchor="middle" letter-spacing="0.08em">PATIENT</text>
    <text x="140" y="200" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">patients</text>
    <text x="140" y="216" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">id · slug · display_name</text>
    <text x="140" y="228" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">date_of_birth · sex</text>
    <!-- ===== DOCTORS (left bottom-mid) ===== -->
    <rect x="60" y="360" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="60" y="360" width="160" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="68" y="368" width="48" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="92" y="377" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">PEOPLE</text>
    <text x="140" y="400" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">doctors</text>
    <text x="140" y="416" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">id · name · slug</text>
    <text x="140" y="428" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">+ doctor_aliases</text>
    <!-- ===== FACILITIES (left bottom) ===== -->
    <rect x="60" y="460" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="60" y="460" width="160" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="68" y="468" width="48" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="92" y="477" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">PLACES</text>
    <text x="140" y="500" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">facilities</text>
    <text x="140" y="516" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">id · name · slug</text>
    <text x="140" y="528" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">+ facility_aliases</text>
    <!-- ===== DOCUMENTS (center hub, focal) ===== -->
    <rect x="368" y="200" width="184" height="152" rx="6" fill="#faf7f2"/>
    <rect x="368" y="200" width="184" height="152" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <rect x="376" y="208" width="56" height="12" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
    <text x="404" y="217" font-family="'Geist Mono',monospace" font-size="7" fill="#8E4449" text-anchor="middle" letter-spacing="0.08em">CORE</text>
    <text x="460" y="240" font-family="'Geist',sans-serif" font-size="14" font-weight="600" fill="#1c1917" text-anchor="middle">documents</text>
    <text x="460" y="256" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">id · file_path · file_hash</text>
    <text x="460" y="268" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">doc_type · doc_date</text>
    <text x="460" y="280" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">ocr_text · raw_extraction</text>
    <text x="460" y="292" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">status · ocr_engine</text>
    <text x="460" y="304" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">uploaded_by_user_id</text>
    <text x="460" y="316" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">suggested_filename</text>
    <text x="460" y="328" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">user_notes</text>
    <text x="460" y="344" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">+ documents_fts (FTS5)</text>
    <!-- ===== Right column: medical data tables ===== -->
    <rect x="700" y="60" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="700" y="60" width="160" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="708" y="68" width="40" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="728" y="77" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">LABS</text>
    <text x="780" y="100" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">lab_results</text>
    <text x="780" y="116" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">value · unit · range</text>
    <text x="780" y="128" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">norm_lab_test_id</text>
    <rect x="700" y="160" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="700" y="160" width="160" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="708" y="168" width="40" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="728" y="177" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">RX</text>
    <text x="780" y="200" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">medications</text>
    <text x="780" y="216" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">brand · ingredient</text>
    <text x="780" y="228" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">dosage · frequency</text>
    <rect x="700" y="260" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="700" y="260" width="160" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="708" y="268" width="60" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="738" y="277" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">VISITS</text>
    <text x="780" y="300" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">encounters</text>
    <text x="780" y="316" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">diagnosis · findings</text>
    <text x="780" y="328" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">follow-up</text>
    <rect x="700" y="360" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="700" y="360" width="160" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="708" y="368" width="60" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="738" y="377" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">IMAGING</text>
    <text x="780" y="400" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">imaging_studies</text>
    <text x="780" y="416" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">modality · body_part</text>
    <text x="780" y="428" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">+ imaging_series</text>
    <rect x="700" y="460" width="160" height="80" rx="6" fill="#faf7f2"/>
    <rect x="700" y="460" width="160" height="80" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
    <rect x="708" y="468" width="56" height="12" rx="2" fill="transparent" stroke="rgba(87,83,78,0.40)" stroke-width="0.8"/>
    <text x="736" y="477" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(87,83,78,0.9)" text-anchor="middle" letter-spacing="0.08em">EVENTS</text>
    <text x="780" y="500" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">medical_events</text>
    <text x="780" y="516" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">title · type · range</text>
    <text x="780" y="528" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">+ event_links</text>
    <!-- ===== SYSTEM TABLES cluster (single visual block) ===== -->
    <rect x="700" y="560" width="160" height="60" rx="6" fill="#faf7f2"/>
    <rect x="700" y="560" width="160" height="60" rx="6" fill="rgba(28,25,23,0.02)" stroke="rgba(28,25,23,0.20)" stroke-width="1" stroke-dasharray="4,4"/>
    <rect x="708" y="568" width="60" height="12" rx="2" fill="transparent" stroke="rgba(87,83,78,0.40)" stroke-width="0.8"/>
    <text x="738" y="577" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(87,83,78,0.9)" text-anchor="middle" letter-spacing="0.08em">SYSTEM</text>
    <text x="780" y="596" font-family="'Geist',sans-serif" font-size="11" font-weight="600" fill="#1c1917" text-anchor="middle">sessions · audit_log</text>
    <text x="780" y="610" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">ocr_page_cache</text>
  </svg>
</div>

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
