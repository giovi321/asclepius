import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/api/client";
import {
  ChevronLeft,
  ChevronRight,
  Contrast,
  Info,
  Maximize,
  Move,
  RotateCcw,
  SlidersHorizontal,
  Sun,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePanZoomGestures } from "@/hooks/usePanZoomGestures";
import { usePointerCoarse } from "@/hooks/useMediaQuery";
import { clampScale } from "@/lib/gestureMath";
import IconButton from "@/components/ui/IconButton";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";

interface DicomViewerProps {
  studyId: number;
  seriesId: number;
  modality?: string | null;
}

const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;

/** Vertical pixels of one-finger drag per frame step, clamped so short
 *  series don't fly and long series stay reachable in one screen height. */
function pixelsPerFrame(viewportHeight: number, totalFrames: number): number {
  if (totalFrames <= 1) return Number.POSITIVE_INFINITY;
  return Math.min(30, Math.max(4, viewportHeight / totalFrames));
}

interface MetaItem {
  tag?: string;
  vr?: string;
  keyword?: string;
  name?: string;
  value?: unknown;
}

/**
 * Frame-by-frame DICOM viewer.
 *
 * Backend renders each frame to PNG on demand at
 *   /api/imaging/{study}/series/{series}/frame/{i}
 * with optional ?wc= and ?ww= for window-level adjustment — windowing is a
 * server round-trip, so continuous inputs (sliders, windowing drag) are
 * debounced before they reach the URL.
 *
 * Interactions:
 *   - Frames: one-finger vertical drag (stack scroll), slider, prev/next,
 *     arrow keys, plain mouse wheel.
 *   - Zoom: pinch, Ctrl+wheel, +/- buttons and keys; double-tap or
 *     double-click resets; CSS transform only (no re-render cost), with the
 *     backend upscale bucket derived from a debounced zoom.
 *   - Pan: two-finger drag (touch), middle-button or shift+drag (mouse).
 *   - Windowing (MR): WC/WW inputs + sliders, plus an opt-in "windowing
 *     drag" mode — horizontal drag adjusts width, vertical adjusts center,
 *     with a live readout (drag suspends frame scrubbing while active).
 *   - Below md the secondary controls live in a bottom tools sheet.
 */
export default function DicomViewer({
  studyId,
  seriesId,
  modality,
}: DicomViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const coarse = usePointerCoarse();

  // Pan + zoom state.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pinching, setPinching] = useState(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  // One-finger gesture accumulators (refs — no re-render per move).
  const scrubRef = useRef<{ startFrame: number; accumDy: number; ppf: number } | null>(null);
  const scrubFrameRaf = useRef(0);
  const windowDragRef = useRef<{
    baseWc: number;
    baseWw: number;
    wcStep: number;
    wwStep: number;
  } | null>(null);

  // Window center / width (contrast). Only applied for MR. Defaults align
  // with the backend's "no overrides → use DICOM's own VOI LUT" behaviour
  // when both are null.
  const isMR = (modality || "").toUpperCase() === "MR";
  const [wc, setWc] = useState<number | null>(null);
  const [ww, setWw] = useState<number | null>(null);
  // The file's own VOI tag values — drive the slider thumb position when
  // the user hasn't overridden, so "auto" reflects the real windowing.
  const [autoWc, setAutoWc] = useState<number | null>(null);
  const [autoWw, setAutoWw] = useState<number | null>(null);
  const [invert, setInvert] = useState(false);
  /** Opt-in one-finger windowing drag (MR only). While on, the drag that
   *  would normally scrub frames adjusts WC/WW instead. */
  const [windowingMode, setWindowingMode] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaItems, setMetaItems] = useState<MetaItem[] | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaQuery, setMetaQuery] = useState("");

  // Server-bound params are debounced: windowing drags and slider scrubs
  // fire a request only on pauses, not per pixel.
  const debouncedWc = useDebouncedValue(wc, 200);
  const debouncedWw = useDebouncedValue(ww, 200);
  const debouncedZoom = useDebouncedValue(zoom, 250);

  // Load frame list
  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get(`/imaging/${studyId}/series/${seriesId}/frames`)
      .then((res) => {
        setTotalFrames(res.data.count || 0);
        setCurrentFrame(0);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load series frames");
        setLoading(false);
      });
  }, [studyId, seriesId]);

  // Reset view when series changes.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setWc(null);
    setWw(null);
    setAutoWc(null);
    setAutoWw(null);
    setInvert(false);
    setWindowingMode(false);
    setMetaItems(null);
    setMetaQuery("");
  }, [studyId, seriesId]);

  // Fetch the file's own WindowCenter / WindowWidth for the slider thumbs.
  useEffect(() => {
    if (!isMR) return;
    let cancelled = false;
    api
      .get(
        `/imaging/${studyId}/series/${seriesId}/frame/${currentFrame}/window`,
      )
      .then((res) => {
        if (cancelled) return;
        const c = res.data?.window_center;
        const w = res.data?.window_width;
        setAutoWc(typeof c === "number" ? c : null);
        setAutoWw(typeof w === "number" ? w : null);
      })
      .catch(() => {
        if (cancelled) return;
        setAutoWc(null);
        setAutoWw(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isMR, studyId, seriesId, currentFrame]);

  // Lazy-load DICOM metadata for the current frame on demand.
  const openMetadata = useCallback(async () => {
    setMetaOpen(true);
    if (metaItems !== null) return;
    setMetaLoading(true);
    try {
      const res = await api.get(
        `/imaging/${studyId}/series/${seriesId}/frame/${currentFrame}/metadata`,
      );
      setMetaItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch {
      setMetaItems([]);
    } finally {
      setMetaLoading(false);
    }
  }, [studyId, seriesId, currentFrame, metaItems]);

  // Refetch metadata if frame changes while panel is open.
  useEffect(() => {
    if (!metaOpen) return;
    setMetaItems(null);
    setMetaLoading(true);
    api
      .get(
        `/imaging/${studyId}/series/${seriesId}/frame/${currentFrame}/metadata`,
      )
      .then((res) =>
        setMetaItems(Array.isArray(res.data?.items) ? res.data.items : []),
      )
      .catch(() => setMetaItems([]))
      .finally(() => setMetaLoading(false));
    // metaOpen intentionally excluded so toggling the panel itself
    // doesn't re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyId, seriesId, currentFrame]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore when an input field is focused (e.g. the WC/WW sliders).
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setCurrentFrame((f) => Math.max(0, f - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1));
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP));
      } else if (e.key === "-" || e.key === "_") {
        setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP));
      } else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [totalFrames]);

  // Effective windowing values (user override or the file's own).
  const effectiveWc = wc ?? autoWc ?? 0;
  const effectiveWw = ww ?? autoWw ?? 1;
  // Dynamic ranges around the auto value so the thumb is always visible.
  const wcSpan = autoWc != null ? Math.max(Math.abs(autoWc) * 2, 1024) : 2048;
  const wcMin = Math.round((autoWc ?? 0) - wcSpan);
  const wcMax = Math.round((autoWc ?? 0) + wcSpan);
  const wwMax = Math.max((autoWw ?? 0) * 4, 4096);

  // Touch + wheel gestures. touch-action: none on the viewport — it's an
  // overflow:hidden canvas, not a scroll container, and the one-finger drag
  // IS the stack-scroll gesture. The page remains scrollable from the
  // toolbar/slider around it.
  usePanZoomGestures({
    targetRef: viewportRef,
    onPinch: ({ ratio }) => {
      setPinching((p) => p || true);
      setZoom((z) => clampScale(z * ratio ** 0.5, ZOOM_MIN, ZOOM_MAX));
      // ratio is relative to gesture start; damping (sqrt) keeps the
      // per-event compounding from overshooting while staying responsive.
    },
    onPinchEnd: () => setPinching(false),
    onTwoFingerDrag: ({ dx, dy }) => {
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    },
    onDoubleTap: () => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    },
    onDrag: ({ dy, dx, first, last, pointerType }) => {
      // Mouse: plain left-drag stays a no-op unless windowing mode is on;
      // middle/shift-drag pan keeps its dedicated handlers below.
      if (windowingMode && isMR) {
        if (first || !windowDragRef.current) {
          windowDragRef.current = {
            baseWc: effectiveWc,
            baseWw: effectiveWw,
            wcStep: Math.max(1, Math.round(wcSpan / 200)),
            wwStep: Math.max(1, Math.round(wwMax / 200)),
          };
        }
        if (last) {
          windowDragRef.current = null;
          return;
        }
        const g = windowDragRef.current;
        // Horizontal = width (contrast), vertical = center (brightness) —
        // the OsiriX/Horos convention.
        g.baseWw = Math.max(1, g.baseWw + dx * g.wwStep * 0.25);
        g.baseWc = g.baseWc + dy * g.wcStep * 0.25;
        setWw(Math.round(g.baseWw));
        setWc(Math.round(g.baseWc));
        return;
      }

      if (pointerType === "mouse") return;

      // One-finger vertical drag = frame scrub (stack scroll).
      if (first || !scrubRef.current) {
        scrubRef.current = {
          startFrame: currentFrame,
          accumDy: 0,
          ppf: pixelsPerFrame(
            viewportRef.current?.clientHeight ?? 400,
            totalFrames,
          ),
        };
      }
      if (last) {
        scrubRef.current = null;
        return;
      }
      const s = scrubRef.current;
      s.accumDy += dy;
      cancelAnimationFrame(scrubFrameRaf.current);
      scrubFrameRaf.current = requestAnimationFrame(() => {
        const offset = Math.round(s.accumDy / s.ppf);
        setCurrentFrame(
          Math.max(0, Math.min(totalFrames - 1, s.startFrame + offset)),
        );
      });
    },
    wheel: {
      onZoom: (dir) => {
        const factor = dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        setZoom((z) => clampScale(z * factor, ZOOM_MIN, ZOOM_MAX));
      },
      onPlain: (deltaY) => {
        if (deltaY > 0) {
          setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1));
        } else {
          setCurrentFrame((f) => Math.max(0, f - 1));
        }
      },
    },
  });

  // Mouse pan: middle button OR shift+left (unchanged desktop behaviour).
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const isPan = e.button === 1 || (e.button === 0 && e.shiftKey);
      if (!isPan) return;
      e.preventDefault();
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        baseX: pan.x,
        baseY: pan.y,
      };
    },
    [pan.x, pan.y],
  );
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPan({
      x: dragRef.current.baseX + dx,
      y: dragRef.current.baseY + dy,
    });
  }, []);
  const onMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const resetContrast = () => {
    setWc(null);
    setWw(null);
    setInvert(false);
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center text-muted-foreground">
        Loading DICOM series...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center text-destructive">
        {error}
      </div>
    );
  }

  if (totalFrames === 0) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center text-muted-foreground">
        No frames found in this series
      </div>
    );
  }

  // Frame URL with debounced server-bound params: WC/WW fire on pauses,
  // and the bicubic-upscale bucket follows the committed zoom so mid-pinch
  // bucket flips don't refetch the frame repeatedly.
  const params = new URLSearchParams();
  if (isMR && debouncedWc != null) params.set("wc", String(debouncedWc));
  if (isMR && debouncedWw != null) params.set("ww", String(debouncedWw));
  if (invert) params.set("invert", "1");
  const upscale =
    debouncedZoom >= 5 ? 8 : debouncedZoom >= 3 ? 4 : debouncedZoom >= 1.5 ? 2 : 1;
  if (upscale > 1) params.set("upscale", String(upscale));
  const qs = params.toString();
  const frameUrl = `/api/imaging/${studyId}/series/${seriesId}/frame/${currentFrame}${qs ? `?${qs}` : ""}`;

  const filteredMetaItems = (metaItems || []).filter((it) => {
    const q = metaQuery.trim().toLowerCase();
    if (!q) return true;
    const hay =
      `${it.keyword || ""} ${it.name || ""} ${it.tag || ""} ${it.value ?? ""}`.toLowerCase();
    return hay.includes(q);
  });

  /** Shared zoom/view controls, rendered inline (md+) and in the tools
   *  sheet (below md). */
  const viewControls = (
    <>
      <IconButton
        label="Zoom out"
        size="md"
        onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))}
      >
        <ZoomOut className="h-4 w-4" />
      </IconButton>
      <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton
        label="Zoom in"
        size="md"
        onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))}
      >
        <ZoomIn className="h-4 w-4" />
      </IconButton>
      <IconButton label="Reset view (zoom + pan)" size="md" onClick={resetView}>
        <Maximize className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Go to first frame"
        size="md"
        onClick={() => setCurrentFrame(0)}
      >
        <RotateCcw className="h-4 w-4" />
      </IconButton>
    </>
  );

  const contrastControls = isMR && (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <Sun className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <div className="flex min-w-[240px] flex-1 items-center gap-2">
        <span className="w-12 flex-shrink-0 text-muted-foreground">
          Center
        </span>
        <input
          type="number"
          step={1}
          value={Math.round(effectiveWc)}
          onChange={(e) => setWc(Number(e.target.value))}
          inputMode="numeric"
          className="w-20 rounded border bg-background px-2 py-0.5 text-xs tabular-nums coarse:py-1.5"
        />
        <input
          type="range"
          min={wcMin}
          max={wcMax}
          step={Math.max(1, Math.round(wcSpan / 200))}
          value={Math.round(effectiveWc)}
          onChange={(e) => setWc(Number(e.target.value))}
          className={cn("flex-1 accent-primary", coarse && "slider-touch")}
          aria-label="Window center"
        />
        {wc == null && (
          <span className="flex-shrink-0 text-[10px] text-muted-foreground">
            auto
          </span>
        )}
      </div>
      <div className="flex min-w-[240px] flex-1 items-center gap-2">
        <span className="w-12 flex-shrink-0 text-muted-foreground">Width</span>
        <input
          type="number"
          step={1}
          min={1}
          value={Math.round(effectiveWw)}
          onChange={(e) => setWw(Math.max(1, Number(e.target.value)))}
          inputMode="numeric"
          className="w-20 rounded border bg-background px-2 py-0.5 text-xs tabular-nums coarse:py-1.5"
        />
        <input
          type="range"
          min={1}
          max={wwMax}
          step={Math.max(1, Math.round(wwMax / 200))}
          value={Math.round(effectiveWw)}
          onChange={(e) => setWw(Math.max(1, Number(e.target.value)))}
          className={cn("flex-1 accent-primary", coarse && "slider-touch")}
          aria-label="Window width"
        />
        {ww == null && (
          <span className="flex-shrink-0 text-[10px] text-muted-foreground">
            auto
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setWindowingMode((v) => !v)}
          aria-pressed={windowingMode}
          className={cn(
            "flex-shrink-0 rounded border px-2 py-0.5 transition-colors coarse:min-h-9",
            windowingMode
              ? "border-primary bg-primary/10 text-primary"
              : "hover:bg-accent",
          )}
          title="Windowing drag: one-finger drag adjusts width (horizontal) and center (vertical)"
        >
          Drag mode
        </button>
        <button
          onClick={resetContrast}
          className="flex-shrink-0 rounded border px-2 py-0.5 hover:bg-accent coarse:min-h-9"
          title="Reset to file defaults"
        >
          Reset
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-surface px-2 py-1">
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Previous frame"
            size="md"
            onClick={() => setCurrentFrame((f) => Math.max(0, f - 1))}
            disabled={currentFrame <= 0}
            className="disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <span className="text-sm tabular-nums text-muted-foreground">
            {currentFrame + 1} / {totalFrames}
          </span>
          <IconButton
            label="Next frame"
            size="md"
            onClick={() =>
              setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1))
            }
            disabled={currentFrame >= totalFrames - 1}
            className="disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="hidden items-center gap-0.5 md:flex">
            {viewControls}
          </div>
          <IconButton
            label="Invert colours"
            size="md"
            onClick={() => setInvert((v) => !v)}
            aria-pressed={invert}
            className={cn(invert && "bg-accent text-primary")}
          >
            <Contrast className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Viewer tools"
            size="md"
            onClick={() => setToolsOpen(true)}
            className="md:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </IconButton>
          <IconButton label="View DICOM metadata" size="md" onClick={openMetadata}>
            <Info className="h-4 w-4" />
          </IconButton>
        </div>
        <span className="hidden text-[10px] text-muted-foreground lg:block">
          <Move className="inline h-3 w-3" /> shift-drag · Ctrl+wheel zoom ·
          arrows scroll
        </span>
      </div>

      {/* MRI contrast strip — inline from md up; lives in the tools sheet
          below md. */}
      {isMR && (
        <div className="hidden border-b bg-surface/50 px-3 py-2 md:block">
          {contrastControls}
        </div>
      )}

      {/* Viewport */}
      <div
        ref={viewportRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        className="relative flex min-h-[280px] flex-1 select-none items-center justify-center overflow-hidden bg-black cursor-crosshair"
        style={{ touchAction: "none" }}
      >
        <img
          src={frameUrl}
          alt={`Frame ${currentFrame + 1}`}
          draggable={false}
          className="pointer-events-none max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition:
              dragRef.current || pinching ? "none" : "transform 60ms linear",
            imageRendering: "auto",
          }}
        />
        {windowingMode && isMR && (
          <div className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[11px] tabular-nums text-white">
            WC {Math.round(effectiveWc)} · WW {Math.round(effectiveWw)}
          </div>
        )}
      </div>

      {/* Frame slider — extra vertical padding so the range thumb stays
          inside the container. */}
      {totalFrames > 1 && (
        <div className="flex-shrink-0 border-t bg-surface px-4 py-3">
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e) => setCurrentFrame(Number(e.target.value))}
            className={cn(
              "block w-full accent-primary",
              coarse && "slider-touch",
            )}
            aria-label="Frame"
          />
        </div>
      )}

      {/* Tools sheet (below md): zoom/view controls, contrast, gesture
          legend. */}
      <Sheet
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        title="Viewer tools"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-1">
            {viewControls}
            <IconButton
              label="Invert colours"
              size="md"
              onClick={() => setInvert((v) => !v)}
              aria-pressed={invert}
              className={cn(invert && "bg-accent text-primary")}
            >
              <Contrast className="h-4 w-4" />
            </IconButton>
          </div>
          {contrastControls}
          <p className="text-xs text-muted-foreground">
            Drag up/down to move through frames · pinch to zoom · two-finger
            drag to pan · double-tap to reset
            {isMR &&
              " · with Drag mode on, drag adjusts contrast (horizontal) and brightness (vertical)"}
          </p>
        </div>
      </Sheet>

      {/* DICOM metadata — bottom sheet on phones, centered dialog from sm
          up; the 4-column table collapses to stacked rows below md. */}
      <Sheet
        open={metaOpen}
        onOpenChange={setMetaOpen}
        title="DICOM metadata"
        description={`Frame ${currentFrame + 1} / ${totalFrames}`}
        contentClassName="sm:max-w-[min(800px,90vw)]"
      >
        <div className="sticky top-0 -mx-1 bg-card px-1 pb-2">
          <input
            type="text"
            value={metaQuery}
            onChange={(e) => setMetaQuery(e.target.value)}
            placeholder="Filter by tag, keyword or value..."
            className="h-9 w-full rounded border bg-background px-2 text-base sm:text-sm coarse:h-11"
            autoFocus={!coarse}
          />
        </div>
        {metaLoading ? (
          <div className="px-1 py-6 text-sm text-muted-foreground">
            Loading metadata...
          </div>
        ) : !metaItems || metaItems.length === 0 ? (
          <div className="px-1 py-6 text-sm text-muted-foreground">
            No metadata available.
          </div>
        ) : filteredMetaItems.length === 0 ? (
          <div className="px-1 py-6 text-sm text-muted-foreground">
            No tags match the filter.
          </div>
        ) : (
          <>
            {/* md+: the classic 4-column table */}
            <table className="hidden w-full text-xs md:table">
              <thead className="sticky top-9 border-b bg-surface">
                <tr>
                  <th className="w-20 px-3 py-1.5 text-left font-medium">
                    Tag
                  </th>
                  <th className="w-12 px-3 py-1.5 text-left font-medium">
                    VR
                  </th>
                  <th className="px-3 py-1.5 text-left font-medium">Name</th>
                  <th className="px-3 py-1.5 text-left font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredMetaItems.map((it, i) => (
                  <tr key={`${it.tag}-${i}`}>
                    <td className="px-3 py-1 font-mono text-[11px] text-muted-foreground">
                      {it.tag}
                    </td>
                    <td className="px-3 py-1 font-mono text-[11px] text-muted-foreground">
                      {it.vr}
                    </td>
                    <td className="px-3 py-1">{it.name}</td>
                    <td className="break-all px-3 py-1">
                      {it.value === null || it.value === undefined ? (
                        <span className="italic text-muted-foreground">
                          none
                        </span>
                      ) : (
                        String(it.value)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* below md: stacked rows */}
            <ul className="divide-y md:hidden">
              {filteredMetaItems.map((it, i) => (
                <li key={`${it.tag}-m-${i}`} className="py-2">
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {it.tag} · {it.vr}
                  </div>
                  <div className="text-sm">{it.name}</div>
                  <div className="break-all text-xs text-muted-foreground">
                    {it.value === null || it.value === undefined ? (
                      <span className="italic">none</span>
                    ) : (
                      String(it.value)
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {metaOpen && (
          <div className="pt-3 md:hidden">
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => setMetaOpen(false)}
            >
              Close
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
