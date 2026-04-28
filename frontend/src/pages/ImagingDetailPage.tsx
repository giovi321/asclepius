import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "@/api/client";
import { ArrowLeft, FileText, Trash2 } from "lucide-react";
import MetadataEditor from "@/components/document-detail/MetadataEditor";
import EventSelector from "@/components/document-detail/EventSelector";
import LinksSection from "@/components/document-detail/LinksSection";
import NotesEditor from "@/components/document-detail/NotesEditor";
import { ImagingStudiesSection } from "@/components/document-detail/ChildRecordSections";
import { EditableSummary } from "@/components/document-detail/DocumentDetailHelpers";
import ReportSlot from "@/components/imaging/ReportSlot";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";

const MODALITY_LABELS: Record<string, string> = {
  CT: "CT scan", MR: "MRI", US: "Ultrasound", XR: "X-ray", CR: "X-ray (computed)",
  DX: "X-ray (digital)", MG: "Mammography", PT: "PET", NM: "Nuclear medicine",
  RF: "Fluoroscopy", OT: "Other",
};
function modalityLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return MODALITY_LABELS[code.toUpperCase()] || code;
}

/**
 * Detail page for a single imaging study. Layout:
 *
 *   header
 *   summary
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

  const [study, setStudy] = useState<any>(null);
  const [doc, setDoc] = useState<any>(null);
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!studyId) return;
    setLoading(true);
    try {
      const sRes = await api.get(`/imaging/${studyId}`);
      setStudy(sRes.data);
      if (sRes.data?.document_id) {
        const dRes = await api.get(`/documents/${sRes.data.document_id}`);
        setDoc(dRes.data);
        setLinkedDocs(dRes.data.links || []);
      }
    } catch {
      toast({ title: "Failed to load imaging study", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [studyId, toast]);

  useEffect(() => { load(); }, [load]);

  const updateDocFields = (updated?: any) => {
    if (updated) setDoc((prev: any) => ({ ...prev, ...updated }));
  };

  const handleDelete = async () => {
    if (!doc?.id) return;
    const ok = await confirm({
      title: "Delete this imaging study?",
      description: "All DICOM frames, the report PDF (if any), bundle files and related links will be removed. This cannot be undone.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      navigate("/imaging");
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.response?.data?.detail || e.message, variant: "error" });
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
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => navigate("/imaging")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-3 w-3" /> All imaging
          </button>
          <p className="text-base font-semibold truncate">
            {modalityLabel(headlineStudy?.modality)}
            {headlineStudy?.body_part ? ` - ${headlineStudy.body_part}` : ""}
            {headlineStudy?.study_date ? ` - ${headlineStudy.study_date}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
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
            className="flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      {/* Summary (editable) */}
      {doc && <EditableSummary value={doc.summary_en} docId={doc.id} onSave={updateDocFields} />}

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
                onUpdate={(eventId) => setDoc((prev: any) => ({ ...prev, event_id: eventId }))}
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
