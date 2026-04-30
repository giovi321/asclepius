import { useEffect, useMemo, useState } from "react";
import { Document, Page } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import shareApi from "@/api/shareClient";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

interface ShareDocumentViewerProps {
  documentId: number;
  /** Mime type hint from the server-side response (image/* vs PDF). The
   * backend always serves PDFs untouched and rasterises images to PNG, so
   * we only need to differentiate at this granularity. */
  treatAsImage?: boolean;
}

/**
 * Read-only PDF / image viewer for the doctor share surface.
 *
 * Differences vs. the admin DocumentViewer:
 * - Fetches bytes via shareApi (cookie-bound, scoped path) into a Uint8Array
 *   that's handed straight to react-pdf — no Object URL, no `<a href>`,
 *   nothing the browser will treat as a downloadable resource.
 * - No download button, no "Open in new tab", no rotate / replace UI.
 * - Right-click and Ctrl+S/Ctrl+P are intercepted (cosmetic — a determined
 *   user can still screenshot, but we remove all easy paths).
 */
export default function ShareDocumentViewer({
  documentId,
  treatAsImage = false,
}: ShareDocumentViewerProps) {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);

  // Stable react-pdf options — deep-equal compared, so an unstable object
  // would force a full document reload.
  const docOptions = useMemo(() => ({}), []);

  useEffect(() => {
    let alive = true;
    let revokeUrl: string | null = null;

    setLoading(true);
    setError(null);
    setPdfData(null);
    setImageBlobUrl(null);

    shareApi
      .get(`/documents/${documentId}/file`, { responseType: "arraybuffer" })
      .then((res) => {
        if (!alive) return;
        const contentType = String(
          res.headers["content-type"] || "",
        ).toLowerCase();
        if (contentType.startsWith("image/")) {
          // Images can't be re-rendered into react-pdf, so we still need a
          // blob URL for the <img>. The blob is revoked on unmount and the
          // <img> has download attributes blocked + right-click suppressed.
          const blob = new Blob([res.data], {
            type: contentType || "image/png",
          });
          const url = URL.createObjectURL(blob);
          revokeUrl = url;
          setImageBlobUrl(url);
        } else {
          // react-pdf accepts a typed-array directly; we never expose a URL.
          setPdfData(new Uint8Array(res.data));
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        const status = err?.response?.status;
        if (status === 415) {
          setError("This file format is not viewable in the share view.");
        } else {
          setError("Failed to load file.");
        }
        setLoading(false);
      });

    return () => {
      alive = false;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [documentId]);

  // Block right-click + Ctrl+S/Ctrl+P on the viewer container. Cosmetic
  // hardening only — the goal is to remove the obvious save paths, not to
  // claim screenshots are impossible.
  useEffect(() => {
    const onCtx = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "s" || e.key === "S" || e.key === "p" || e.key === "P")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("contextmenu", onCtx);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", onCtx);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
        Loading file...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground space-y-2">
        <FileText className="h-10 w-10 mx-auto text-amber-500" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (treatAsImage || imageBlobUrl) {
    return (
      <div className="rounded-lg border overflow-hidden">
        <img
          src={imageBlobUrl || undefined}
          alt=""
          className="w-full object-contain max-h-[700px] select-none"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    );
  }

  if (pdfData) {
    return (
      <div className="rounded-lg border overflow-hidden h-[700px] flex flex-col">
        <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/30 gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              disabled={pageNumber <= 1}
              className="rounded p-1.5 hover:bg-accent disabled:opacity-30"
              title="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-muted-foreground min-w-[60px] text-center">
              {pageNumber} / {numPages}
            </span>
            <button
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              disabled={pageNumber >= numPages}
              className="rounded p-1.5 hover:bg-accent disabled:opacity-30"
              title="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)))
              }
              className="rounded p-1.5 hover:bg-accent"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-sm text-muted-foreground min-w-[40px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={() =>
                setScale((s) => Math.min(3.0, +(s + 0.2).toFixed(1)))
              }
              className="rounded p-1.5 hover:bg-accent"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div
          className="flex-1 overflow-auto bg-muted/20 p-4 [&>div]:mx-auto select-none"
          onContextMenu={(e) => e.preventDefault()}
        >
          <Document
            file={{ data: pdfData }}
            options={docOptions}
            onLoadSuccess={({ numPages }) => {
              setNumPages(numPages);
              setPageNumber((p) => (p > numPages ? 1 : p));
            }}
            onLoadError={() => setError("Failed to render PDF.")}
            loading={
              <div className="text-muted-foreground text-sm py-8">
                Loading PDF...
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              loading={
                <div className="text-muted-foreground text-sm py-8">
                  Rendering page...
                </div>
              }
            />
          </Document>
        </div>
      </div>
    );
  }

  return null;
}
