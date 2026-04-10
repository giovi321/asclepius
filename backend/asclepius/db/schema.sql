-- Asclepius database schema
-- All tables in dependency order

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    date_of_birth DATE,
    sex TEXT,  -- 'M', 'F', 'O'
    blood_type TEXT,
    allergies TEXT,
    notes TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    insurance_company TEXT,
    insurance_number TEXT,
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
    type TEXT,  -- 'hospital', 'clinic', 'lab', 'pharmacy', 'imaging_center', 'other'
    address TEXT,
    city TEXT,
    country TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    title TEXT,  -- 'Dr.', 'Prof.', etc.
    norm_specialty_id INTEGER REFERENCES norm_specialties(id),
    specialty_original TEXT,
    facility_id INTEGER REFERENCES facilities(id),
    phone TEXT,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER REFERENCES patients(id),
    file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    doc_type TEXT,
    doc_date DATE,
    doctor_id INTEGER REFERENCES doctors(id),
    doctor_name TEXT,  -- denormalized: doctor name as extracted
    facility_id INTEGER REFERENCES facilities(id),
    facility_name TEXT,  -- denormalized: facility name as extracted
    date_issued DATE,
    date_visit DATE,
    date_received DATE,
    summary_en TEXT,
    summary_original TEXT,
    norm_specialty_id INTEGER REFERENCES norm_specialties(id),
    specialty_original TEXT,
    insurance_company TEXT,
    insurance_policy TEXT,
    notes TEXT,
    tags TEXT,  -- comma-separated user tags
    page_count INTEGER,
    file_size INTEGER,  -- bytes
    file_hash TEXT,  -- SHA-256 for dedup
    language_source TEXT,
    ocr_text TEXT,
    ocr_confidence REAL,
    ocr_engine TEXT,
    llm_provider TEXT,
    raw_extraction JSON,
    cost_amount REAL,
    cost_currency TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_patient_id ON documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_doc_date ON documents(doc_date);
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
