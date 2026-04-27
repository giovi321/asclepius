import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "@/api/client";
import {
  ArrowLeft, FileText, Trash2, Upload, Search, X, FileX2, FileSearch,
} from "lucide-react";
import PdfViewer from "@/components/PdfViewer";
import MetadataEditor from "@/components/document-detail/MetadataEditor";
import EventSelector from "@/components/document-detail/EventSelector";
import LinksSection from "@/components/document-detail/LinksSection";
import NotesEditor from "@/components/document-detail/NotesEditor";
import { ImagingStudiesSection } from "@/components/document-detail/ChildRecordSections";
import { EditableSummary, Section } from "@/components/document-detail/DocumentDetailHelpers";
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
 * Detail page for a single imaging study. Layout mirrors
 * DocumentDetailPage exactly:
 *   left  = report PDF slot (or upload/pick fallback) + DICOM viewer
 *   right = MetadataEditor + EventSelector + NotesEditor + LinksSection
 *
 * The "study" is a child record of a parent document (the radiology
 * REPORT). When no PDF has been attached yet, the parent document is a
 * placeholder with file_path NULL — the slot offers two ways to fill it:
 * pick an existing PDF document or upload a fresh one.
 */
export default function ImagingDetailPage() {
  const { studyId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [study, setStudy] = useState<any>(null);
  const [doc, setDoc] = useState<any>(null);
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerResults, setPickerResults] = useState<any[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

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

  const openPicker = async () => {
    setShowPicker(true);
    setPickerBusy(true);
    try {
      const res = await api.get("/documents", {
        params: {
          patient_id: study?.patient_id,
          q: pickerSearch || undefined,
          limit: 30,
        },
      });
      // PDF-only — only documents whose file_path ends in .pdf or whose
      // original filename does. The backend will reject non-PDFs anyway,
      // but pre-filtering keeps the picker tidy.
      const all = Array.isArray(res.data) ? res.data : (res.data.items || []);
      const pdfs = all.filter((d: any) =>
        (d.file_path || "").toLowerCase().endsWith(".pdf")
        || (d.original_filename || "").toLowerCase().endsWith(".pdf"),
      );
      setPickerResults(pdfs);
    } catch {
      setPickerResults([]);
    } finally {
      setPickerBusy(false);
    }
  };

  const linkExistingReport = async (documentId: number) => {
    try {
      await api.post(`/imaging/${studyId}/report`, { document_id: documentId });
      setShowPicker(false);
      setPickerSearch("");
      await load();
      toast({ title: "Report attached", variant: "success" });
    } catch (e: any) {
      toast({ title: "Attach failed", description: e?.response?.data?.detail || e.message, variant: "error" });
    }
  };

  const handleUploadReport = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "Reports must be PDF", variant: "error" });
      return;
    }
    setUploadBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/imaging/${studyId}/report`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast({
        title: "Report queued",
        description: "The PDF is being processed; it will appear here when extraction finishes.",
        variant: "success",
      });
      // The doc isn't attached until the pipeline finishes; reload after a
      // short delay so the user sees status updates.
      setTimeout(() => load(), 2000);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.response?.data?.detail || e.message, variant: "error" });
    } finally {
      setUploadBusy(false);
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!study) return <div className="text-destructive">Study not found</div>;

  const reportAttached = study.report_status === "attached" && doc?.file_path;
  const headlineStudy = doc?.imaging_studies?.[0] || study;

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
            {headlineStudy?.body_part ? ` — ${headlineStudy.body_part}` : ""}
            {headlineStudy?.study_date ? ` — ${headlineStudy.study_date}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {study.patient_name || "Unclassified"}
            {study.institution_name ? ` | ${study.institution_name}` : ""}
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

      <div className="grid gap-6 lg:grid-cols-2 overflow-hidden">
        {/* Left column: report PDF slot + DICOM viewer */}
        <div className="space-y-4 min-w-0">
          {reportAttached ? (
            <Section title="Radiology report" icon={FileText}>
              <div className="rounded-lg border overflow-hidden h-[500px]">
                <PdfViewer
                  key={`pdf-${doc.id}`}
                  url={`/api/documents/${doc.id}/file`}
                  onRotate={async () => {}}
                />
              </div>
            </Section>
          ) : (
            <Section title="Radiology report" icon={FileX2}>
              <div className="rounded-lg border-2 border-dashed bg-muted/20 p-8 text-center space-y-3">
                <FileX2 className="h-10 w-10 mx-auto text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">No report attached yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload the doctor's PDF report or pick one from this patient's existing documents.
                  </p>
                </div>
                <div className="flex gap-2 justify-center flex-wrap">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadBusy}
                    className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" />
                    {uploadBusy ? "Uploading..." : "Upload PDF"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadReport(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={openPicker}
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    <FileSearch className="h-4 w-4" />
                    Pick existing PDF
                  </button>
                </div>
              </div>

              {showPicker && (
                <div className="mt-3 rounded-md border p-3 space-y-2 bg-card">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                      <input
                        autoFocus
                        type="text"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && openPicker()}
                        placeholder="Search PDFs for this patient..."
                        className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs"
                      />
                    </div>
                    <button
                      onClick={openPicker}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                    >
                      Search
                    </button>
                    <button
                      onClick={() => setShowPicker(false)}
                      className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {pickerBusy ? (
                    <p className="text-xs text-muted-foreground">Loading...</p>
                  ) : pickerResults.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No PDFs found for this patient</p>
                  ) : (
                    <div className="max-h-60 overflow-y-auto divide-y rounded-md border">
                      {pickerResults.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => linkExistingReport(d.id)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                        >
                          <FileText className="h-3 w-3 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <span className="block truncate font-medium">{d.original_filename}</span>
                            <span className="block text-muted-foreground">
                              {d.doc_type?.replace(/_/g, " ") || "no type"} | {d.event_date || "no date"}
                              {d.doctor_name && ` | ${d.doctor_name}`}
                            </span>
                          </div>
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-primary text-[10px]">
                            Attach
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* DICOM viewer + bundle files + linked docs */}
          {doc && <ImagingStudiesSection studies={doc.imaging_studies || []} />}
        </div>

        {/* Right column: same metadata stack as DocumentDetailPage */}
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
