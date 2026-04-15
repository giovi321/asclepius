// ─── Shared type definitions for Asclepius frontend ───

// ─── Document ──────────────────────────────────────────

export type DocumentStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "needs_review"
  | "cancelled";

export interface Document {
  id: number;
  patient_id: number | null;
  patient_name: string | null;
  patient_slug: string | null;
  file_path: string;
  original_filename: string;
  doc_type: string | null;
  doc_date: string | null;
  date_visit: string | null;
  date_issued: string | null;
  date_received: string | null;
  doctor_id: number | null;
  doctor_name: string | null;
  facility_id: number | null;
  facility_name: string | null;
  summary_en: string | null;
  summary_original: string | null;
  norm_specialty_id: number | null;
  specialty_original: string | null;
  insurance_company: string | null;
  insurance_policy: string | null;
  event_id: number | null;
  notes: string | null;
  user_notes: string | null;
  tags: string | null;
  page_count: number | null;
  file_size: number | null;
  file_hash: string | null;
  language_source: string | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  ocr_engine: string | null;
  llm_provider: string | null;
  raw_extraction: unknown;
  cost_amount: number | null;
  cost_currency: string | null;
  status: DocumentStatus;
  error_message: string | null;
  retry_count: number;
  process_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields from related tables
  links?: DocumentLink[];
  sections?: DocumentSection[];
  lab_results?: LabResult[];
  medications?: Medication[];
  diagnoses?: Diagnosis[];
  imaging_studies?: ImagingStudy[];
  vaccinations?: Vaccination[];
  invoice_items?: InvoiceItem[];
}

export interface DocumentLink {
  id: number;
  source_document_id: number;
  target_document_id: number;
  link_type: string;
  // Joined fields
  original_filename?: string;
  doc_type?: string;
  doc_date?: string | null;
}

export interface DocumentSection {
  id: number;
  document_id: number;
  page_number: number;
  section_type: string;
  title: string | null;
  content: string | null;
}

// ─── Pipeline ──────────────────────────────────────────

export interface PipelineStatus {
  queue_depth: number;
  processing: string | null;
  processing_step: string | null;
  processing_doc_id: number | null;
  processing_pages: number | null;
  processing_page_current: number | null;
  total_processed: number;
  total_errors: number;
  recent_errors: { file: string; error: string }[];
  queued_files: { filename: string; size: number }[];
  watcher_active: boolean;
  auto_stopped: boolean;
  auto_stop_reason: string;
}

// ─── Providers ─────────────────────────────────────────

export interface LlmProvider {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  priority: number;
  base_url: string;
  model: string;
  api_key: string;
  timeout: number;
  has_api_key?: boolean;
}

export interface OcrProvider {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  priority: number;
  language: string;
  remote_url: string;
  remote_api_key: string;
  llm_provider: string;
  llm_model: string;
  llm_base_url: string;
  llm_api_key: string;
  google_vision_key: string;
  confidence_threshold: number;
  has_remote_api_key?: boolean;
  has_llm_api_key?: boolean;
  has_google_vision_key?: boolean;
}

// ─── Patient ───────────────────────────────────────────

export interface Patient {
  id: number;
  slug: string;
  display_name: string;
}

// ─── Medical Event ─────────────────────────────────────

export interface MedicalEvent {
  id: number;
  patient_id: number;
  title: string;
  event_type: string;
  description: string | null;
  date_start: string | null;
  date_end: string | null;
  is_ongoing: boolean;
  severity: string | null;
  norm_diagnosis_id: number | null;
  diagnosis_text: string | null;
  icd10_code: string | null;
  notes: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Lab Results ───────────────────────────────────────

export interface LabResult {
  id: number;
  document_id: number;
  patient_id: number;
  test_name_original: string;
  norm_lab_test_id: number | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  reference_range_low: number | null;
  reference_range_high: number | null;
  is_abnormal: boolean | null;
  sample_type: string | null;
  panel_name: string | null;
  test_date: string | null;
}

// ─── Imaging ───────────────────────────────────────────

export interface ImagingStudy {
  id: number;
  document_id: number;
  patient_id: number;
  doctor_id: number | null;
  facility_id: number | null;
  study_date: string | null;
  modality: string | null;
  body_part: string | null;
  study_description: string | null;
  institution_name: string | null;
  referring_physician: string | null;
  accession_number: string | null;
  study_instance_uid: string | null;
  num_series: number;
  num_images: number;
  is_dicom: boolean;
  folder_path: string | null;
  series?: ImagingSeries[];
}

export interface ImagingSeries {
  id: number;
  study_id: number;
  series_number: number | null;
  series_description: string | null;
  modality: string | null;
  num_images: number;
  series_instance_uid: string | null;
  folder_path: string | null;
}

// ─── Medications ───────────────────────────────────────

export interface Medication {
  id: number;
  document_id: number;
  patient_id: number;
  norm_medication_id: number | null;
  brand_name: string | null;
  active_ingredient_original: string | null;
  dosage: string | null;
  form: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  prescribed_date: string | null;
}

// ─── Vaccinations ──────────────────────────────────────

export interface Vaccination {
  id: number;
  document_id: number;
  patient_id: number;
  vaccine_name: string;
  manufacturer: string | null;
  lot_number: string | null;
  dose_number: number | null;
  date_administered: string | null;
}

// ─── Diagnoses (from encounters) ───────────────────────

export interface Diagnosis {
  id: number;
  document_id: number;
  patient_id: number;
  diagnosis_original: string | null;
  diagnosis_code: string | null;
  norm_diagnosis_id: number | null;
}

// ─── Invoice Items ─────────────────────────────────────

export interface InvoiceItem {
  id: number;
  document_id: number;
  patient_id: number | null;
  description: string;
  quantity: number;
  unit_price: number | null;
  amount: number | null;
  currency: string;
  tariff_code: string | null;
  tax_rate: number | null;
  category: string | null;
}
