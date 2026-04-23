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
    doctor_id INTEGER REFERENCES doctors(id),
    facility_id INTEGER REFERENCES facilities(id),
    study_date DATE,
    modality TEXT,
    body_part TEXT,
    study_description TEXT,
    institution_name TEXT,
    referring_physician TEXT,
    accession_number TEXT,
    study_instance_uid TEXT,
    num_series INTEGER DEFAULT 0,
    num_images INTEGER DEFAULT 0,
    is_dicom BOOLEAN DEFAULT 0,
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
    prompt_key TEXT UNIQUE NOT NULL,  -- e.g. 'classification', 'extraction_bloodtest', 'chat_system'
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

-- Compat view for external tooling that expects doctor_name / facility_name / patient_name
-- columns on the documents table (see issue #16).
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
