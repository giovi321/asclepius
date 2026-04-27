import {
  Section, InfoRow, EditableField, EditableSelect, EditableCombobox,
  TechnicalDetails,
} from "@/components/document-detail/DocumentDetailHelpers";

export interface MetadataEditorProps {
  doc: any;
  onSave: (updated?: any) => void;
}

const DOC_TYPE_OPTIONS = [
  "bloodtest", "labtest_other", "prescription", "invoice", "receipt",
  "insurance_claim", "insurance_doc", "referral", "discharge",
  "specialist_report", "radiology_report", "pathology_report",
  "surgical_report", "er_report", "vaccination", "allergy", "sick_leave",
  "medical_cert", "physio_report", "dental", "ophthalmology",
  "mental_health", "consent", "advance_directive", "correspondence",
  "imaging_dicom", "other",
];

/**
 * Document Info card on the Document Detail page: status / error block,
 * type + dates + provider + specialty editable rows, plus the OCR/LLM
 * technical details disclosure.
 *
 * Renders the SAME fields for every document, including imaging studies
 * (DICOM bundles) — the user wanted full metadata parity. Fields that
 * never make sense for a given doc_type are gated below: Issued Date,
 * Specialty, Language, and the OCR/LLM technical block are hidden for
 * ``imaging_dicom`` because that pipeline does not produce them.
 */
export default function MetadataEditor({ doc, onSave }: MetadataEditorProps) {
  const isImaging = doc.doc_type === "imaging_dicom";
  return (
    <Section title="Document Info">
      <InfoRow label="Status" value={doc.status} />
      {(doc.status === "failed" || doc.status === "needs_review") && doc.error_message && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400">
            {doc.status === "failed" ? "Processing Error" : "Review Required"}
            {doc.retry_count > 0 && (
              <span className="font-normal ml-2 text-red-500">({doc.retry_count} retries)</span>
            )}
          </p>
          <pre className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all leading-relaxed">
            {doc.error_message}
          </pre>
        </div>
      )}
      <EditableSelect label="Type" value={doc.doc_type} field="doc_type" docId={doc.id} onSave={onSave}
        options={DOC_TYPE_OPTIONS} />
      <EditableField label="Event Date" value={doc.event_date} field="event_date" type="date" docId={doc.id} onSave={onSave} />
      {!isImaging && (
        <EditableField label="Issued Date" value={doc.issued_date} field="issued_date" type="date" docId={doc.id} onSave={onSave} />
      )}
      <EditableCombobox label="Doctor" value={doc.doctor_name} field="doctor_name" docId={doc.id} onSave={onSave} normType="doctors" />
      <EditableCombobox label="Facility" value={doc.facility_name} field="facility_name" docId={doc.id} onSave={onSave} normType="facilities" />
      {!isImaging && (
        <EditableCombobox label="Specialty" value={doc.specialty_display || doc.specialty_original} field="specialty_original" docId={doc.id} onSave={onSave} normType="specialties" />
      )}
      {!isImaging && (
        <InfoRow label="Language" value={doc.language_source} />
      )}
      {!isImaging && (doc.ocr_engine || doc.ocr_confidence != null || doc.llm_provider) && (
        <TechnicalDetails
          ocrEngine={doc.ocr_engine}
          ocrConfidence={doc.ocr_confidence}
          llmProvider={doc.llm_provider}
        />
      )}
    </Section>
  );
}
