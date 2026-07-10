import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

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
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@/components/ui/Menu";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker init is a module-level side effect (runs once per session, so
// StrictMode double-mounts can't race it) and rides this lazy chunk
// instead of the entry bundle.
import "@/lib/pdfWorker";

export type { NormalizedBbox };

interface PdfViewerProps {
  url: string;
  /** Called when user picks a rotate action. Receives degrees (90 or 270) and page numbers (null = all). */
  onRotate?: (degrees: number, pages: number[] | null) => Promise<void>;
  /** When true, dragging draws a selection rectangle on the current page
   * instead of panning. The rectangle is shown with confirm/cancel
   * controls; ``onSelectionConfirm`` fires only when the user accepts. */
  selectionMode?: boolean;
  /** Called when the user confirms a selection. Bbox is normalized [0,1]. */
  onSelectionConfirm?: (page: number, bbox: NormalizedBbox) => void;
  /** Called when the user cancels selection mode (X button or Esc). */
  onSelectionCancel?: () => void;
}

// Zoom constraints + steps. Pinch, Ctrl+wheel, and the toolbar share these.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const WHEEL_ZOOM_STEP = 0.1;
const BUTTON_ZOOM_STEP = 0.2;
const DOUBLE_TAP_ZOOM = 2.0;

/**
 * Admin PDF viewer.
 *
 * Interaction model (same architecture as ShareDocumentViewer):
 * - Fit-to-width default; pinch zooms via a CSS-transform preview with one
 *   committed react-pdf re-render per gesture (rapid scale changes crash
 *   the pdf.js worker — the commit rides a 150ms debounce).
 * - Fit zoom: native vertical scrolling (touch-action: pan-y), horizontal
 *   swipe turns pages. Zoomed: native two-axis panning owns all drags.
 * - Desktop: mouse drag-pan, Ctrl+wheel / toolbar zoom, click-toggle
 *   rotate menu (the old hover-only menu was dead on touch).
 * - Selection mode: touch-action none, one-pointer draw with corner-handle
 *   refinement; confirm bar pinned to the frame bottom on coarse pointers.
 */
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
  // current "Fit" rendering so the +/- buttons and pinch step from there
  // instead of jumping to an absolute ``scale``.
  const [pageOriginalWidth, setPageOriginalWidth] = useState<number | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const coarse = usePointerCoarse();
  // Keeps the previous render on screen while react-pdf re-renders at the
  // new scale — without it every zoom step flashes the background.
  const { beginGhost, endGhost } = usePdfCanvasGhost(pageWrapperRef);

  // In-flight pinch preview; committed once at gesture end.
  const pendingPinchRef = useRef<{
    ratio: number;
    focalX: number;
    focalY: number;
  } | null>(null);

  // Debounce the scale so rapid zoom changes don't flood the worker.
  const debouncedScale = useDebouncedValue(scale, 150);

  /** Effective scale currently rendered. In user-zoom mode that's just
   * ``scale``; in fit mode it's containerWidth / originalWidth — the
   * implicit scale react-pdf computes when ``width`` is set. */
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

  // Region selection (shared pointer-based hook).
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
    disabled: selectionMode,
    onPinch: ({ ratio, focalX, focalY }) => {
      const wrapper = pageWrapperRef.current;
      const container = containerRef.current;
      if (!wrapper || !container) return;
      beginGhost();
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
      if (userZoomed) return;
      if (dir === "left") setPageNumber((p) => Math.min(numPages, p + 1));
      else setPageNumber((p) => Math.max(1, p - 1));
    },
    onDrag: ({ dx, dy, first, last, pointerType }) => {
      // Mouse drag-pan; touch pans natively via touch-action.
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

  // Commit point for the pinch preview.
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
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-surface px-2 py-1">
        {/* Page navigation */}
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

        {/* Zoom + Rotate */}
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
            disabled={!userZoomed}
            className={cn(
              "min-w-[44px] rounded-md px-1 py-2 text-center text-sm transition-colors coarse:min-h-11",
              userZoomed
                ? "text-primary hover:bg-accent hover:text-foreground"
                : "cursor-default text-muted-foreground",
            )}
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

          {/* Rotate controls */}
          {onRotate && (
            <>
              <div className="mx-1.5 h-5 w-px bg-border" />

              {/* Per-page rotate: inline from md up, in the menu below md. */}
              <IconButton
                label="Rotate this page 90° left"
                size="md"
                onClick={() => handleRotate(270, "page")}
                disabled={rotating}
                className="hidden disabled:opacity-30 md:inline-flex"
              >
                <RotateCcw className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="Rotate this page 90° right"
                size="md"
                onClick={() => handleRotate(90, "page")}
                disabled={rotating}
                className="hidden disabled:opacity-30 md:inline-flex"
              >
                <RotateCw className="h-4 w-4" />
              </IconButton>

              {/* Click-toggle menu (the old hover-open dropdown was
                  unreachable on touch). Carries everything below md. */}
              <Menu>
                <MenuTrigger asChild>
                  <IconButton
                    label="Rotate options"
                    size="md"
                    disabled={rotating}
                    className="disabled:opacity-30"
                  >
                    <MoreHorizontal className="h-4 w-4 md:hidden" />
                    <span className="hidden text-[11px] md:inline">All</span>
                  </IconButton>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem
                    onSelect={() => handleRotate(270, "page")}
                    className="md:hidden"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> This page 90° left
                  </MenuItem>
                  <MenuItem
                    onSelect={() => handleRotate(90, "page")}
                    className="md:hidden"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> This page 90° right
                  </MenuItem>
                  <MenuItem onSelect={() => handleRotate(270, "all")}>
                    <RotateCcw className="h-3.5 w-3.5" /> All pages 90° left
                  </MenuItem>
                  <MenuItem onSelect={() => handleRotate(90, "all")}>
                    <RotateCw className="h-3.5 w-3.5" /> All pages 90° right
                  </MenuItem>
                </MenuContent>
              </Menu>
            </>
          )}
        </div>
      </div>

      {/* Selection-mode hint banner */}
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

      {/* PDF display */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-auto bg-muted/20 p-4 [&>div]:mx-auto",
          selectionMode
            ? "cursor-crosshair"
            : isPanning
              ? "cursor-grabbing select-none [&_*]:cursor-grabbing"
              : "cursor-grab",
        )}
        style={{
          touchAction: selectionMode
            ? "none"
            : userZoomed
              ? "pan-x pan-y"
              : "pan-y",
        }}
      >
        {error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="text-sm text-destructive">{error}</div>
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
              <div className="py-8 text-sm text-muted-foreground">
                Loading PDF...
              </div>
            }
            options={docOptions}
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
                onRenderError={onPageRenderError}
                onRenderSuccess={handlePageRenderSuccess}
                onLoadSuccess={(p) => {
                  // ``originalWidth`` is the page's natural CSS-pixel width
                  // at scale 1.0; basis for effectiveScale in fit mode.
                  if (p?.originalWidth) {
                    setPageOriginalWidth(p.originalWidth);
                  }
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
                    top: selection.lockedRect.y + selection.lockedRect.h + 4,
                  }}
                />
              )}
            </div>
          </Document>
        )}
      </div>

      {/* Thumb-reach confirm bar on touch devices. */}
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
