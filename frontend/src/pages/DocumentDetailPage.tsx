import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "@/api/client";
import { FileText, Trash2, X, Image as ImageIcon } from "lucide-react";
import { formatDocType, getBestDate } from "@/lib/utils";
import {
  EditableSummary,
  EditableFilename,
  OcrSection,
  TranslatedTextSection,
} from "@/components/document-detail/DocumentDetailHelpers";
import EventSelector from "@/components/document-detail/EventSelector";
import LabResultsEditor from "@/components/document-detail/LabResultsEditor";
import DocumentViewer from "@/components/document-detail/DocumentViewer";
import ReprocessMenu from "@/components/document-detail/ReprocessMenu";
import TranslateMenu from "@/components/document-detail/TranslateMenu";
import DocumentQueueStatus from "@/components/document-detail/DocumentQueueStatus";
import MetadataEditor from "@/components/document-detail/MetadataEditor";
import {
  EncountersSection,
  MedicationsSection,
  VaccinationsSection,
  DocumentSectionsList,
} from "@/components/document-detail/ChildRecordSections";
import ReportSlot from "@/components/imaging/ReportSlot";
import NotesEditor from "@/components/document-detail/NotesEditor";
import AiEditForm from "@/components/document-detail/AiEditForm";
import LinksSection from "@/components/document-detail/LinksSection";
import DocumentStageTimeline from "@/components/document-detail/DocumentStageTimeline";
import RegionTranslationsSection from "@/components/document-detail/RegionTranslationsSection";
import type { NormalizedBbox } from "@/components/PdfViewer";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { usePipelineStatus } from "@/contexts/PipelineStatusContext";

// Imaging documents (legacy ``imaging_dicom`` and 0.9.6 ``imaging_report``)
// share most of the layout but skip OCR / AI-edit features that don't
// apply to DICOM bundles.
function isImagingDoc(doc: any): boolean {
  return (
    doc?.doc_type === "imaging_dicom" || doc?.doc_type === "imaging_report"
  );
}
function isImagingPlaceholder(doc: any): boolean {
  return isImagingDoc(doc) && !doc?.file_path;
}

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { status: pipelineStatus } = usePipelineStatus();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);

  // Region-translate selection state. ``selectionMode`` flips the PDF
  // viewer into draw-rectangle mode; the resolved provider IDs travel
  // with the eventual /translate-region POST so the user's choice
  // survives the round-trip from popover → PDF interaction.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionProviders, setSelectionProviders] = useState<{
    ocrProviderId: string | null;
    llmProviderId: string | null;
  }>({ ocrProviderId: null, llmProviderId: null });

  // Translation jobs deliberately don't flip documents.status to
  // "processing" (they are an independent side-job that doesn't disturb
  // the doc's main lifecycle). To still show the queued/running pill +
  // cancel button while a translate is in flight, derive the in-pipeline
  // flag from PipelineStatusContext rather than from doc.status alone.
  const numericId = id != null ? Number(id) : null;
  const inPipeline =
    numericId != null &&
    !!pipelineStatus &&
    (pipelineStatus.current_job?.doc_id === numericId ||
      (pipelineStatus.queued_jobs ?? []).some((j) => j.doc_id === numericId));

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
      toast({
        title: "Rotation failed",
        description: e.response?.data?.detail || e.message,
        variant: "error",
      });
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
        description: `This document has ${pageCount} pages. Reprocessing will run OCR and the LLM on every page, which can take a while and consume tokens if you're on a paid provider. Continue?`,
        confirmText: "Reprocess",
        cancelText: "Cancel",
      });
      if (!ok) return false;
    }
    return true;
  };

  // Auto-refresh while processing OR while this doc has any pipeline job
  // in flight (covers translation, which doesn't change doc.status).
  // Also fires one final reload when the in-pipeline flag flips off so
  // the freshly-written ocr_text_en / extraction lands in the UI without
  // the user having to refresh.
  const wasInPipeline = useRef(false);
  useEffect(() => {
    const docBusy = doc?.status === "processing" || doc?.status === "pending";
    const busy = docBusy || inPipeline;
    if (busy) {
      wasInPipeline.current = true;
      const interval = setInterval(loadDoc, 3000);
      return () => clearInterval(interval);
    }
    if (wasInPipeline.current) {
      wasInPipeline.current = false;
      loadDoc(false);
    }
  }, [doc?.status, inPipeline]);

  const handleStartRegionSelection = (providers: {
    ocrProviderId: string | null;
    llmProviderId: string | null;
  }) => {
    setSelectionProviders(providers);
    setSelectionMode(true);
  };

  const handleSelectionConfirm = async (page: number, bbox: NormalizedBbox) => {
    setSelectionMode(false);
    try {
      await api.post(`/documents/${id}/translate-region`, {
        page,
        bbox,
        ...(selectionProviders.ocrProviderId
          ? { ocr_provider_id: selectionProviders.ocrProviderId }
          : {}),
        ...(selectionProviders.llmProviderId
          ? { llm_provider_id: selectionProviders.llmProviderId }
          : {}),
      });
      await loadDoc(false);
    } catch (e: any) {
      toast({
        title: "Region translate failed",
        description: e.response?.data?.detail || e.message,
        variant: "error",
      });
    }
  };

  const handleSelectionCancel = () => {
    setSelectionMode(false);
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete this document?",
      description:
        "The file will be removed from disk and all related records (lab results, encounters, medications, etc.) will be cascaded. This cannot be undone.",
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
          <EditableFilename
            value={doc.original_filename}
            docId={doc.id}
            onSave={updateDocFields}
          />
          <p className="text-sm text-muted-foreground">
            {formatDocType(doc.doc_type)} | {getBestDate(doc) || "No date"} |{" "}
            {doc.patient_name || "Unclassified"}
          </p>
        </div>
        <div className="flex gap-2">
          {doc.imaging_studies?.[0]?.id && (
            <Link
              to={`/imaging/${doc.imaging_studies[0].id}`}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              title="Open the DICOM viewer for this report's imaging study"
            >
              <ImageIcon className="h-4 w-4" /> Imaging view
            </Link>
          )}
          {doc.file_path && (
            <a
              href={`/api/documents/${id}/file`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <FileText className="h-4 w-4" /> View file
            </a>
          )}
          {(doc.status === "processing" ||
            doc.status === "pending" ||
            inPipeline) && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 rounded-md border border-yellow-300 px-3 py-1.5 text-sm text-yellow-600 hover:bg-yellow-50 dark:border-yellow-800 dark:hover:bg-yellow-950"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          )}
          {doc.status === "processing" ||
          doc.status === "pending" ||
          inPipeline ? (
            <DocumentQueueStatus docId={Number(id)} />
          ) : (
            <>
              <ReprocessMenu
                docId={id!}
                onBeforeReprocess={handleReprocessRequested}
                onReprocessed={() => loadDoc(false)}
              />
              <TranslateMenu
                docId={id!}
                hasOcrText={!!(doc.ocr_text && doc.ocr_text.trim())}
                canSelectRegion={
                  !!doc.file_path &&
                  (doc.original_filename || "").toLowerCase().endsWith(".pdf")
                }
                onTranslated={() => loadDoc(false)}
                onStartRegionSelection={handleStartRegionSelection}
              />
            </>
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
      <EditableSummary
        value={doc.summary_en}
        docId={doc.id}
        onSave={updateDocFields}
      />

      <DocumentSectionsList sections={doc.sections || []} />

      <div className="grid gap-6 lg:grid-cols-2 overflow-hidden">
        <div className="space-y-4 min-w-0">
          {isImagingDoc(doc) ? (
            // Imaging documents: keep the metadata view focused on the
            // report. The DICOM viewer + bundle files live on /imaging/:id;
            // here we only render the report PDF (or upload/pick UI when
            // it is a placeholder) and a link to the imaging view.
            <ReportSlot
              studyId={doc.imaging_studies?.[0]?.id}
              patientId={doc.patient_id}
              reportStatus={doc.file_path ? "attached" : "placeholder"}
              documentId={doc.id}
              onChanged={() => loadDoc(false)}
            />
          ) : (
            <DocumentViewer
              id={id!}
              filePath={doc.file_path}
              originalFilename={doc.original_filename}
              onRotate={handleRotate}
              imagingStudyId={doc.imaging_studies?.[0]?.id || null}
              onReloaded={() => loadDoc(false)}
              selectionMode={selectionMode}
              onSelectionConfirm={handleSelectionConfirm}
              onSelectionCancel={handleSelectionCancel}
            />
          )}
          {!isImagingPlaceholder(doc) && (
            <TranslatedTextSection
              text={doc.ocr_text_en}
              model={doc.ocr_text_en_model}
              translatedAt={doc.ocr_text_en_translated_at}
            />
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <MetadataEditor doc={doc} onSave={updateDocFields} />

          <EventSelector
            docId={doc.id}
            patientId={doc.patient_id}
            currentEventId={doc.event_id}
            onUpdate={(eventId) =>
              setDoc((prev: any) => ({ ...prev, event_id: eventId }))
            }
          />

          <LabResultsEditor
            docId={doc.id}
            patientId={doc.patient_id}
            docType={doc.doc_type}
            labResults={doc.lab_results || []}
            onChange={() => loadDoc(false)}
          />

          <EncountersSection
            encounters={doc.encounters || []}
            onUpdated={() => loadDoc(false)}
          />
          <MedicationsSection
            medications={doc.medications || []}
            onUpdated={() => loadDoc(false)}
          />
          <VaccinationsSection vaccinations={doc.vaccinations || []} />

          <NotesEditor docId={doc.id} initialNotes={doc.user_notes || ""} />
          {!isImagingDoc(doc) && (
            <AiEditForm docId={doc.id} onApplied={() => loadDoc(false)} />
          )}

          <LinksSection
            docId={Number(id)}
            patientId={doc.patient_id}
            links={linkedDocs}
            onLinksChange={setLinkedDocs}
          />

          <RegionTranslationsSection
            docId={Number(id)}
            items={doc.region_translations || []}
            onChanged={() => loadDoc(false)}
          />
        </div>
      </div>

      {/* Pipeline stage history — shows OCR/LLM/organizing transitions
          across the original upload and any subsequent reprocesses. */}
      <DocumentStageTimeline documentId={doc.id} />

      {/* OCR section: hide for placeholder imaging reports (no PDF, no
          OCR text). Real PDF reports go through OCR like any document. */}
      {!isImagingPlaceholder(doc) && <OcrSection text={doc.ocr_text} />}
    </div>
  );
}
