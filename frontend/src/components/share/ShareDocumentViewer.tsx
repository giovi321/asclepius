import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import { ChevronLeft, ChevronRight, FileText, X, ZoomIn, ZoomOut } from "lucide-react";

import shareApi from "@/api/shareClient";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePanZoomGestures } from "@/hooks/usePanZoomGestures";
import { usePdfCanvasGhost } from "@/hooks/usePdfCanvasGhost";
import {
  useRegionSelection,
  type NormalizedBbox,
} from "@/hooks/useRegionSelection";
import { usePointerCoarse } from "@/hooks/useMediaQuery";
import { clampScale, focalScrollAfterZoom } from "@/lib/gestureMath";
import SelectionOverlay, {
  SelectionActionBar,
} from "@/components/viewer/SelectionOverlay";
import IconButton from "@/components/ui/IconButton";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "@/lib/pdfWorker";

export type { NormalizedBbox };

interface ShareDocumentViewerProps {
  documentId: number;
  treatAsImage?: boolean;
  /** When true, dragging draws a selection rectangle on the current page
   * instead of panning. Works with mouse, touch, and pen. */
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
const DOUBLE_TAP_ZOOM = 2.0;

/**
 * Read-only PDF / image viewer for the doctor share surface.
 *
 * Security posture (do not weaken):
 * - Bytes fetched via shareApi (cookie-bound) into a Uint8Array; PDFs are
 *   never exposed as a URL the browser would treat as downloadable.
 * - No download button, no rotate / replace UI.
 * - Right-click, iOS long-press callout, and Ctrl+S/Ctrl+P intercepted.
 *
 * Interaction model:
 * - Fit-to-width by default; pinch to zoom (CSS-transform preview, one
 *   committed re-render per gesture — rapid scale changes crash the
 *   pdf.js worker, so the commit goes through a 150ms debounce).
 * - At fit zoom, one finger scrolls the page natively (touch-action:
 *   pan-y) and a horizontal swipe turns the page; when zoomed, native
 *   two-axis panning owns all drags and swipe is structurally impossible.
 * - Desktop unchanged: drag-pan, Ctrl+wheel and Ctrl+=/-/0 zoom.
 * - Selection mode (region translate) suspends every gesture
 *   (touch-action: none) and supports draw + corner-handle refinement.
 * - Sizing contract: fills the parent's bounded height (h-full).
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

  // Zoom model ported from the admin PdfViewer: fit-to-width until the
  // user zooms; effectiveScale bridges fit mode into the +/- steps.
  const [scale, setScale] = useState(1.0);
  const [userZoomed, setUserZoomed] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [pageOriginalWidth, setPageOriginalWidth] = useState<number | null>(
    null,
  );
  const debouncedScale = useDebouncedValue(scale, 150);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const coarse = usePointerCoarse();
  // Keeps the previous render on screen while react-pdf re-renders at the
  // new scale — without it every zoom step flashes the background.
  const { beginGhost, endGhost } = usePdfCanvasGhost(pageWrapperRef);

  // In-flight pinch: CSS transform on the page wrapper only; committed to a
  // real react-pdf scale exactly once, at gesture end.
  const pendingPinchRef = useRef<{
    ratio: number;
    focalX: number;
    focalY: number;
  } | null>(null);

  const docOptions = useMemo(() => ({}), []);
  const fileProp = useMemo(
    () => (pdfData ? { data: pdfData } : null),
    [pdfData],
  );

  const effectiveScale = (() => {
    if (userZoomed) return scale;
    if (containerWidth && pageOriginalWidth) {
      return containerWidth / pageOriginalWidth;
    }
    return 1.0;
  })();

  const stepZoom = useCallback(
    (delta: number) => {
      const next = clampScale(
        +(effectiveScale + delta).toFixed(2),
        ZOOM_MIN,
        ZOOM_MAX,
      );
      if (Math.abs(next - effectiveScale) < 0.005) return; // clamped edge
      beginGhost();
      setScale(next);
      setUserZoomed(true);
    },
    [effectiveScale, beginGhost],
  );

  const resetToFit = useCallback(() => {
    if (userZoomed) beginGhost();
    setUserZoomed(false);
    setScale(1.0);
    const wrapper = pageWrapperRef.current;
    if (wrapper) wrapper.style.transform = "";
    pendingPinchRef.current = null;
  }, [userZoomed, beginGhost]);

  // Tell the parent which page the doctor is currently looking at.
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

  // Ctrl++ / Ctrl+- / Ctrl+0 keyboard shortcuts.
  useEffect(() => {
    if (!pdfData) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        stepZoom(BUTTON_ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        stepZoom(-BUTTON_ZOOM_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        resetToFit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pdfData, stepZoom, resetToFit]);

  // Fit-to-width measurement.
  useEffect(() => {
    if (!pdfData) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width - 32); // minus padding
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pdfData]);

  // Region selection (pointer-based; shared with the admin viewer).
  const selection = useRegionSelection({
    wrapperRef: pageWrapperRef,
    enabled: selectionMode,
    onCancel: onSelectionCancel,
  });
  const { reset: resetSelection } = selection;
  useEffect(() => {
    resetSelection();
    // A ghost from a pending zoom would show the previous page's pixels
    // over the incoming page — drop it on page turns.
    endGhost();
  }, [pageNumber, resetSelection, endGhost]);

  const confirmSelection = () => {
    const bbox = selection.confirm();
    if (bbox) onSelectionConfirm?.(pageNumber, bbox);
  };

  // Pinch / drag / swipe / double-tap / wheel.
  usePanZoomGestures({
    targetRef: containerRef,
    disabled: selectionMode || !pdfData,
    onPinch: ({ ratio, focalX, focalY }) => {
      const wrapper = pageWrapperRef.current;
      const container = containerRef.current;
      if (!wrapper || !container) return;
      beginGhost();
      // Focal point in wrapper coordinates for a visually-anchored preview.
      const wrapperRect = wrapper.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const ox = focalX + containerRect.left - wrapperRect.left;
      const oy = focalY + containerRect.top - wrapperRect.top;
      const clampedRatio =
        clampScale(effectiveScale * ratio, ZOOM_MIN, ZOOM_MAX) /
        effectiveScale;
      wrapper.style.transformOrigin = `${ox}px ${oy}px`;
      wrapper.style.transform = `scale(${clampedRatio})`;
      wrapper.style.willChange = "transform";
      pendingPinchRef.current = { ratio: clampedRatio, focalX, focalY };
    },
    onPinchEnd: () => {
      const pending = pendingPinchRef.current;
      if (!pending) return;
      const next = clampScale(
        +(effectiveScale * pending.ratio).toFixed(2),
        ZOOM_MIN,
        ZOOM_MAX,
      );
      if (Math.abs(next - effectiveScale) < 0.01) {
        // No effective change → react-pdf won't re-render, so release the
        // preview state here or the ghost would linger forever.
        const wrapper = pageWrapperRef.current;
        if (wrapper) {
          wrapper.style.transform = "";
          wrapper.style.willChange = "";
        }
        pendingPinchRef.current = null;
        endGhost();
        return;
      }
      // The transform stays applied until the re-rendered page arrives
      // (onRenderSuccess below), so the preview never snaps back.
      setScale(next);
      setUserZoomed(true);
    },
    onDoubleTap: ({ x, y }) => {
      if (userZoomed) {
        resetToFit();
      } else {
        beginGhost();
        pendingPinchRef.current = {
          ratio: DOUBLE_TAP_ZOOM / effectiveScale,
          focalX: x,
          focalY: y,
        };
        setScale(clampScale(DOUBLE_TAP_ZOOM, ZOOM_MIN, ZOOM_MAX));
        setUserZoomed(true);
      }
    },
    onSwipe: (dir) => {
      // Only reachable at fit zoom (touch-action pan-y leaves horizontal
      // drags to JS); when zoomed the browser owns all one-finger drags.
      if (userZoomed) return;
      if (dir === "left") setPageNumber((p) => Math.min(numPages, p + 1));
      else setPageNumber((p) => Math.max(1, p - 1));
    },
    onDrag: ({ dx, dy, first, last, pointerType }) => {
      // Mouse drag-pan (the old scrollLeft/scrollTop model). Touch drags
      // pan natively via touch-action; feeding them here would double-pan.
      if (pointerType !== "mouse") return;
      const el = containerRef.current;
      if (!el) return;
      if (first) setIsPanning(true);
      if (last) {
        setIsPanning(false);
        return;
      }
      el.scrollLeft -= dx;
      el.scrollTop -= dy;
    },
    wheel: {
      onZoom: (dir) => stepZoom(dir * WHEEL_ZOOM_STEP),
    },
  });

  // Commit point: the re-rendered page is on screen — drop the ghost and
  // the preview transform, and correct scroll so the focal point stays put.
  const handlePageRenderSuccess = useCallback(() => {
    endGhost();
    const pending = pendingPinchRef.current;
    const wrapper = pageWrapperRef.current;
    const container = containerRef.current;
    if (wrapper) {
      wrapper.style.transform = "";
      wrapper.style.willChange = "";
    }
    if (pending && container) {
      const corrected = focalScrollAfterZoom({
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
        focalX: pending.focalX,
        focalY: pending.focalY,
        ratio: pending.ratio,
      });
      container.scrollLeft = corrected.scrollLeft;
      container.scrollTop = corrected.scrollTop;
    }
    pendingPinchRef.current = null;
  }, [endGhost]);

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
        <FileText className="h-10 w-10 mx-auto text-warning" />
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
          className="no-touch-callout w-full object-contain max-h-[min(700px,80dvh)]"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    );
  }

  if (pdfData) {
    return (
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between gap-2 border-b bg-surface px-2 py-1">
          <div className="flex items-center gap-0.5">
            <IconButton
              label="Previous page"
              size="md"
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              disabled={pageNumber <= 1}
              className="disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <span className="min-w-[60px] text-center text-sm tabular-nums text-muted-foreground">
              {pageNumber} / {numPages}
            </span>
            <IconButton
              label="Next page"
              size="md"
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              disabled={pageNumber >= numPages}
              className="disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="flex items-center gap-0.5">
            <IconButton
              label="Zoom out"
              size="md"
              onClick={() => stepZoom(-BUTTON_ZOOM_STEP)}
            >
              <ZoomOut className="h-4 w-4" />
            </IconButton>
            <button
              onClick={resetToFit}
              className="min-w-[44px] rounded-md px-1 py-2 text-center text-sm text-muted-foreground transition-colors hover:text-foreground coarse:min-h-11"
              title="Fit to width"
            >
              {userZoomed ? `${Math.round(scale * 100)}%` : "Fit"}
            </button>
            <IconButton
              label="Zoom in"
              size="md"
              onClick={() => stepZoom(BUTTON_ZOOM_STEP)}
            >
              <ZoomIn className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        {selectionMode && (
          <div className="flex items-center justify-between gap-2 border-b border-warning/25 bg-warning-soft px-3 py-1.5 text-xs text-warning">
            <span>
              Drag on page {pageNumber} to select a region.
              <span className="hidden sm:inline"> Press Esc to cancel.</span>
            </span>
            <IconButton
              label="Cancel selection"
              size="sm"
              onClick={selection.cancel}
              className="text-warning hover:bg-warning/10"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        )}

        <div
          ref={containerRef}
          className={cn(
            "no-touch-callout flex-1 overflow-auto bg-muted/20 p-4 [&>div]:mx-auto",
            selectionMode
              ? "cursor-crosshair"
              : isPanning
                ? "cursor-grabbing [&_*]:cursor-grabbing"
                : "cursor-grab",
          )}
          style={{
            touchAction: selectionMode
              ? "none"
              : userZoomed
                ? "pan-x pan-y"
                : "pan-y",
          }}
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
              <div className="py-8 text-sm text-muted-foreground">
                Loading PDF...
              </div>
            }
          >
            <div
              ref={pageWrapperRef}
              onPointerDown={selection.startDraw}
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
                onRenderSuccess={handlePageRenderSuccess}
                onLoadSuccess={(p) => {
                  if (p?.originalWidth) setPageOriginalWidth(p.originalWidth);
                }}
                loading={
                  <div className="py-8 text-sm text-muted-foreground">
                    Rendering page...
                  </div>
                }
              />
              {selectionMode && (
                <SelectionOverlay
                  rect={selection.activeRect}
                  locked={Boolean(selection.lockedRect)}
                  onStartResize={selection.startResize}
                />
              )}
              {selectionMode && selection.lockedRect && !coarse && (
                <SelectionActionBar
                  visible
                  variant="floating"
                  confirmLabel="Translate this region"
                  onConfirm={confirmSelection}
                  onCancel={selection.cancel}
                  position={{
                    left: selection.lockedRect.x,
                    top:
                      selection.lockedRect.y + selection.lockedRect.h + 4,
                  }}
                />
              )}
            </div>
          </Document>
        </div>

        {/* Thumb-reach confirm bar, pinned to the viewer frame on touch. */}
        {selectionMode && coarse && (
          <SelectionActionBar
            visible={Boolean(selection.lockedRect)}
            variant="bar"
            confirmLabel="Translate this region"
            onConfirm={confirmSelection}
            onCancel={selection.cancel}
          />
        )}
      </div>
    );
  }

  return null;
}
