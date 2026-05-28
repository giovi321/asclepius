-- Asclepius database schema
-- All tables in dependency order

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'editor',  -- 'admin', 'editor', 'viewer'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    date_of_birth DATE,
    sex TEXT,  -- 'M', 'F', 'O'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_patient_access (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',  -- 'owner' or 'viewer'
    PRIMARY KEY (user_id, patient_id)
);

CREATE TABLE IF NOT EXISTS facilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    canonical_code TEXT,
    canonical_display TEXT,
    type TEXT,  -- 'hospital', 'clinic', 'lab', 'pharmacy', 'imaging_center', 'other'
    address TEXT,
    city TEXT,
    country TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS facility_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    language TEXT,
    auto_mapped BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_facility_aliases_alias ON facility_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_facility_aliases_fk ON facility_aliases(facility_id);

CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    canonical_code TEXT,
    canonical_display TEXT,
    title TEXT,  -- 'Dr.', 'Prof.', etc.
    norm_specialty_id INTEGER REFERENCES norm_specialties(id),
    specialty_original TEXT,
    facility_id INTEGER REFERENCES facilities(id),
    phone TEXT,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctor_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    language TEXT,
    auto_mapped BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_doctor_aliases_alias ON doctor_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_doctor_aliases_fk ON doctor_aliases(doctor_id);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER REFERENCES patients(id),
    file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    doc_type TEXT,
    event_date DATE,  -- canonical timeline anchor (date the medical event happened)
    doctor_id INTEGER REFERENCES doctors(id),
    facility_id INTEGER REFERENCES facilities(id),
    issued_date DATE,  -- administrative: when the document was produced
    date_received DATE,
    summary_en TEXT,
    summary_original TEXT,
    norm_specialty_id INTEGER REFERENCES norm_specialties(id),
    specialty_original TEXT,
    insurance_company TEXT,
    insurance_policy TEXT,
    event_id INTEGER REFERENCES medical_events(id),  -- primary medical event
    notes TEXT,
    tags TEXT,  -- comma-separated user tags
    page_count INTEGER,
    file_size INTEGER,  -- bytes
    file_hash TEXT UNIQUE,  -- SHA-256 for dedup
    language_source TEXT,
    ocr_text TEXT,
    ocr_text_en TEXT,
    ocr_text_en_model TEXT,
    ocr_text_en_translated_at DATETIME,
    ocr_confidence REAL,
    ocr_engine TEXT,
    llm_provider TEXT,
    raw_extraction JSON,
    cost_amount REAL,
    cost_currency TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,  -- stores failure reason when status='failed'
    retry_count INTEGER DEFAULT 0,
    process_at DATETIME,  -- null = process immediately, set = process after this time
    uploaded_by_user_id INTEGER REFERENCES users(id),  -- who uploaded; null = legacy/unknown
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    target_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL,  -- 'invoice_for', 'report_for', 'imaging_for', 'follow_up', 'related'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_document_id, target_document_id, link_type)
);

CREATE TABLE IF NOT EXISTS lab_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    test_name_original TEXT NOT NULL,
    norm_lab_test_id INTEGER REFERENCES norm_lab_tests(id),
    value REAL,
    value_text TEXT,
    unit TEXT,
    reference_range_low REAL,
    reference_range_high REAL,
    is_abnormal BOOLEAN,
    sample_type TEXT,
    panel_name TEXT,
    test_date DATE
);

CREATE TABLE IF NOT EXISTS encounters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    doctor_id INTEGER REFERENCES doctors(id),
    facility_id INTEGER REFERENCES facilities(id),
    encounter_date DATE,
    admission_date DATE,
    discharge_date DATE,
    norm_diagnosis_id INTEGER REFERENCES norm_diagnoses(id),
    diagnosis_original TEXT,
    diagnosis_code TEXT,
    norm_specialty_id INTEGER REFERENCES norm_specialties(id),
    notes TEXT,
    findings TEXT,
    follow_up_date DATE,
    follow_up_instructions TEXT
);

CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    norm_medication_id INTEGER REFERENCES norm_medications(id),
    brand_name TEXT,
    active_ingredient_original TEXT,
    dosage TEXT,
    form TEXT,
    frequency TEXT,
    duration TEXT,
    quantity TEXT,
    prescribed_date DATE
);

CREATE TABLE IF NOT EXISTS vaccinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    vaccine_name TEXT NOT NULL,
    manufacturer TEXT,
    lot_number TEXT,
    dose_number INTEGER,
    date_administered DATE
);

CREATE TABLE IF NOT EXISTS imaging_studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    -- doctor_id / facility_id are kept in lockstep with the parent
    -- documents row via AFTER UPDATE triggers (see db/init.py). The
    -- corresponding human-readable name lives on documents → doctors /
    -- facilities and is the single source of truth.
    doctor_id INTEGER REFERENCES doctors(id),
    facility_id INTEGER REFERENCES facilities(id),
    -- 'placeholder' (no PDF report attached yet) | 'attached' (the parent
    -- documents row is a real PDF the user uploaded / linked).
    report_status TEXT NOT NULL DEFAULT 'placeholder',
    -- The study date lives on the parent ``documents.event_date`` (single
    -- source of truth for the timeline anchor).
    modality TEXT,
    body_part TEXT,
    study_description TEXT,
    accession_number TEXT,
    study_instance_uid TEXT,
    num_series INTEGER DEFAULT 0,
    num_images INTEGER DEFAULT 0,
    folder_path TEXT
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    patient_id INTEGER REFERENCES patients(id),
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_price REAL,
    amount REAL,
    currency TEXT DEFAULT 'CHF',
    tariff_code TEXT,  -- e.g. TARMED code
    tax_rate REAL,
    category TEXT,  -- 'consultation', 'procedure', 'medication', 'lab', 'imaging', 'admin', 'other'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS imaging_series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_id INTEGER NOT NULL REFERENCES imaging_studies(id) ON DELETE CASCADE,
    series_number INTEGER,
    series_description TEXT,
    modality TEXT,
    num_images INTEGER DEFAULT 0,
    series_instance_uid TEXT,
    folder_path TEXT
);

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    patient_id INTEGER REFERENCES patients(id),
    role TEXT NOT NULL,  -- 'user' or 'assistant'
    content TEXT NOT NULL,
    sources TEXT,  -- JSON list of {id, filename, doc_type, event_date} populated on assistant messages
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Normalization tables

CREATE TABLE IF NOT EXISTS norm_lab_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_code TEXT UNIQUE NOT NULL,
    canonical_display TEXT NOT NULL,
    loinc_code TEXT,
    category TEXT,
    unit_preferred TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS norm_lab_test_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    norm_lab_test_id INTEGER NOT NULL REFERENCES norm_lab_tests(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    language TEXT,
    auto_mapped BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS norm_specialties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_code TEXT UNIQUE NOT NULL,
    canonical_display TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS norm_specialty_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    norm_specialty_id INTEGER NOT NULL REFERENCES norm_specialties(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    language TEXT,
    auto_mapped BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS norm_diagnoses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_code TEXT UNIQUE NOT NULL,
    canonical_display TEXT NOT NULL,
    icd10_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS norm_diagnosis_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    norm_diagnosis_id INTEGER NOT NULL REFERENCES norm_diagnoses(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    language TEXT,
    auto_mapped BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS norm_medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_code TEXT UNIQUE NOT NULL,
    canonical_display TEXT NOT NULL,
    atc_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS norm_medication_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    norm_medication_id INTEGER NOT NULL REFERENCES norm_medications(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    language TEXT,
    auto_mapped BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Custom prompts (user-editable LLM prompts)
CREATE TABLE IF NOT EXISTS custom_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_key TEXT UNIQUE NOT NULL,  -- e.g. 'classification', 'extraction_lab_test', 'chat_system'
    prompt_text TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Medical events (central concept linking documents to medical stories)
CREATE TABLE IF NOT EXISTS medical_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    title TEXT NOT NULL,  -- e.g. "Sleep Apnea Diagnosis & Treatment"
    event_type TEXT NOT NULL,  -- 'symptom', 'diagnosis', 'hospitalization', 'surgery', 'treatment', 'follow_up', 'emergency', 'pregnancy', 'chronic_condition', 'injury', 'screening', 'other'
    description TEXT,  -- detailed description
    date_start DATE,  -- when the event started
    date_end DATE,  -- when the event ended (null if ongoing)
    is_ongoing BOOLEAN DEFAULT 0,
    severity TEXT,  -- 'mild', 'moderate', 'severe', 'critical'
    norm_diagnosis_id INTEGER REFERENCES norm_diagnoses(id),
    diagnosis_text TEXT,  -- free text diagnosis
    icd10_code TEXT,
    norm_specialty_id INTEGER REFERENCES norm_specialties(id),
    specialty_text TEXT,
    notes TEXT,  -- user notes
    color TEXT,  -- UI color for timeline (#hex)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medical_events_patient ON medical_events(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_events_type ON medical_events(event_type);
CREATE INDEX IF NOT EXISTS idx_medical_events_date ON medical_events(date_start);

-- Link documents to medical events (many-to-many)
CREATE TABLE IF NOT EXISTS document_event_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES medical_events(id) ON DELETE CASCADE,
    relevance TEXT DEFAULT 'primary',  -- 'primary', 'secondary', 'background'
    auto_linked BOOLEAN DEFAULT 0,  -- true if linked by LLM, false if by user
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_event_links_document ON document_event_links(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_event_links_event ON document_event_links(event_id);

-- Document sections (page-level sectioning for multi-page documents)
CREATE TABLE IF NOT EXISTS document_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    section_index INTEGER NOT NULL,  -- order within the document
    page_start INTEGER NOT NULL,  -- first page (1-indexed)
    page_end INTEGER NOT NULL,  -- last page (inclusive)
    section_type TEXT,  -- 'lab_results_page', 'clinical_notes', 'nursing_notes', 'vital_signs', 'consent_form', 'cover_page', 'medication_chart', 'operative_notes', 'discharge_summary', 'imaging_report', 'correspondence', 'invoice_page', 'other'
    ocr_text TEXT,
    raw_extraction JSON,
    summary_en TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_sections_document ON document_sections(document_id);

-- Per-document pipeline stage events (timeline of what each doc went through).
-- One row per stage transition. Persisted so the document detail view can show
-- a complete history across uploads, reprocesses, and partial failures.
CREATE TABLE IF NOT EXISTS document_stage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,          -- ocr | vision_extraction | llm_extraction | page_classification | section_extraction | organizing | thumbnail | cache_ocr
    status TEXT NOT NULL,         -- started | completed | failed | skipped | cancelled
    job_kind TEXT NOT NULL,       -- upload | reprocess
    message TEXT,
    page_current INTEGER,
    page_total INTEGER,
    started_at DATETIME,
    finished_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stage_events_doc ON document_stage_events(document_id, id DESC);

-- Per-document region translations. Each row represents a single
-- ad-hoc OCR + translate run on a user-selected rectangle of the PDF
-- (page + bbox in normalized [0,1] coords). Independent of the
-- whole-document translate flow, which writes to documents.ocr_text_en.
CREATE TABLE IF NOT EXISTS region_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    bbox_x REAL NOT NULL,
    bbox_y REAL NOT NULL,
    bbox_w REAL NOT NULL,
    bbox_h REAL NOT NULL,
    ocr_text TEXT,
    translated_text TEXT,
    ocr_provider_id TEXT,
    llm_provider_id TEXT,
    llm_model TEXT,
    thumbnail_path TEXT,
    target_language TEXT NOT NULL DEFAULT 'English',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_region_translations_doc
    ON region_translations(document_id, id DESC);

-- Extraction corrections (tracks user edits to LLM-extracted fields for learning)
CREATE TABLE IF NOT EXISTS extraction_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    llm_value TEXT,
    corrected_value TEXT,
    facility_id INTEGER,
    doc_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_corrections_doc ON extraction_corrections(document_id);
CREATE INDEX IF NOT EXISTS idx_corrections_facility ON extraction_corrections(facility_id);
CREATE INDEX IF NOT EXISTS idx_corrections_type ON extraction_corrections(doc_type);

-- Full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    ocr_text,
    raw_extraction,
    content='documents',
    content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, ocr_text, raw_extraction)
    VALUES (new.id, new.ocr_text, new.raw_extraction);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, ocr_text, raw_extraction)
    VALUES ('delete', old.id, old.ocr_text, old.raw_extraction);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, ocr_text, raw_extraction)
    VALUES ('delete', old.id, old.ocr_text, old.raw_extraction);
    INSERT INTO documents_fts(rowid, ocr_text, raw_extraction)
    VALUES (new.id, new.ocr_text, new.raw_extraction);
END;

-- Audit log (tracks user actions for compliance and debugging)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,  -- 'login', 'logout', 'document.create', 'document.update', 'document.delete', 'document.reprocess', 'document.download', 'patient.create', 'patient.update', 'patient.delete', 'settings.update', 'user.create', 'user.update', 'user.delete', 'access.grant', 'access.revoke'
    resource_type TEXT,  -- 'document', 'patient', 'user', 'settings', etc.
    resource_id INTEGER,
    details TEXT,  -- JSON string with additional context
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- Server-side sessions — lets admins list and revoke live logins.
-- session_id is the random token stored in the user's signed cookie;
-- the row is the source of truth for whether the session is still valid.
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    revoked_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(revoked_at, expires_at);

-- Per-user UI preferences for list views (Documents / Imaging / Lab).
-- visible_json + order_json are JSON arrays of column ids defined in the
-- frontend column registry. Defaults live in the frontend; an absent row
-- means "use defaults". Synchronizes column choices across devices.
CREATE TABLE IF NOT EXISTS user_view_prefs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    view_key TEXT NOT NULL,
    visible_json TEXT NOT NULL,
    order_json TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, view_key)
);

-- Per-page OCR text cache (avoids re-processing on reprocess/sectioning)
CREATE TABLE IF NOT EXISTS ocr_page_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,  -- 1-indexed
    ocr_text TEXT NOT NULL,
    ocr_engine TEXT,
    confidence REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_ocr_page_cache_doc ON ocr_page_cache(document_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_patient_id ON documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
-- idx_documents_event_date is created in db/init.py after the date-column
-- migration has had a chance to add event_date on legacy databases.
CREATE INDEX IF NOT EXISTS idx_documents_doctor_id ON documents(doctor_id);
CREATE INDEX IF NOT EXISTS idx_documents_facility_id ON documents(facility_id);
CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_documents_norm_specialty_id ON documents(norm_specialty_id);
CREATE INDEX IF NOT EXISTS idx_document_links_source ON document_links(source_document_id);
CREATE INDEX IF NOT EXISTS idx_document_links_target ON document_links(target_document_id);
CREATE INDEX IF NOT EXISTS idx_doctors_facility_id ON doctors(facility_id);
CREATE INDEX IF NOT EXISTS idx_doctors_norm_specialty_id ON doctors(norm_specialty_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_patient_id ON lab_results(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_test_date ON lab_results(test_date);
CREATE INDEX IF NOT EXISTS idx_lab_results_norm_id ON lab_results(norm_lab_test_id);
CREATE INDEX IF NOT EXISTS idx_encounters_patient_id ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_doctor_id ON encounters(doctor_id);
CREATE INDEX IF NOT EXISTS idx_encounters_facility_id ON encounters(facility_id);
CREATE INDEX IF NOT EXISTS idx_medications_patient_id ON medications(patient_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_patient_id ON vaccinations(patient_id);
CREATE INDEX IF NOT EXISTS idx_imaging_studies_patient_id ON imaging_studies(patient_id);
CREATE INDEX IF NOT EXISTS idx_imaging_studies_doctor_id ON imaging_studies(doctor_id);
CREATE INDEX IF NOT EXISTS idx_imaging_studies_facility_id ON imaging_studies(facility_id);
CREATE INDEX IF NOT EXISTS idx_norm_lab_test_aliases_alias ON norm_lab_test_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_norm_specialty_aliases_alias ON norm_specialty_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_norm_diagnosis_aliases_alias ON norm_diagnosis_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_norm_medication_aliases_alias ON norm_medication_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_invoice_items_document ON invoice_items(document_id);

-- ── Doctor share access ───────────────────────────────────────────
-- A "share" is a curated, read-only window onto a subset of one patient's
-- documents, granted to an outside doctor without creating a real user
-- account. The doctor proves possession of an out-of-band 6-digit OTP
-- (delivered manually by the admin) to obtain a short session.
--
-- Cookies, auth deps, and TTL rules for share sessions are deliberately
-- separate from the regular ``sessions`` table so a share token can never
-- be promoted into a normal account session.
CREATE TABLE IF NOT EXISTS document_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- sha256 of the URL token. Authoritative for lookup; the raw token
    -- in token_clear is only kept so the admin can re-copy the share URL
    -- from the dashboard without having to issue a fresh share.
    token_hash TEXT NOT NULL UNIQUE,
    -- Plaintext URL token. Same trust level as the rest of the DB — a
    -- DB read already exposes everything (PHI, audit, sessions), so
    -- adding the token does not change the threat model materially. Kept
    -- nullable for legacy rows created before this column existed.
    token_clear TEXT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    recipient_label TEXT NOT NULL,         -- "Dr. Rossi" — shown in audit log + watermark
    recipient_contact TEXT NOT NULL,       -- email/phone the admin will use to deliver OTPs
    contact_kind TEXT NOT NULL DEFAULT 'manual',  -- v1: only 'manual'; reserved: 'email','sms'
    expires_at DATETIME NOT NULL,          -- absolute share expiry (defaults to +7d at create)
    revoked_at DATETIME,
    -- Per-share provider preferences. The doctor's translate-region call
    -- uses these as fallbacks when the request doesn't override; admins
    -- pick them in the share dialog so a doctor never has to think about
    -- which OCR engine / LLM is configured. Both nullable; null falls
    -- back to the system's first-enabled provider at translate time.
    default_ocr_provider_id TEXT,
    default_llm_provider_id TEXT,
    -- How the OTP is conveyed to the doctor: 'manual' (admin reads it
    -- over the phone — see otp_clear on document_share_otps) or 'email'
    -- (sent automatically to recipient_contact; otp_clear stays NULL so
    -- not even the admin can read it back). Distinct from contact_kind,
    -- which historically described how the admin chose to label the
    -- recipient; this column drives behaviour.
    otp_delivery TEXT NOT NULL DEFAULT 'manual',
    -- Rolling counter of consecutive failed OTP verifications across
    -- successive OTP rows. Distinct from document_share_otps.attempts
    -- (which is per-code). When this reaches share.share_lockout_after_failed
    -- the share is revoked. Reset to 0 on any successful verify.
    consecutive_otp_failures INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_shares_patient ON document_shares(patient_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_active ON document_shares(revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS document_share_documents (
    share_id INTEGER NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY (share_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_document_share_documents_doc ON document_share_documents(document_id);

CREATE TABLE IF NOT EXISTS document_share_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id INTEGER NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
    -- sha256(code). Store nothing about the raw 6 digits.
    otp_hash TEXT NOT NULL,
    -- Plaintext code is held briefly here so the admin's audit view can
    -- read it back to convey to the doctor. NULLed on first verify and
    -- on TTL sweep. Acceptable risk: only admin sessions can read it.
    otp_clear TEXT,
    expires_at DATETIME NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_share_otps_share ON document_share_otps(share_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_share_sessions (
    id TEXT PRIMARY KEY,                    -- random 32-byte URL-safe id
    share_id INTEGER NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
    expires_at DATETIME NOT NULL,           -- absolute TTL, no sliding refresh
    revoked_at DATETIME,
    -- Updated on every authenticated request (and explicit heartbeat ping).
    -- Drives the idle-timeout check: a session goes inactive after
    -- ``share.idle_timeout_minutes`` of silence, freeing the single-session
    -- slot for a queued doctor. Defaulted on insert so older rows pre-
    -- migration get a sensible value.
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    client_ip TEXT,
    user_agent TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_share_sessions_share ON document_share_sessions(share_id);
CREATE INDEX IF NOT EXISTS idx_document_share_sessions_active ON document_share_sessions(revoked_at, expires_at);

-- ── Queue for the single-session-per-share constraint ────────────────────
-- A share permits exactly one live session at a time. When a second device
-- verifies an OTP while a session is already active, instead of rejecting
-- we hand back a queue token. The doctor's frontend polls /share/claim;
-- once the active session dies (logout, idle, TTL, or revocation) the
-- claim call promotes the queue entry into a real session and swaps the
-- cookie. Queue rows are short-lived: ``queue_ttl_minutes`` config (5min
-- default), so a closed waiting tab cannot hold the slot indefinitely.
CREATE TABLE IF NOT EXISTS document_share_session_queue (
    id TEXT PRIMARY KEY,                    -- sha256 of the cookie token
    share_id INTEGER NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
    expires_at DATETIME NOT NULL,           -- absolute TTL
    client_ip TEXT,
    user_agent TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_share_session_queue_share ON document_share_session_queue(share_id, expires_at);

CREATE TABLE IF NOT EXISTS document_share_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id INTEGER NOT NULL,
    session_id TEXT,
    action TEXT NOT NULL,
    document_id INTEGER,
    client_ip TEXT,
    user_agent TEXT,
    detail TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_share_audit_share ON document_share_audit(share_id, id DESC);

-- Compat view for external tooling that expects doctor_name / facility_name / patient_name
-- columns on the documents table.
CREATE VIEW IF NOT EXISTS documents_with_names AS
SELECT d.*,
       doc.name       AS doctor_name,
       f.name         AS facility_name,
       p.display_name AS patient_name,
       p.slug         AS patient_slug
FROM documents d
LEFT JOIN doctors    doc ON d.doctor_id   = doc.id
LEFT JOIN facilities f   ON d.facility_id = f.id
LEFT JOIN patients   p   ON d.patient_id  = p.id;
