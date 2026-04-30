import { useState } from "react";
import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";
import {
  Section,
  InfoRow,
  EditableField,
  EditableSearchableSelect,
  EditableCombobox,
  TechnicalDetails,
} from "@/components/document-detail/DocumentDetailHelpers";

export interface MetadataEditorProps {
  doc: any;
  onSave: (updated?: any) => void;
}

const DOC_TYPE_OPTIONS = [
  "invoice",
  "prescription",
  "specialist_report",
  "surgical_report",
  "discharge",
  "lab_test",
  "vaccination",
  "medical_certificate",
  "imaging_report",
  "other",
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
  const { toast } = useToast();
  const [markingReviewed, setMarkingReviewed] = useState(false);
  // Both legacy ``imaging_dicom`` and 0.9.6 ``imaging_report`` are imaging
  // documents — the metadata editor hides the same fields for both.
  const isImaging =
    doc.doc_type === "imaging_dicom" || doc.doc_type === "imaging_report";

  const markReviewed = async () => {
    setMarkingReviewed(true);
    try {
      await api.post(`/documents/${doc.id}/mark-reviewed`);
      // Signal the parent to re-fetch the document so it picks up the
      // new status + cleared error_message. ``onSave`` without a payload
      // is the parent's "refresh" hook (used elsewhere in the editor).
      onSave();
      toast({
        title: "Marked as reviewed",
        description: "Status set to done, review banner cleared.",
        variant: "success",
      });
    } catch (e: any) {
      toast({
        title: "Failed to mark as reviewed",
        description: e.response?.data?.detail || e.message,
        variant: "error",
      });
    } finally {
      setMarkingReviewed(false);
    }
  };

  return (
    <Section title="Document Info" sectionId="document-info">
      <InfoRow label="Status" value={doc.status} />
      {(doc.status === "failed" || doc.status === "needs_review") &&
        doc.error_message && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-3 space-y-2">
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">
              {doc.status === "failed" ? "Processing Error" : "Review Required"}
              {doc.retry_count > 0 && (
                <span className="font-normal ml-2 text-red-500">
                  ({doc.retry_count} retries)
                </span>
              )}
            </p>
            <pre className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all leading-relaxed">
              {doc.error_message}
            </pre>
            <div className="flex justify-end pt-1">
              <button
                onClick={markReviewed}
                disabled={markingReviewed}
                className="rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-red-950/30 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                title={
                  doc.status === "failed"
                    ? "Dismiss the error banner — fix anything left, mark the document as reviewed."
                    : "Confirm you've reviewed the document and the data is correct. Status flips to 'done' and the banner clears."
                }
              >
                {markingReviewed
                  ? "Marking…"
                  : doc.status === "failed"
                    ? "Dismiss & mark done"
                    : "Mark as reviewed"}
              </button>
            </div>
          </div>
        )}
      <EditableSearchableSelect
        label="Type"
        value={doc.doc_type}
        field="doc_type"
        docId={doc.id}
        onSave={onSave}
        options={DOC_TYPE_OPTIONS}
        placeholder="Search type..."
      />
      <EditableField
        label="Event Date"
        value={doc.event_date}
        field="event_date"
        type="date"
        docId={doc.id}
        onSave={onSave}
      />
      {!isImaging && (
        <EditableField
          label="Issued Date"
          value={doc.issued_date}
          field="issued_date"
          type="date"
          docId={doc.id}
          onSave={onSave}
        />
      )}
      <EditableCombobox
        label="Doctor"
        value={doc.doctor_name}
        field="doctor_name"
        docId={doc.id}
        onSave={onSave}
        normType="doctors"
        currentEntityId={doc.doctor_id}
      />
      <EditableCombobox
        label="Facility"
        value={doc.facility_name}
        field="facility_name"
        docId={doc.id}
        onSave={onSave}
        normType="facilities"
        currentEntityId={doc.facility_id}
      />
      {!isImaging && (
        <EditableCombobox
          label="Specialty"
          value={doc.specialty_display || doc.specialty_original}
          field="specialty_original"
          docId={doc.id}
          onSave={onSave}
          normType="specialties"
          currentEntityId={doc.norm_specialty_id}
        />
      )}
      {!isImaging &&
        (doc.ocr_engine ||
          doc.ocr_confidence != null ||
          doc.llm_provider ||
          doc.language_source) && (
          <TechnicalDetails
            ocrEngine={doc.ocr_engine}
            ocrConfidence={doc.ocr_confidence}
            llmProvider={doc.llm_provider}
            language={doc.language_source}
          />
        )}
    </Section>
  );
}
