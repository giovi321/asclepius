---
title: "Database Schema"
---

Asclepius keeps all structured data in SQLite, with WAL (Write-Ahead Logging) for safe concurrent reads during pipeline writes and FTS5 for full-text search. The database file lives at `vault/asclepius.sqlite`.

<div class="diagram-frame">
<svg viewBox="0 0 920 480" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Core data model" style="display:block;width:100%;height:auto;max-width:100%;">
  <defs>
    <pattern id="db-dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.9" fill="rgba(28,25,23,0.10)"/>
    </pattern>
    <style>
      .db-eyebrow { font-family:'Geist Mono',monospace; font-size:7px;  letter-spacing:0.08em; }
      .db-name    { font-family:'Geist',sans-serif;     font-size:12px; font-weight:600; fill:#1c1917; }
      .db-name-lg { font-family:'Geist',sans-serif;     font-size:14px; font-weight:600; fill:#1c1917; }
      .db-field   { font-family:'Geist Mono',monospace; font-size:9px;  fill:#57534e; }
      .db-label   { font-family:'Geist Mono',monospace; font-size:8px;  letter-spacing:0.06em; fill:#57534e; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#efeee5"/>
  <rect width="100%" height="100%" fill="url(#db-dots)" opacity="0.6"/>
  <!-- ===== Relationship lines (behind boxes) ===== -->
  <!-- patients -> documents: primary 1-N -->
  <line x1="216" y1="224" x2="360" y2="224" stroke="#57534e" stroke-width="1"/>
  <rect x="268" y="216" width="40" height="14" rx="2" fill="#efeee5"/>
  <text x="288" y="225" class="db-label" text-anchor="middle">1—N</text>
  <!-- users -> documents: uploaded_by (optional, dashed) -->
  <line x1="216" y1="96" x2="360" y2="168" stroke="#57534e" stroke-width="1" stroke-dasharray="4,3"/>
  <rect x="256" y="124" width="64" height="14" rx="2" fill="#efeee5"/>
  <text x="288" y="133" class="db-label" text-anchor="middle">UPLOADED</text>
  <!-- medical_events -> documents: M-N via document_event_links -->
  <line x1="216" y1="352" x2="360" y2="328" stroke="#57534e" stroke-width="1" stroke-dasharray="4,3"/>
  <rect x="254" y="332" width="68" height="14" rx="2" fill="#efeee5"/>
  <text x="288" y="341" class="db-label" text-anchor="middle">M—N LINKS</text>
  <!-- documents -> right-side medical data tables (all 1-N) -->
  <line x1="560" y1="176" x2="704" y2="88"  stroke="#57534e" stroke-width="1"/>
  <line x1="560" y1="216" x2="704" y2="192" stroke="#57534e" stroke-width="1"/>
  <line x1="560" y1="280" x2="704" y2="296" stroke="#57534e" stroke-width="1"/>
  <line x1="560" y1="328" x2="704" y2="400" stroke="#57534e" stroke-width="1"/>
  <rect x="608" y="132" width="40" height="14" rx="2" fill="#efeee5"/>
  <text x="628" y="141" class="db-label" text-anchor="middle">1—N</text>
  <!-- ===== users ===== -->
  <rect x="40" y="56"  width="176" height="80" rx="6" fill="#faf7f2"/>
  <rect x="40" y="56"  width="176" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
  <rect x="48" y="64"  width="44" height="14" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
  <text x="70"  y="74"  class="db-eyebrow" fill="rgba(28,25,23,0.8)" text-anchor="middle">USERS</text>
  <text x="128" y="100" class="db-name"  text-anchor="middle">users</text>
  <text x="128" y="116" class="db-field" text-anchor="middle">id · username · role</text>
  <text x="128" y="128" class="db-field" text-anchor="middle">password_hash</text>
  <!-- ===== patients (focal) ===== -->
  <rect x="40" y="180" width="176" height="88" rx="6" fill="#faf7f2"/>
  <rect x="40" y="180" width="176" height="88" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
  <rect x="48" y="188" width="56" height="14" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
  <text x="76"  y="198" class="db-eyebrow" fill="#8E4449" text-anchor="middle">PATIENT</text>
  <text x="128" y="224" class="db-name"  text-anchor="middle">patients</text>
  <text x="128" y="240" class="db-field" text-anchor="middle">id · slug · display_name</text>
  <text x="128" y="252" class="db-field" text-anchor="middle">date_of_birth · sex</text>
  <!-- ===== medical_events ===== -->
  <rect x="40" y="312" width="176" height="80" rx="6" fill="#faf7f2"/>
  <rect x="40" y="312" width="176" height="80" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
  <rect x="48" y="320" width="56" height="14" rx="2" fill="transparent" stroke="rgba(87,83,78,0.40)" stroke-width="0.8"/>
  <text x="76"  y="330" class="db-eyebrow" fill="rgba(87,83,78,0.9)" text-anchor="middle">EVENTS</text>
  <text x="128" y="356" class="db-name"  text-anchor="middle">medical_events</text>
  <text x="128" y="372" class="db-field" text-anchor="middle">title · type · date range</text>
  <text x="128" y="384" class="db-field" text-anchor="middle">+ document_event_links</text>
  <!-- ===== documents (focal, hub) ===== -->
  <rect x="360" y="136" width="200" height="224" rx="6" fill="#faf7f2"/>
  <rect x="360" y="136" width="200" height="224" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
  <rect x="368" y="144" width="48" height="14" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
  <text x="392" y="154" class="db-eyebrow" fill="#8E4449" text-anchor="middle">CORE</text>
  <text x="460" y="184" class="db-name-lg" text-anchor="middle">documents</text>
  <text x="460" y="208" class="db-field" text-anchor="middle">id · patient_id · file_path</text>
  <text x="460" y="220" class="db-field" text-anchor="middle">file_hash · doc_type</text>
  <text x="460" y="232" class="db-field" text-anchor="middle">doc_date · status</text>
  <text x="460" y="244" class="db-field" text-anchor="middle">ocr_text · raw_extraction</text>
  <text x="460" y="256" class="db-field" text-anchor="middle">ocr_engine · llm_provider</text>
  <text x="460" y="268" class="db-field" text-anchor="middle">uploaded_by_user_id</text>
  <text x="460" y="280" class="db-field" text-anchor="middle">doctor_id · facility_id</text>
  <text x="460" y="292" class="db-field" text-anchor="middle">event_id · summary_en</text>
  <text x="460" y="304" class="db-field" text-anchor="middle">user_notes · tags</text>
  <text x="460" y="324" class="db-field" text-anchor="middle">+ documents_fts (FTS5)</text>
  <text x="460" y="344" class="db-field" text-anchor="middle">+ document_sections · links</text>
  <!-- ===== lab_results ===== -->
  <rect x="704" y="48"  width="176" height="80" rx="6" fill="#faf7f2"/>
  <rect x="704" y="48"  width="176" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
  <rect x="712" y="56"  width="40" height="14" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
  <text x="732" y="66"  class="db-eyebrow" fill="rgba(28,25,23,0.8)" text-anchor="middle">LABS</text>
  <text x="792" y="92"  class="db-name"  text-anchor="middle">lab_results</text>
  <text x="792" y="108" class="db-field" text-anchor="middle">value · unit · ranges</text>
  <text x="792" y="120" class="db-field" text-anchor="middle">norm_lab_test_id</text>
  <!-- ===== medications ===== -->
  <rect x="704" y="152" width="176" height="80" rx="6" fill="#faf7f2"/>
  <rect x="704" y="152" width="176" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
  <rect x="712" y="160" width="32" height="14" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
  <text x="728" y="170" class="db-eyebrow" fill="rgba(28,25,23,0.8)" text-anchor="middle">RX</text>
  <text x="792" y="196" class="db-name"  text-anchor="middle">medications</text>
  <text x="792" y="212" class="db-field" text-anchor="middle">brand · ingredient</text>
  <text x="792" y="224" class="db-field" text-anchor="middle">dosage · frequency</text>
  <!-- ===== encounters ===== -->
  <rect x="704" y="256" width="176" height="80" rx="6" fill="#faf7f2"/>
  <rect x="704" y="256" width="176" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
  <rect x="712" y="264" width="52" height="14" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
  <text x="738" y="274" class="db-eyebrow" fill="rgba(28,25,23,0.8)" text-anchor="middle">VISITS</text>
  <text x="792" y="300" class="db-name"  text-anchor="middle">encounters</text>
  <text x="792" y="316" class="db-field" text-anchor="middle">diagnosis · findings</text>
  <text x="792" y="328" class="db-field" text-anchor="middle">follow-up</text>
  <!-- ===== imaging_studies ===== -->
  <rect x="704" y="360" width="176" height="80" rx="6" fill="#faf7f2"/>
  <rect x="704" y="360" width="176" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
  <rect x="712" y="368" width="56" height="14" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
  <text x="740" y="378" class="db-eyebrow" fill="rgba(28,25,23,0.8)" text-anchor="middle">IMAGING</text>
  <text x="792" y="404" class="db-name"  text-anchor="middle">imaging_studies</text>
  <text x="792" y="420" class="db-field" text-anchor="middle">modality · body_part</text>
  <text x="792" y="432" class="db-field" text-anchor="middle">+ imaging_series · DICOM</text>
</svg>
</div>

The diagram above is the core hub-and-spoke shape: `documents` in the middle, `patients` as the access boundary, and the medical-data tables (`lab_results`, `medications`, `encounters`, `imaging_studies`) hanging off both. Normalization tables (`norm_lab_tests`, etc.), audit logs, sessions, FTS triggers, and the per-page OCR cache are documented in the **Table Details** section below.


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
