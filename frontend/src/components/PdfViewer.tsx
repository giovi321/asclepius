import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Document, Page } from "react-pdf";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  X,
} from "lucide-react";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker init is a module-level side effect (runs once per session, so
// StrictMode double-mounts can't race it) and rides this lazy chunk
// instead of the entry bundle.
import "@/lib/pdfWorker";

/** Bbox in normalized [0,1] coords relative to the rendered page. */
export interface NormalizedBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PdfViewerProps {
  url: string;
  /** Called when user clicks a rotate button. Receives degrees (90 or 270) and page numbers (null = all). */
  onRotate?: (degrees: number, pages: number[] | null) => Promise<void>;
  /** When true, click-and-drag draws a selection rectangle on the current
   * page instead of panning. The rectangle is shown with confirm/cancel
   * controls; ``onSelectionConfirm`` fires only when the user accepts. */
  selectionMode?: boolean;
  /** Called when the user confirms a selection. Bbox is normalized [0,1]. */
  onSelectionConfirm?: (page: number, bbox: NormalizedBbox) => void;
  /** Called when the user cancels selection mode (clicks the X or hits Esc). */
  onSelectionCancel?: () => void;
}

/**
 * Hook that debounces a value — the returned value only updates after
 * `delay` ms of inactivity.  This prevents rapid zoom clicks from
 * flooding react-pdf with concurrent render requests that crash the
 * pdf.js worker.
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Zoom constraints + step. Ctrl+wheel and the toolbar buttons share these.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const WHEEL_ZOOM_STEP = 0.1;

export default function PdfViewer({
  url,
  onRotate,
  selectionMode = false,
  onSelectionConfirm,
  onSelectionCancel,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [userZoomed, setUserZoomed] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  // Natural page width in CSS pixels at scale 1.0 — captured from the
  // page's onLoadSuccess. Used to derive the effective scale of the
  // current "Fit" rendering so the +/- buttons can step from there
  // instead of jumping to an absolute ``scale`` of 1.0 + step. Without
  // this the first zoom click on a landscape page in a wide column
  // shrinks the page (fit-equivalent ~1.5 → user click drops to 1.2).
  const [pageOriginalWidth, setPageOriginalWidth] = useState<number | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [showAllMenu, setShowAllMenu] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panOriginRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  // Selection rectangle, in page-local pixel coords. ``drawingRect`` is
  // the in-flight drag; ``lockedRect`` is what stays after mouseup so the
  // confirm/cancel toolbar can render without flicker.
  type SelectionRect = { x: number; y: number; w: number; h: number };
  const [drawingRect, setDrawingRect] = useState<SelectionRect | null>(null);
  const [lockedRect, setLockedRect] = useState<SelectionRect | null>(null);
  const drawOriginRef = useRef<{ x: number; y: number } | null>(null);

  // Clear selection when the user changes pages or exits selection mode.
  useEffect(() => {
    setDrawingRect(null);
    setLockedRect(null);
    drawOriginRef.current = null;
  }, [pageNumber, selectionMode]);

  // Esc cancels selection mode entirely.
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

  // Drag-to-draw selection. Mouse handlers are bound to the page wrapper
  // (not the outer container) so we can use its bounding rect to convert
  // clientX/Y to page-local coords.
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

  // Debounce the scale so rapid zoom clicks don't flood the worker
  const debouncedScale = useDebouncedValue(scale, 150);

  /** Effective scale currently rendered. In user-zoom mode that's just
   * ``scale``; in fit mode it's containerWidth / originalWidth — the
   * implicit scale react-pdf computes when ``width`` is set instead of
   * ``scale``. Used as the basis for the next +/- step so a click after
   * Fit doesn't jump to an absolute scale that's smaller than what the
   * user is currently looking at. */
  const effectiveScale = (() => {
    if (userZoomed) return scale;
    if (containerWidth && pageOriginalWidth) {
      return containerWidth / pageOriginalWidth;
    }
    return 1.0;
  })();

  const stepZoom = (delta: number) => {
    const next = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, +(effectiveScale + delta).toFixed(2)),
    );
    setScale(next);
    setUserZoomed(true);
  };

  // Ctrl+wheel zooms (mirrors DicomViewer's pattern). Native listener with
  // passive:false because React's synthetic onWheel is passive in modern
  // React and can't preventDefault — without that the browser intercepts
  // ctrl+wheel as page-level zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      // ctrlKey is also true on macOS pinch-to-zoom trackpad gestures, so
      // pinch zoom comes for free. metaKey covers the same intent on Mac
      // when a real ctrl-equivalent (cmd) is held.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP;
      stepZoom(delta);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
    // stepZoom closes over effectiveScale, so we need it as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveScale]);

  // Click-and-drag pan. The viewer uses overflow:auto so panning is just
  // adjusting scrollLeft/scrollTop. Bound to the container so toolbar
  // buttons (which sit outside this div) keep their normal click
  // behaviour. Text selection via drag is sacrificed in favour of
  // pan-as-default — the user can still cursor-select via single click +
  // shift-click or double-click word-select.
  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
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

  // mousemove + mouseup live on the window so a fast drag that exits the
  // viewport doesn't strand the panning state.
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

  // Build the file URL with cache-busting parameter
  const fileUrl =
    cacheBuster > 0
      ? `${url}${url.includes("?") ? "&" : "?"}v=${cacheBuster}`
      : url;

  // Stable reference — react-pdf deep-compares options and reloads the
  // entire document (destroying the worker connection) when it changes.
  const docOptions = useMemo(() => ({ withCredentials: true }), []);

  // Measure container width for fit-to-width mode
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width - 32); // subtract padding
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages);
      setPageNumber((prev) => (prev > numPages ? 1 : prev));
      setError(null);
      setLoading(false);
    },
    [],
  );

  const onDocumentLoadError = useCallback((err: Error) => {
    // Suppress worker-destroyed errors — these happen when the component
    // unmounts while a render is in flight (e.g. navigating away).
    if (
      err?.message?.includes("messageHandler") ||
      err?.message?.includes("sendWithPromise")
    ) {
      return;
    }
    console.error("PDF load error:", err);
    setError(`Failed to load PDF: ${err.message}`);
    setLoading(false);
  }, []);

  const onPageRenderError = useCallback((err: Error) => {
    // Suppress worker race-condition errors — the debounce prevents most
    // of these, but a stale render can still fire during rapid interaction.
    if (
      err?.message?.includes("messageHandler") ||
      err?.message?.includes("sendWithPromise")
    ) {
      return;
    }
    console.error("PDF page render error:", err);
  }, []);

  const handleRotate = async (degrees: number, mode: "page" | "all") => {
    if (!onRotate || rotating) return;
    setRotating(true);
    setShowAllMenu(false);
    try {
      const pages = mode === "page" ? [pageNumber] : null;
      await onRotate(degrees, pages);
      // Force PDF reload with new cache buster
      setLoading(true);
      setCacheBuster(Date.now());
    } catch (e) {
      console.error("Rotation failed:", e);
    }
    setRotating(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/30 gap-2 flex-wrap">
        {/* Page navigation */}
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

        {/* Zoom + Rotate */}
        <div className="flex items-center gap-1">
          {/* Zoom */}
          <button
            onClick={() => stepZoom(-0.2)}
            className="rounded p-1.5 hover:bg-accent"
            title="Zoom out (Ctrl + scroll)"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span
            className="text-sm text-muted-foreground min-w-[40px] text-center"
            title="Hold Ctrl + scroll to zoom; click and drag to pan"
          >
            {userZoomed ? `${Math.round(scale * 100)}%` : "Fit"}
          </span>
          <button
            onClick={() => stepZoom(0.2)}
            className="rounded p-1.5 hover:bg-accent"
            title="Zoom in (Ctrl + scroll)"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          {/* Fit button — always rendered to prevent layout shift */}
          <button
            onClick={() => {
              setUserZoomed(false);
              setScale(1.0);
            }}
            disabled={!userZoomed}
            className={`rounded px-1.5 py-1 text-[11px] transition-colors ${
              userZoomed
                ? "text-primary hover:bg-accent hover:text-foreground"
                : "text-muted-foreground/40 cursor-default"
            }`}
            title="Fit to width"
          >
            Fit
          </button>

          {/* Rotate controls */}
          {onRotate && (
            <>
              <div className="w-px h-5 bg-border mx-1.5" />

              <button
                onClick={() => handleRotate(270, "page")}
                disabled={rotating}
                className="rounded p-1.5 hover:bg-accent disabled:opacity-30"
                title="Rotate this page 90° left"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleRotate(90, "page")}
                disabled={rotating}
                className="rounded p-1.5 hover:bg-accent disabled:opacity-30"
                title="Rotate this page 90° right"
              >
                <RotateCw className="h-4 w-4" />
              </button>

              {/* "All pages" rotate — click-to-toggle dropdown */}
              <div
                className="relative"
                onMouseLeave={() => setShowAllMenu(false)}
              >
                <button
                  onClick={() => setShowAllMenu(!showAllMenu)}
                  onMouseEnter={() => setShowAllMenu(true)}
                  disabled={rotating}
                  className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 transition-colors"
                  title="Rotate all pages"
                >
                  All
                </button>
                {showAllMenu && (
                  <div className="absolute right-0 top-full pt-1 z-20">
                    <div className="rounded-lg border bg-white dark:bg-zinc-900 p-1.5 shadow-xl flex gap-1">
                      <button
                        onClick={() => handleRotate(270, "all")}
                        disabled={rotating}
                        className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs hover:bg-accent whitespace-nowrap disabled:opacity-30"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> All 90° left
                      </button>
                      <button
                        onClick={() => handleRotate(90, "all")}
                        disabled={rotating}
                        className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs hover:bg-accent whitespace-nowrap disabled:opacity-30"
                      >
                        <RotateCw className="h-3.5 w-3.5" /> All 90° right
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Selection-mode hint banner */}
      {selectionMode && (
        <div className="flex items-center justify-between gap-2 border-b bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
          <span>
            Click and drag on page {pageNumber} to select a region. Press Esc to
            cancel.
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

      {/* PDF display */}
      <div
        ref={containerRef}
        onMouseDown={handlePanStart}
        className={`flex-1 overflow-auto bg-muted/20 p-4 [&>div]:mx-auto ${
          selectionMode
            ? "cursor-crosshair"
            : isPanning
              ? "cursor-grabbing select-none [&_*]:cursor-grabbing"
              : "cursor-grab"
        }`}
      >
        {error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="text-destructive text-sm">{error}</div>
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
                setCacheBuster(Date.now());
              }}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Retry
            </button>
          </div>
        ) : (
          <Document
            key={cacheBuster}
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="text-muted-foreground text-sm py-8">
                Loading PDF...
              </div>
            }
            options={docOptions}
          >
            <div
              ref={pageWrapperRef}
              onMouseDown={handleSelectionStart}
              className="relative inline-block"
            >
              <Page
                pageNumber={pageNumber}
                {...(userZoomed
                  ? { scale: debouncedScale }
                  : containerWidth
                    ? { width: containerWidth }
                    : { scale: 1.0 })}
                renderTextLayer={!selectionMode}
                renderAnnotationLayer={!selectionMode}
                onRenderError={onPageRenderError}
                onLoadSuccess={(p) => {
                  // ``originalWidth`` is the page's natural CSS-pixel width
                  // at scale 1.0. Stashing it lets stepZoom convert the
                  // fit-mode rendering into an equivalent scale before
                  // applying the next +/- step (see effectiveScale above).
                  if (p?.originalWidth) {
                    setPageOriginalWidth(p.originalWidth);
                  }
                }}
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
        )}
      </div>
    </div>
  );
}
