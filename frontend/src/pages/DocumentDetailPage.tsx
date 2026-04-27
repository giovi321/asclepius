import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/api/client";
import { FileText, Trash2, X } from "lucide-react";
import { formatDocType, getBestDate } from "@/lib/utils";
import {
  EditableSummary, EditableFilename, OcrSection,
} from "@/components/document-detail/DocumentDetailHelpers";
import EventSelector from "@/components/document-detail/EventSelector";
import LabResultsEditor from "@/components/document-detail/LabResultsEditor";
import DocumentViewer from "@/components/document-detail/DocumentViewer";
import ReprocessMenu from "@/components/document-detail/ReprocessMenu";
import MetadataEditor from "@/components/document-detail/MetadataEditor";
import {
  EncountersSection, MedicationsSection, VaccinationsSection, DocumentSectionsList,
  ImagingStudiesSection,
} from "@/components/document-detail/ChildRecordSections";
import NotesEditor from "@/components/document-detail/NotesEditor";
import AiEditForm from "@/components/document-detail/AiEditForm";
import LinksSection from "@/components/document-detail/LinksSection";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);

  const loadDoc = async (showLoading = true) => {
    const scrollY = window.scrollY;
    if (showLoading && !doc) setLoading(true);
    const res = await api.get(`/documents/${id}`);
    setDoc(res.data);
    setLinkedDocs(res.data.links || []);
    setLoading(false);
    if (!showLoading) requestAnimationFrame(() => window.scrollTo(0, scrollY));
  };

  useEffect(() => {
    loadDoc();
  }, [id]);

  // Lightweight doc update - merges new fields without full reload (preserves scroll)
  const updateDocFields = (updated?: any) => {
    if (updated) setDoc((prev: any) => ({ ...prev, ...updated }));
  };

  const handleCancel = async () => {
    try {
      await api.post(`/documents/${id}/cancel`);
      await loadDoc();
    } catch {
      toast({ title: "Failed to cancel processing", variant: "error" });
    }
  };

  const handleRotate = async (degrees: number, pages: number[] | null) => {
    try {
      await api.post(`/documents/${id}/rotate`, { degrees, pages });
      await loadDoc(false);
    } catch (e: any) {
      toast({ title: "Rotation failed", description: e.response?.data?.detail || e.message, variant: "error" });
      throw e;
    }
  };

  // Long documents are expensive to reprocess (every page hits OCR + LLM
  // again). Give the user a chance to back out before kicking off the job.
  const handleReprocessRequested = async (): Promise<boolean> => {
    const pageCount = typeof doc?.page_count === "number" ? doc.page_count : 0;
    if (pageCount > 5) {
      const ok = await confirm({
        title: `Reprocess ${pageCount}-page document?`,
        description:
          `This document has ${pageCount} pages. Reprocessing will run OCR and the LLM on every page, which can take a while and consume tokens if you're on a paid provider. Continue?`,
        confirmText: "Reprocess",
        cancelText: "Cancel",
      });
      if (!ok) return false;
    }
    return true;
  };

  // Auto-refresh while processing
  useEffect(() => {
    if (doc?.status === "processing" || doc?.status === "pending") {
      const interval = setInterval(loadDoc, 3000);
      return () => clearInterval(interval);
    }
  }, [doc?.status]);

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete this document?",
      description: "The file will be removed from disk and all related records (lab results, encounters, medications, etc.) will be cascaded. This cannot be undone.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/documents/${id}`);
      navigate("/documents");
    } catch {
      toast({ title: "Failed to delete document", variant: "error" });
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!doc) return <div className="text-destructive">Document not found</div>;

  return (
    <div className="space-y-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <EditableFilename value={doc.original_filename} docId={doc.id} onSave={updateDocFields} />
          <p className="text-sm text-muted-foreground">
            {formatDocType(doc.doc_type)} | {getBestDate(doc) || "No date"} | {doc.patient_name || "Unclassified"}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/documents/${id}/file`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <FileText className="h-4 w-4" /> View file
          </a>
          {(doc.status === "processing" || doc.status === "pending") && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 rounded-md border border-yellow-300 px-3 py-1.5 text-sm text-yellow-600 hover:bg-yellow-50 dark:border-yellow-800 dark:hover:bg-yellow-950"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          )}
          {doc.status !== "processing" && (
            <ReprocessMenu
              docId={id!}
              onBeforeReprocess={handleReprocessRequested}
              onReprocessed={() => loadDoc(false)}
            />
          )}
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      {/* Summary */}
      <EditableSummary value={doc.summary_en} docId={doc.id} onSave={updateDocFields} />

      <DocumentSectionsList sections={doc.sections || []} />

      <div className="grid gap-6 lg:grid-cols-2 overflow-hidden">
        <div className="space-y-4 min-w-0">
          {/* Document file viewer is for PDFs / images; for DICOM bundles
              the viewer lives inside ImagingStudiesSection (right column)
              and the file itself is a folder, not a single file. */}
          {doc.doc_type !== "imaging_dicom" && (
            <DocumentViewer
              id={id!}
              filePath={doc.file_path}
              originalFilename={doc.original_filename}
              onRotate={handleRotate}
            />
          )}
          {doc.doc_type === "imaging_dicom" && (
            <ImagingStudiesSection studies={doc.imaging_studies || []} />
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <MetadataEditor doc={doc} onSave={updateDocFields} />

          <EventSelector
            docId={doc.id}
            patientId={doc.patient_id}
            currentEventId={doc.event_id}
            onUpdate={(eventId) => setDoc((prev: any) => ({ ...prev, event_id: eventId }))}
          />

          <LabResultsEditor
            docId={doc.id}
            patientId={doc.patient_id}
            docType={doc.doc_type}
            labResults={doc.lab_results || []}
            onChange={() => loadDoc(false)}
          />

          <EncountersSection encounters={doc.encounters || []} />
          <MedicationsSection medications={doc.medications || []} />
          <VaccinationsSection vaccinations={doc.vaccinations || []} />

          <NotesEditor docId={doc.id} initialNotes={doc.user_notes || ""} />
          {doc.doc_type !== "imaging_dicom" && (
            <AiEditForm docId={doc.id} onApplied={() => loadDoc(false)} />
          )}

          <LinksSection
            docId={Number(id)}
            patientId={doc.patient_id}
            links={linkedDocs}
            onLinksChange={setLinkedDocs}
          />
        </div>
      </div>

      {/* OCR section never has anything for DICOM bundles, so hide it
          entirely there to keep the page tidy. */}
      {doc.doc_type !== "imaging_dicom" && <OcrSection text={doc.ocr_text} />}
    </div>
  );
}
