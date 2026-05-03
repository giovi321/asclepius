import { useRef, useState } from "react";
import api from "@/api/client";
import {
  FileText,
  FileX2,
  Upload,
  Search,
  X,
  FileSearch,
  Replace,
  Unlink,
} from "lucide-react";
import PdfViewer from "@/components/PdfViewer";
import { Section } from "@/components/document-detail/DocumentDetailHelpers";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";

export interface ReportSlotProps {
  /** The imaging study id (from imaging_studies.id). */
  studyId: number;
  /** The patient owning this study (used to scope the picker). */
  patientId: number | null;
  /** When ``attached``, render the PDF viewer; when ``placeholder``, render the upload/pick UI. */
  reportStatus: "placeholder" | "attached";
  /** The parent documents.id — used to render the PDF when attached. */
  documentId: number | null;
  /** Optional callback fired after a successful attach so the parent can reload. */
  onChanged?: () => void;
}

/**
 * Shared "Radiology report" slot used on both /imaging/{id} and the
 * imaging-flavoured /documents/{id} detail page. Keeps the UX identical:
 * if a PDF report is attached the slot renders an inline PDF viewer; if
 * only a placeholder exists the slot offers two ways to populate it
 * (upload a fresh PDF or pick an already-uploaded PDF for this patient).
 */
export default function ReportSlot({
  studyId,
  patientId,
  reportStatus,
  documentId,
  onChanged,
}: ReportSlotProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<"attach" | "replace">("attach");
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerResults, setPickerResults] = useState<any[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  const openPicker = async (mode: "attach" | "replace" = "attach") => {
    setPickerMode(mode);
    setShowPicker(true);
    setPickerBusy(true);
    try {
      const res = await api.get("/documents", {
        params: {
          patient_id: patientId,
          q: pickerSearch || undefined,
          limit: 30,
        },
      });
      const all = Array.isArray(res.data) ? res.data : res.data.items || [];
      const pdfs = all.filter(
        (d: any) =>
          (d.file_path || "").toLowerCase().endsWith(".pdf") ||
          (d.original_filename || "").toLowerCase().endsWith(".pdf"),
      );
      setPickerResults(pdfs);
    } catch {
      setPickerResults([]);
    } finally {
      setPickerBusy(false);
    }
  };

  const linkExisting = async (docId: number) => {
    try {
      await api.post(`/imaging/${studyId}/report`, { document_id: docId });
      setShowPicker(false);
      setPickerSearch("");
      onChanged?.();
      toast({
        title: pickerMode === "replace" ? "Report replaced" : "Report attached",
        variant: "success",
      });
    } catch (e: any) {
      toast({
        title: pickerMode === "replace" ? "Replace failed" : "Attach failed",
        description: e?.response?.data?.detail || e.message,
        variant: "error",
      });
    }
  };

  const handleDetach = async () => {
    const ok = await confirm({
      title: "Detach this report?",
      description:
        "The PDF document stays in the patient's documents list — only its link to this imaging study is removed. You can re-attach it (or a different one) anytime.",
      variant: "destructive",
      confirmText: "Detach",
    });
    if (!ok) return;
    try {
      await api.delete(`/imaging/${studyId}/report`);
      onChanged?.();
      toast({ title: "Report detached", variant: "success" });
    } catch (e: any) {
      toast({
        title: "Detach failed",
        description: e?.response?.data?.detail || e.message,
        variant: "error",
      });
    }
  };

  const handleUpload = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "Reports must be PDF", variant: "error" });
      return;
    }
    setUploadBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post(`/imaging/${studyId}/report`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data?.duplicate) {
        toast({
          title: "Already in the system",
          description:
            res.data?.message ||
            "This PDF was already uploaded; it has been linked to this imaging study.",
          variant: "success",
        });
        onChanged?.();
      } else {
        toast({
          title: "Report queued",
          description:
            "The PDF is being processed; it will appear here when extraction finishes.",
          variant: "success",
        });
        // Pipeline runs OCR + LLM; reload after a short delay so the user
        // sees status updates as they land.
        setTimeout(() => onChanged?.(), 2000);
      }
    } catch (e: any) {
      toast({
        title: "Upload failed",
        description: e?.response?.data?.detail || e.message,
        variant: "error",
      });
    } finally {
      setUploadBusy(false);
    }
  };

  if (reportStatus === "attached" && documentId) {
    return (
      <Section title="Radiology report" icon={FileText}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button
            onClick={() => replaceInputRef.current?.click()}
            disabled={uploadBusy}
            className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
            title="Upload a different PDF and replace the current one"
          >
            <Upload className="h-3 w-3" />
            {uploadBusy ? "Uploading..." : "Replace with PDF"}
          </button>
          <input
            ref={replaceInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => openPicker("replace")}
            className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
            title="Pick a different existing PDF"
          >
            <Replace className="h-3 w-3" />
            Pick different PDF
          </button>
          <button
            onClick={handleDetach}
            className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-destructive/10 hover:text-destructive ml-auto"
            title="Remove the report from this study (the PDF stays in documents)"
          >
            <Unlink className="h-3 w-3" />
            Detach
          </button>
        </div>
        <div className="rounded-lg border overflow-hidden h-[500px]">
          <PdfViewer
            key={`pdf-${documentId}`}
            url={`/api/documents/${documentId}/file`}
            onRotate={async (degrees, pages) => {
              try {
                await api.post(`/documents/${documentId}/rotate`, {
                  degrees,
                  pages,
                });
                onChanged?.();
              } catch (e: any) {
                toast({
                  title: "Rotate failed",
                  description: e?.response?.data?.detail || e.message,
                  variant: "error",
                });
              }
            }}
          />
        </div>
        {showPicker && pickerMode === "replace" && (
          <div className="mt-3 rounded-md border p-3 space-y-2 bg-card">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && openPicker("replace")}
                  placeholder="Search PDFs for this patient..."
                  className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs"
                />
              </div>
              <button
                onClick={() => openPicker("replace")}
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
              <p className="text-xs text-muted-foreground">
                No PDFs found for this patient
              </p>
            ) : (
              <div className="max-h-60 overflow-y-auto divide-y rounded-md border">
                {pickerResults
                  .filter((d: any) => d.id !== documentId)
                  .map((d) => (
                    <button
                      key={d.id}
                      onClick={() => linkExisting(d.id)}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                    >
                      <FileText className="h-3 w-3 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="block truncate font-medium">
                          {d.original_filename}
                        </span>
                        <span className="block text-muted-foreground">
                          {d.doc_type?.replace(/_/g, " ") || "no type"} |{" "}
                          {d.event_date || "no date"}
                          {d.doctor_name && ` | ${d.doctor_name}`}
                        </span>
                      </div>
                      <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-primary text-[10px]">
                        Use this
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </Section>
    );
  }

  return (
    <Section title="Radiology report" icon={FileX2}>
      <div className="rounded-lg border-2 border-dashed bg-muted/20 p-8 text-center space-y-3">
        <FileX2 className="h-10 w-10 mx-auto text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">No report attached yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload the doctor's PDF report or pick one from this patient's
            existing documents.
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
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => openPicker("attach")}
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <FileSearch className="h-4 w-4" />
            Pick existing PDF
          </button>
        </div>
      </div>

      {showPicker && pickerMode === "attach" && (
        <div className="mt-3 rounded-md border p-3 space-y-2 bg-card">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && openPicker("attach")}
                placeholder="Search PDFs for this patient..."
                className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs"
              />
            </div>
            <button
              onClick={() => openPicker("attach")}
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
            <p className="text-xs text-muted-foreground">
              No PDFs found for this patient
            </p>
          ) : (
            <div className="max-h-60 overflow-y-auto divide-y rounded-md border">
              {pickerResults.map((d) => (
                <button
                  key={d.id}
                  onClick={() => linkExisting(d.id)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                >
                  <FileText className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="block truncate font-medium">
                      {d.original_filename}
                    </span>
                    <span className="block text-muted-foreground">
                      {d.doc_type?.replace(/_/g, " ") || "no type"} |{" "}
                      {d.event_date || "no date"}
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
  );
}
