import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { ArrowLeft, FileText, Trash2 } from "lucide-react";
import MetadataEditor from "@/components/document-detail/MetadataEditor";
import EventSelector from "@/components/document-detail/EventSelector";
import LinksSection from "@/components/document-detail/LinksSection";
import NotesEditor from "@/components/document-detail/NotesEditor";
import { ImagingStudiesSection } from "@/components/document-detail/ChildRecordSections";
import ReportSlot from "@/components/imaging/ReportSlot";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import type { Document, DocumentLink } from "@/types";

const MODALITY_LABELS: Record<string, string> = {
  CT: "CT scan",
  MR: "MRI",
  US: "Ultrasound",
  XR: "X-ray",
  CR: "X-ray (computed)",
  DX: "X-ray (digital)",
  MG: "Mammography",
  PT: "PET",
  NM: "Nuclear medicine",
  RF: "Fluoroscopy",
  OT: "Other",
};
function modalityLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return MODALITY_LABELS[code.toUpperCase()] || code;
}

/** Title-case DICOM-source strings ("ABDOMEN" → "Abdomen") that arrive
 * in ALL CAPS from the source. Mixed-case strings the user already
 * curated are left alone. */
function niceCase(s: string | null | undefined): string {
  if (!s) return "";
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (!letters) return s;
  const upperRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
  if (upperRatio < 0.7) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/**
 * Detail page for a single imaging study. Layout:
 *
 *   header
 *   ImagingStudiesSection — full-width row with the DICOM viewer; the
 *                            viewer needs the whole page width to be
 *                            useful for clinicians.
 *   2-column grid:
 *     left  = report PDF slot (or upload/pick UI when no report attached)
 *     right = MetadataEditor + EventSelector + NotesEditor + LinksSection
 *
 * The report PDF slot is the same shared ``ReportSlot`` component used
 * by /documents/{id} for imaging documents, so the experience is
 * identical from either entry point.
 */
export default function ImagingDetailPage() {
  const { studyId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();

  // TODO: type once backend exposes schema — the /imaging/{study_id}
  // detail response is a dict with joined fields (report_status,
  // patient_name, num_series/num_images) that has no generated schema type.
  const [study, setStudy] = useState<any>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [linkedDocs, setLinkedDocs] = useState<DocumentLink[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!studyId) return;
    setLoading(true);
    try {
      const sRes = await api.get(`/imaging/${studyId}`);
      setStudy(sRes.data);
      if (sRes.data?.document_id) {
        const dRes = await api.get<Document>(
          `/documents/${sRes.data.document_id}`,
        );
        setDoc(dRes.data);
        setLinkedDocs(dRes.data.links || []);
      }
    } catch {
      toast({ title: "Failed to load imaging study", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [studyId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const updateDocFields = (updated?: Partial<Document>) => {
    if (updated) setDoc((prev) => (prev ? { ...prev, ...updated } : prev));
  };

  const handleDelete = async () => {
    if (!doc?.id) return;
    const ok = await confirm({
      title: "Delete this imaging study?",
      description:
        "All DICOM frames, the report PDF (if any), bundle files and related links will be removed. This cannot be undone.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      navigate("/imaging");
    } catch (e: any) {
      toast({
        title: "Delete failed",
        description: getErrorMessage(e),
        variant: "error",
      });
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!study) return <div className="text-destructive">Study not found</div>;

  const headlineStudy = doc?.imaging_studies?.[0] || study;
  const reportStatus: "placeholder" | "attached" =
    study.report_status === "attached" ? "attached" : "placeholder";

  return (
    <div className="space-y-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => navigate("/imaging")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-3 w-3" /> All imaging
          </button>
          <p className="text-base font-semibold truncate">
            {modalityLabel(headlineStudy?.modality)}
            {headlineStudy?.body_part
              ? ` - ${niceCase(headlineStudy.body_part)}`
              : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {/* Date lives on the parent ``documents.event_date`` (single
                source of truth). Falls back to the study row's
                aliased ``study_date`` for older payloads. */}
            {(doc?.event_date || study.study_date) ?? "Unknown date"}
            {" | "}
            {study.patient_name || "Unclassified"}
            {" | "}
            {study.num_series} series, {study.num_images} images
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {doc?.id && (
            <Link
              to={`/documents/${doc.id}`}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <FileText className="h-4 w-4" /> Document view
            </Link>
          )}
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 coarse:min-h-11"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      {/* Full-width DICOM viewer + bundle files + linked-imaging docs.
          Clinicians need every pixel they can get for frame review;
          constraining this to a column is unusable for cross-sectional
          modalities. */}
      {doc && (
        <ImagingStudiesSection
          studies={doc.imaging_studies || []}
          onUpdated={load}
        />
      )}

      {/* Report PDF + metadata stack — same shape as DocumentDetailPage. */}
      <div className="grid gap-6 lg:grid-cols-2 overflow-hidden">
        <div className="space-y-4 min-w-0">
          {doc && (
            <ReportSlot
              studyId={Number(studyId)}
              patientId={study.patient_id}
              reportStatus={reportStatus}
              documentId={doc.id}
              onChanged={load}
            />
          )}
        </div>

        <div className="space-y-4 min-w-0">
          {doc && (
            <>
              <MetadataEditor doc={doc} onSave={updateDocFields} />
              <EventSelector
                docId={doc.id}
                patientId={doc.patient_id}
                currentEventId={doc.event_id}
                onUpdate={(eventId) =>
                  setDoc((prev) => (prev ? { ...prev, event_id: eventId } : prev))
                }
              />
              <NotesEditor docId={doc.id} initialNotes={doc.user_notes || ""} />
              <LinksSection
                docId={doc.id}
                patientId={doc.patient_id}
                links={linkedDocs}
                onLinksChange={setLinkedDocs}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
