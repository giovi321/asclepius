import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Document, Page } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
} from "lucide-react";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker is initialised once in main.tsx — not here, to avoid
// race conditions when React StrictMode double-mounts components.

interface PdfViewerProps {
  url: string;
  /** Called when user clicks a rotate button. Receives degrees (90 or 270) and page numbers (null = all). */
  onRotate?: (degrees: number, pages: number[] | null) => Promise<void>;
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

export default function PdfViewer({ url, onRotate }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [userZoomed, setUserZoomed] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  // Debounce the scale so rapid zoom clicks don't flood the worker
  const debouncedScale = useDebouncedValue(scale, 150);

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
      setScale((s) =>
        Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(s + delta).toFixed(2))),
      );
      setUserZoomed(true);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Click-and-drag pan. The viewer uses overflow:auto so panning is just
  // adjusting scrollLeft/scrollTop. Bound to the container so toolbar
  // buttons (which sit outside this div) keep their normal click
  // behaviour. Text selection via drag is sacrificed in favour of
  // pan-as-default — the user can still cursor-select via single click +
  // shift-click or double-click word-select.
  const handlePanStart = useCallback((e: React.MouseEvent) => {
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
  }, []);

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
            onClick={() => {
              setScale((s) => Math.max(ZOOM_MIN, +(s - 0.2).toFixed(1)));
              setUserZoomed(true);
            }}
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
            onClick={() => {
              setScale((s) => Math.min(ZOOM_MAX, +(s + 0.2).toFixed(1)));
              setUserZoomed(true);
            }}
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

      {/* PDF display */}
      <div
        ref={containerRef}
        onMouseDown={handlePanStart}
        className={`flex-1 overflow-auto bg-muted/20 p-4 [&>div]:mx-auto ${
          isPanning
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
            <Page
              pageNumber={pageNumber}
              {...(userZoomed
                ? { scale: debouncedScale }
                : containerWidth
                  ? { width: containerWidth }
                  : { scale: 1.0 })}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              onRenderError={onPageRenderError}
              loading={
                <div className="text-muted-foreground text-sm py-8">
                  Rendering page...
                </div>
              }
            />
          </Document>
        )}
      </div>
    </div>
  );
}
