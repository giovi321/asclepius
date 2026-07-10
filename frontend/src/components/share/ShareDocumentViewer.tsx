import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import shareApi from "@/api/shareClient";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "@/lib/pdfWorker";

/** Bbox in normalised [0,1] page coordinates. Mirrors the admin
 * PdfViewer's NormalizedBbox so backend payloads match. */
export interface NormalizedBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ShareDocumentViewerProps {
  documentId: number;
  treatAsImage?: boolean;
  /** When true, click-and-drag draws a selection rectangle on the
   * current page instead of panning. */
  selectionMode?: boolean;
  /** Called with the current page number whenever the doctor changes
   * page. The parent uses this to know which page to translate when
   * the doctor picks "Translate current page". */
  onPageChange?: (page: number) => void;
  /** Fired when the doctor confirms a region selection. Bbox is in
   * normalised [0,1] page coords. */
  onSelectionConfirm?: (page: number, bbox: NormalizedBbox) => void;
  /** Fired when the doctor cancels selection mode (Esc or X button). */
  onSelectionCancel?: () => void;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const WHEEL_ZOOM_STEP = 0.1;
const BUTTON_ZOOM_STEP = 0.2;

/**
 * Read-only PDF / image viewer for the doctor share surface.
 *
 * vs. the admin DocumentViewer:
 * - Bytes fetched via shareApi (cookie-bound) into a Uint8Array; never
 *   exposed as a URL the browser would treat as downloadable.
 * - No download button, no rotate / replace UI.
 * - Right-click + Ctrl+S/Ctrl+P intercepted (cosmetic).
 * - Click-and-drag pan, Ctrl+wheel zoom, Ctrl+= / Ctrl+- / Ctrl+0.
 * - Optional selection mode (drag a rectangle for region-translate),
 *   driven by the parent so the translate menu can flip it on / off.
 */
export default function ShareDocumentViewer({
  documentId,
  treatAsImage = false,
  selectionMode = false,
  onPageChange,
  onSelectionConfirm,
  onSelectionCancel,
}: ShareDocumentViewerProps) {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);

  const [isPanning, setIsPanning] = useState(false);
  const panOriginRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  // Selection rectangle in page-local pixels. ``drawingRect`` is the
  // in-flight drag; ``lockedRect`` is what stays after mouseup so the
  // confirm/cancel toolbar can render without flicker.
  type SelectionRect = { x: number; y: number; w: number; h: number };
  const [drawingRect, setDrawingRect] = useState<SelectionRect | null>(null);
  const [lockedRect, setLockedRect] = useState<SelectionRect | null>(null);
  const drawOriginRef = useRef<{ x: number; y: number } | null>(null);

  const docOptions = useMemo(() => ({}), []);
  const fileProp = useMemo(
    () => (pdfData ? { data: pdfData } : null),
    [pdfData],
  );

  // Tell the parent which page the doctor is currently looking at, so
  // the translate menu's "current page" option knows what to send.
  useEffect(() => {
    onPageChange?.(pageNumber);
  }, [pageNumber, onPageChange]);

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
          const blob = new Blob([res.data], {
            type: contentType || "image/png",
          });
          const url = URL.createObjectURL(blob);
          revokeUrl = url;
          setImageBlobUrl(url);
        } else {
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

  // Ctrl+wheel zoom. Native non-passive listener so preventDefault
  // works (React's synthetic onWheel is passive).
  //
  // The dep on ``pdfData`` matters: this effect ran on mount when the
  // container hadn't been rendered yet (we show a Loading div first).
  // Without re-running after the PDF arrives we never bound to the
  // real container and ctrl+scroll silently did nothing.
  useEffect(() => {
    if (!pdfData) return;
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP;
      setScale((s) => clampZoom(s + delta));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [pdfData]);

  // Ctrl++ / Ctrl+- / Ctrl+0 keyboard shortcuts.
  useEffect(() => {
    if (!pdfData) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setScale((s) => clampZoom(s + BUTTON_ZOOM_STEP));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setScale((s) => clampZoom(s - BUTTON_ZOOM_STEP));
      } else if (e.key === "0") {
        e.preventDefault();
        setScale(1.0);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pdfData]);

  // Reset selection state when the user changes pages or exits mode.
  useEffect(() => {
    setDrawingRect(null);
    setLockedRect(null);
    drawOriginRef.current = null;
  }, [pageNumber, selectionMode]);

  // Esc cancels selection mode.
  useEffect(() => {
    if (!selectionMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawingRect(null);
        setLockedRect(null);
        drawOriginRef.current = null;
        onSelectionCancel?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectionMode, onSelectionCancel]);

  const handleSelectionStart = useCallback(
    (e: React.MouseEvent) => {
      if (!selectionMode) return;
      if (e.button !== 0) return;
      const wrapper = pageWrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      drawOriginRef.current = { x, y };
      setDrawingRect({ x, y, w: 0, h: 0 });
      setLockedRect(null);
      e.preventDefault();
      e.stopPropagation();
    },
    [selectionMode],
  );

  useEffect(() => {
    if (!drawingRect) return;
    const onMove = (e: MouseEvent) => {
      const origin = drawOriginRef.current;
      const wrapper = pageWrapperRef.current;
      if (!origin || !wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const cx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const cy = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const x = Math.min(origin.x, cx);
      const y = Math.min(origin.y, cy);
      const w = Math.abs(cx - origin.x);
      const h = Math.abs(cy - origin.y);
      setDrawingRect({ x, y, w, h });
    };
    const onUp = () => {
      const final = drawingRect;
      drawOriginRef.current = null;
      setDrawingRect(null);
      // Ignore tiny click-without-drag rectangles.
      if (final && final.w >= 6 && final.h >= 6) {
        setLockedRect(final);
      } else {
        setLockedRect(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drawingRect]);

  const confirmSelection = () => {
    const wrapper = pageWrapperRef.current;
    const rect = lockedRect;
    if (!wrapper || !rect) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    if (wrapperRect.width <= 0 || wrapperRect.height <= 0) return;
    const bbox: NormalizedBbox = {
      x: rect.x / wrapperRect.width,
      y: rect.y / wrapperRect.height,
      w: rect.w / wrapperRect.width,
      h: rect.h / wrapperRect.height,
    };
    setLockedRect(null);
    onSelectionConfirm?.(pageNumber, bbox);
  };

  const cancelSelection = () => {
    setLockedRect(null);
    setDrawingRect(null);
    drawOriginRef.current = null;
    onSelectionCancel?.();
  };

  const activeRect = lockedRect ?? drawingRect;

  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
      // Don't pan while drawing a selection rectangle.
      if (selectionMode) return;
      if (e.button !== 0) return;
      const el = containerRef.current;
      if (!el) return;
      panOriginRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      };
      setIsPanning(true);
      e.preventDefault();
    },
    [selectionMode],
  );

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      const origin = panOriginRef.current;
      const el = containerRef.current;
      if (!origin || !el) return;
      el.scrollLeft = origin.scrollLeft - (e.clientX - origin.x);
      el.scrollTop = origin.scrollTop - (e.clientY - origin.y);
    };
    const onUp = () => {
      setIsPanning(false);
      panOriginRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

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
              onClick={() => setScale((s) => clampZoom(s - BUTTON_ZOOM_STEP))}
              className="rounded p-1.5 hover:bg-accent"
              title="Zoom out (Ctrl+- or Ctrl+scroll)"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={() => setScale(1.0)}
              className="text-sm text-muted-foreground min-w-[44px] text-center hover:text-foreground transition-colors"
              title="Reset zoom (Ctrl+0)"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              onClick={() => setScale((s) => clampZoom(s + BUTTON_ZOOM_STEP))}
              className="rounded p-1.5 hover:bg-accent"
              title="Zoom in (Ctrl++ or Ctrl+scroll)"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>

        {selectionMode && (
          <div className="flex items-center justify-between gap-2 border-b bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
            <span>
              Click and drag on page {pageNumber} to select a region. Press Esc
              to cancel.
            </span>
            <button
              onClick={cancelSelection}
              className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              title="Cancel selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div
          ref={containerRef}
          onMouseDown={handlePanStart}
          className={`flex-1 overflow-auto bg-muted/20 p-4 [&>div]:mx-auto select-none ${
            selectionMode
              ? "cursor-crosshair"
              : isPanning
                ? "cursor-grabbing [&_*]:cursor-grabbing"
                : "cursor-grab"
          }`}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Document
            file={fileProp}
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
            <div
              ref={pageWrapperRef}
              onMouseDown={handleSelectionStart}
              className="relative inline-block"
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={!selectionMode}
                renderAnnotationLayer={!selectionMode}
                loading={
                  <div className="text-muted-foreground text-sm py-8">
                    Rendering page...
                  </div>
                }
              />
              {selectionMode && activeRect && (
                <div
                  className="pointer-events-none absolute border-2 border-amber-500 bg-amber-400/20"
                  style={{
                    left: activeRect.x,
                    top: activeRect.y,
                    width: activeRect.w,
                    height: activeRect.h,
                  }}
                />
              )}
              {selectionMode && lockedRect && (
                <div
                  className="absolute z-10 flex gap-1"
                  style={{
                    left: lockedRect.x,
                    top: lockedRect.y + lockedRect.h + 4,
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmSelection();
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground shadow-lg hover:bg-primary/90"
                  >
                    <Check className="h-3 w-3" /> Translate this region
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelSelection();
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs shadow-lg hover:bg-accent"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              )}
            </div>
          </Document>
        </div>
      </div>
    );
  }

  return null;
}

function clampZoom(s: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +s.toFixed(2)));
}
