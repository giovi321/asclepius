import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Download, Image as ImageIcon, FileX2, Upload, Search, X } from "lucide-react";
import api from "@/api/client";
import PdfViewer from "@/components/PdfViewer";
import { useToast } from "@/contexts/ToastContext";

export interface DocumentViewerProps {
  id: number | string;
  filePath: string | null | undefined;
  originalFilename: string | null | undefined;
  onRotate: (degrees: number, pages: number[] | null) => Promise<void>;
  /** When set, this document is the parent of a DICOM imaging study —
   * the preview fallback links into the Imaging view instead of just
   * offering a download. */
  imagingStudyId?: number | null;
  /** Called after a successful relink / replace so the parent reloads
   * the document and re-mounts this viewer. */
  onReloaded?: () => void;
}

/**
 * Left-column preview on the Document Detail page. Shows a PDF viewer,
 * an image, or a download fallback depending on the file extension. When
 * the document is the parent of an imaging study, the fallback turns
 * into a "switch to the imaging view" hint with a deep link.
 */
export default function DocumentViewer({
  id, filePath, originalFilename, onRotate, imagingStudyId, onReloaded,
}: DocumentViewerProps) {
  const fp = (filePath || "").toLowerCase();
  const fn = (originalFilename || "").toLowerCase();
  const { toast } = useToast();
  // HEAD-check the file before handing it to PdfViewer / <img>; pdf.js
  // surfaces "Missing PDF" as a hard error, and a broken <img> just
  // shows the alt text. Both are a worse UX than a small recovery
  // card. The check runs only once per id.
  const [fileMissing, setFileMissing] = useState(false);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerResults, setPickerResults] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scan: when the file is missing, immediately ask the backend
  // to find candidates with a matching basename. If exactly one match,
  // auto-relink without asking. If multiple, render a list. If zero,
  // show only the picker / upload buttons.
  const tryAutoRelink = useCallback(async () => {
    setScanning(true);
    try {
      const res = await api.get(`/documents/${id}/find-candidates`);
      const list: string[] = res.data?.candidates || [];
      if (list.length === 1) {
        await api.post(`/documents/${id}/relink`, { vault_path: list[0] });
        toast({
          title: "Relinked automatically",
          description: `Found a matching file at ${list[0]}`,
          variant: "success",
        });
        setFileMissing(false);
        onReloaded?.();
        return;
      }
      setCandidates(list);
    } catch {
      setCandidates([]);
    } finally {
      setScanning(false);
    }
  }, [id, toast, onReloaded]);

  useEffect(() => {
    if (!filePath) {
      setFileMissing(true);
      tryAutoRelink();
      return;
    }
    let alive = true;
    setFileMissing(false);
    setCandidates(null);
    api.head(`/documents/${id}/file`).catch(() => {
      if (!alive) return;
      setFileMissing(true);
      tryAutoRelink();
    });
    return () => { alive = false; };
  }, [id, filePath, tryAutoRelink]);

  const relinkTo = async (vaultPath: string) => {
    setBusy(true);
    try {
      await api.post(`/documents/${id}/relink`, { vault_path: vaultPath });
      toast({ title: "Relinked", variant: "success" });
      onReloaded?.();
    } catch (e: any) {
      toast({ title: "Relink failed", description: e?.response?.data?.detail || e.message, variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openPicker = async () => {
    setShowPicker(true);
    try {
      const res = await api.get(`/documents/${id}/find-candidates`);
      // The candidates endpoint already filters out the current path.
      // Augment with a vault tree fetch so the user can browse.
      const list: string[] = res.data?.candidates || [];
      if (list.length === 0) {
        // Fall back to the full vault tree top-level.
        try {
          const t = await api.get("/vault/tree");
          // Walk the tree client-side for files only (small set; this is
          // the broken-file path so accuracy beats speed).
          const flat: string[] = [];
          const walk = (n: any) => {
            if (!n) return;
            if (n.type === "file" && n.path) flat.push(n.path);
            (n.children || []).forEach(walk);
          };
          walk(t.data);
          setPickerResults(flat);
        } catch {
          setPickerResults([]);
        }
      } else {
        setPickerResults(list);
      }
    } catch {
      setPickerResults([]);
    }
  };

  const filteredPicker = pickerResults.filter(
    (p) => !pickerSearch || p.toLowerCase().includes(pickerSearch.toLowerCase()),
  );

  const uploadReplacement = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/documents/${id}/replace-file`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast({ title: "File replaced", variant: "success" });
      onReloaded?.();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.response?.data?.detail || e.message, variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (fileMissing) {
    return (
      <div className="rounded-lg border p-6 space-y-3">
        <div className="text-center text-muted-foreground space-y-1">
          <FileX2 className="h-12 w-12 mx-auto mb-2 text-amber-500" />
          <p className="text-foreground font-medium">File not available</p>
          <p className="text-sm">
            The document record exists but the file is missing on disk
            {filePath ? <> at <code className="text-xs">{filePath}</code></> : ""}.
          </p>
          {scanning && <p className="text-xs">Scanning the vault for a matching file...</p>}
        </div>

        {/* Candidate matches found by the auto-scan. */}
        {candidates !== null && candidates.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Possible matches found in the vault — click to relink:
            </p>
            <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
              {candidates.map((c) => (
                <button
                  key={c}
                  onClick={() => relinkTo(c)}
                  disabled={busy}
                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                  <code>{c}</code>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recovery actions — always available. */}
        <div className="flex flex-wrap gap-2 justify-center">
          <button
            onClick={openPicker}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            <Search className="h-4 w-4" /> Pick file from vault
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" /> Upload replacement
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadReplacement(f);
              e.target.value = "";
            }}
          />
          {imagingStudyId && (
            <Link
              to={`/imaging/${imagingStudyId}`}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <ImageIcon className="h-4 w-4" /> Open in Imaging view
            </Link>
          )}
        </div>

        {/* Inline vault picker. Listing the whole tree client-side is
            fine for a personal vault; bigger setups can refine the
            search field. */}
        {showPicker && (
          <div className="rounded-md border p-3 space-y-2 bg-card">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Filter files..."
                  className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs"
                />
              </div>
              <button
                onClick={() => setShowPicker(false)}
                className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {filteredPicker.length === 0 ? (
              <p className="text-xs text-muted-foreground">No files match.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto divide-y rounded-md border">
                {filteredPicker.slice(0, 200).map((p) => (
                  <button
                    key={p}
                    onClick={() => relinkTo(p)}
                    disabled={busy}
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <code>{p}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (fp.endsWith(".pdf") || fn.endsWith(".pdf")) {
    return (
      <div className="rounded-lg border overflow-hidden h-[700px]">
        <PdfViewer key={`pdf-${id}`} url={`/api/documents/${id}/file`} onRotate={onRotate} />
      </div>
    );
  }
  if (fp.match(/\.(jpg|jpeg|png|tiff|tif)$/i)) {
    return (
      <div className="rounded-lg border overflow-hidden">
        <img
          src={`/api/documents/${id}/file`}
          alt={originalFilename || undefined}
          className="w-full object-contain max-h-[700px]"
        />
      </div>
    );
  }
  // Imaging-aware fallback: when this document represents the report-side
  // of a DICOM study but no PDF is attached yet (or the file just isn't
  // previewable), point the user at the Imaging view where the frames
  // and the upload-report flow live.
  if (imagingStudyId) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground space-y-2">
        <ImageIcon className="h-12 w-12 mx-auto mb-2 text-primary" />
        <p className="text-foreground font-medium">This document is the report for an imaging study</p>
        <p className="text-sm">
          Open the Imaging view to scroll through the DICOM frames, attach a PDF report,
          or change contrast on MRI series.
        </p>
        <Link
          to={`/imaging/${imagingStudyId}`}
          className="inline-flex items-center gap-1 mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <ImageIcon className="h-4 w-4" /> Open in Imaging view
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-lg border p-8 text-center text-muted-foreground">
      <FileText className="h-12 w-12 mx-auto mb-2" />
      <p>Preview not available for this file type</p>
      <a
        href={`/api/documents/${id}/file`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 mt-2 text-sm text-primary hover:underline"
      >
        <Download className="h-4 w-4" /> Download file
      </a>
    </div>
  );
}
