import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { FileText, X } from "lucide-react";
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
import ReprocessSheet from "@/components/document-detail/ReprocessMenu";
import TranslateSheet from "@/components/document-detail/TranslateMenu";
import DetailActionsMenu from "@/components/document-detail/DetailActionsMenu";
import DocumentQueueStatus from "@/components/document-detail/DocumentQueueStatus";
import MetadataEditor from "@/components/document-detail/MetadataEditor";
import {
  EncountersSection,
  MedicationsSection,
  VaccinationsSection,
  DocumentSectionsList,
} from "@/components/document-detail/ChildRecordSections";
import NotesEditor from "@/components/document-detail/NotesEditor";
import AiEditForm from "@/components/document-detail/AiEditForm";
import LinksSection from "@/components/document-detail/LinksSection";
import DocumentStageTimeline from "@/components/document-detail/DocumentStageTimeline";
import RegionTranslationsSection from "@/components/document-detail/RegionTranslationsSection";
import ShareDialog from "@/components/share/ShareDialog";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import type { NormalizedBbox } from "@/components/PdfViewer";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { usePipelineStatus } from "@/contexts/PipelineStatusContext";
import type { Document, DocumentLink } from "@/types";

// Imaging documents (``imaging_dicom`` and ``imaging_report``) share most
// of the layout but skip OCR / AI-edit features that don't apply to DICOM
// bundles.
function isImagingDoc(doc: Document | null): boolean {
  return (
    doc?.doc_type === "imaging_dicom" || doc?.doc_type === "imaging_report"
  );
}
function isImagingPlaceholder(doc: Document | null): boolean {
  return isImagingDoc(doc) && !doc?.file_path;
}

/** Full-page loading state: header bar, viewer block, three text sections.
 * Skeletons, never spinners (DESIGN.md). */
function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="h-[40dvh] w-full" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="rounded-lg border p-4">
          <SkeletonText lines={3} />
        </div>
      ))}
    </div>
  );
}

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { status: pipelineStatus } = usePipelineStatus();
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkedDocs, setLinkedDocs] = useState<DocumentLink[]>([]);

  // Header action flows, opened from DetailActionsMenu. Hosted at page
  // level so the menu (Sheet on mobile) can close before the flow opens.
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Region-translate selection state. ``selectionMode`` flips the PDF
  // viewer into draw-rectangle mode; the resolved provider IDs travel
  // with the eventual /translate-region POST so the user's choice
  // survives the round-trip from panel → PDF interaction.
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
    const res = await api.get<Document>(`/documents/${id}`);
    setDoc(res.data);
    setLinkedDocs(res.data.links || []);
    setLoading(false);
    if (!showLoading) requestAnimationFrame(() => window.scrollTo(0, scrollY));
  };

  useEffect(() => {
    loadDoc();
  }, [id]);

  // Lightweight doc update - merges new fields without full reload (preserves scroll)
  const updateDocFields = (updated?: Partial<Document>) => {
    if (updated) setDoc((prev) => (prev ? { ...prev, ...updated } : prev));
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
        description: getErrorMessage(e),
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
        description: getErrorMessage(e),
        variant: "error",
      });
    }
  };

  const handleSelectionCancel = () => {
    setSelectionMode(false);
  };

  const handleUnlinkImaging = async () => {
    const studyId = doc?.imaging_studies?.[0]?.id;
    if (!studyId) return;
    const ok = await confirm({
      title: "Unlink this report from the imaging study?",
      description:
        "The PDF stays in the patient's documents and the DICOM study stays in /imaging — only the link between them is removed. The study will fall back to a placeholder report; you can re-attach this (or any other PDF) from the imaging view.",
      variant: "destructive",
      confirmText: "Unlink",
    });
    if (!ok) return;
    try {
      await api.delete(`/imaging/${studyId}/report`);
      await loadDoc(false);
      toast({ title: "Imaging study unlinked", variant: "success" });
    } catch (e: any) {
      toast({
        title: "Unlink failed",
        description: getErrorMessage(e),
        variant: "error",
      });
    }
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

  if (loading) return <DetailSkeleton />;
  if (!doc) return <div className="text-destructive">Document not found</div>;

  const docBusy =
    doc.status === "processing" || doc.status === "pending" || inPipeline;
  const hasOcrText = !!(doc.ocr_text && doc.ocr_text.trim());
  const canSelectRegion =
    !!doc.file_path &&
    (doc.original_filename || "").toLowerCase().endsWith(".pdf");

  return (
    // flex-col + gap (instead of space-y) so mobile-only `order-*` shuffling
    // works; overflow-x-clip contains wide content without creating a scroll
    // container, which would break the sticky header below.
    <div className="flex flex-col gap-6 overflow-x-clip">
      {/* Header: filename + inline View file / Cancel, everything else in the
          overflow menu. Sticky on phones so actions stay reachable. */}
      <div className="sticky top-0 z-sticky -mx-4 flex flex-wrap items-start gap-2 bg-background/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:static lg:z-auto lg:m-0 lg:bg-transparent lg:p-0">
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
        <div className="flex flex-wrap items-center gap-2">
          {doc.file_path && (
            <a
              href={`/api/documents/${id}/file`}
              target="_blank"
              rel="noreferrer"
              aria-label="View file"
              title="View file"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:h-11 coarse:w-11"
            >
              <FileText className="h-4 w-4" />
            </a>
          )}
          {docBusy && (
            <>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 rounded-md border border-warning/40 px-3 py-1.5 text-sm text-warning hover:bg-warning-soft coarse:min-h-11"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
              <DocumentQueueStatus docId={Number(id)} />
            </>
          )}
          <DetailActionsMenu
            imagingStudyId={doc.imaging_studies?.[0]?.id ?? null}
            onUnlinkImaging={handleUnlinkImaging}
            showPipelineActions={!docBusy}
            onReprocess={() => setReprocessOpen(true)}
            onTranslate={() => setTranslateOpen(true)}
            translateDisabled={!hasOcrText && !canSelectRegion}
            translateDisabledReason="No OCR text and no PDF file to translate."
            onShare={() => setShareOpen(true)}
            shareDisabled={!doc.patient_id}
            shareDisabledReason="Assign this document to a patient before sharing"
            onDelete={handleDelete}
          />
        </div>
      </div>

      {/* Header action flows (menu items only toggle these) */}
      <ReprocessSheet
        open={reprocessOpen}
        onOpenChange={setReprocessOpen}
        docId={id!}
        onBeforeReprocess={handleReprocessRequested}
        onReprocessed={() => loadDoc(false)}
      />
      <TranslateSheet
        open={translateOpen}
        onOpenChange={setTranslateOpen}
        docId={id!}
        hasOcrText={hasOcrText}
        canSelectRegion={canSelectRegion}
        onTranslated={() => loadDoc(false)}
        onStartRegionSelection={handleStartRegionSelection}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        patientId={doc.patient_id}
        documentIds={[doc.id]}
        patientName={doc.patient_name}
        selectionLabel={
          doc.original_filename || doc.doc_type || `Document #${doc.id}`
        }
      />

      {/* Summary */}
      <EditableSummary
        value={doc.summary_en}
        docId={doc.id}
        onSave={updateDocFields}
      />

      {/* Below lg the sections list drops after the (stacked) grid so the
          viewer + metadata lead; on lg the DOM order stands. */}
      <DocumentSectionsList
        sections={doc.sections || []}
        className="order-1 lg:order-none"
      />

      <div className="grid gap-6 lg:grid-cols-2 overflow-hidden">
        <div className="space-y-4 min-w-0">
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
          {!isImagingPlaceholder(doc) && (
            <TranslatedTextSection
              text={doc.ocr_text_en}
              model={doc.ocr_text_en_model}
              translatedAt={doc.ocr_text_en_translated_at}
            />
          )}
          <RegionTranslationsSection
            docId={Number(id)}
            items={doc.region_translations || []}
            onChanged={() => loadDoc(false)}
          />
        </div>

        <div className="space-y-4 min-w-0">
          <MetadataEditor doc={doc} onSave={updateDocFields} />

          <EventSelector
            docId={doc.id}
            patientId={doc.patient_id}
            currentEventId={doc.event_id}
            onUpdate={(eventId) =>
              setDoc((prev) => (prev ? { ...prev, event_id: eventId } : prev))
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
          <AiEditForm docId={doc.id} onApplied={() => loadDoc(false)} />

          <LinksSection
            docId={Number(id)}
            patientId={doc.patient_id}
            links={linkedDocs}
            onLinksChange={setLinkedDocs}
          />
        </div>
      </div>

      {/* Pipeline stage history — shows OCR/LLM/organizing transitions
          across the original upload and any subsequent reprocesses. */}
      <DocumentStageTimeline
        documentId={doc.id}
        className="order-2 lg:order-none"
      />

      {/* OCR section: hide for placeholder imaging reports (no PDF, no
          OCR text). Real PDF reports go through OCR like any document. */}
      {!isImagingPlaceholder(doc) && (
        <OcrSection text={doc.ocr_text} className="order-2 lg:order-none" />
      )}
    </div>
  );
}
