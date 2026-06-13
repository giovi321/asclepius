export interface LabRow {
  id: number;
  document_id: number | null;
  document_filename: string | null;
  document_doc_type: string | null;
  document_event_date: string | null;
  document_missing: number; // SQLite returns 0/1
  patient_id: number;
  test_name_original: string;
  test_name_canonical: string | null;
  canonical_code: string | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  reference_range_low: number | null;
  reference_range_high: number | null;
  is_abnormal: number | null;
  sample_type: string | null;
  panel_name: string | null;
  test_date: string | null;
}
