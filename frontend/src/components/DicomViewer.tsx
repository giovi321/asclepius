import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/api/client";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Move,
  Sun,
  Maximize,
} from "lucide-react";

interface DicomViewerProps {
  studyId: number;
  seriesId: number;
  modality?: string | null;
}

const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;

/**
 * Frame-by-frame DICOM viewer.
 *
 * Backend renders each frame to PNG on demand at
 *   /api/imaging/{study}/series/{series}/frame/{i}
 * with optional ?wc= and ?ww= for window-level adjustment, so MRI users can
 * change contrast / brightness without re-decoding pixel data on the client.
 *
 * Interactions:
 *   - Frame navigation: arrow keys, mouse wheel (default), slider, prev/next.
 *   - Zoom: ctrl+wheel, "+" / "-" buttons, double-click resets.
 *   - Pan: middle-button or shift+drag.
 *   - Contrast/brightness: window-center (WC) and window-width (WW) sliders,
 *     shown only for MR modality (other modalities have fixed presentation
 *     values baked into the PNG).
 */
export default function DicomViewer({ studyId, seriesId, modality }: DicomViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pan + zoom state.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; baseX: number; baseY: number } | null>(null);

  // Window center / width (contrast). Only applied for MR. Defaults align
  // with the backend's "no overrides → use DICOM's own VOI LUT" behaviour
  // when both are null.
  const isMR = (modality || "").toUpperCase() === "MR";
  const [wc, setWc] = useState<number | null>(null);
  const [ww, setWw] = useState<number | null>(null);

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
  }, [studyId, seriesId]);

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

  // Wheel: ctrl+wheel zooms; plain wheel scrolls frames.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
        setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor)));
      } else if (e.deltaY > 0) {
        setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1));
      } else {
        setCurrentFrame((f) => Math.max(0, f - 1));
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [totalFrames]);

  // Pan handlers.
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle button OR shift+left = pan; plain left = no-op (frame stay).
    const isPan = e.button === 1 || (e.button === 0 && e.shiftKey);
    if (!isPan) return;
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, baseX: pan.x, baseY: pan.y };
  }, [pan.x, pan.y]);
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
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[500px] text-muted-foreground">
        Loading DICOM series...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[500px] text-destructive">
        {error}
      </div>
    );
  }

  if (totalFrames === 0) {
    return (
      <div className="flex items-center justify-center h-[500px] text-muted-foreground">
        No frames found in this series
      </div>
    );
  }

  // Build the frame URL with optional window/level params. Encoded in the
  // src so React requests a new image when WC/WW change.
  const params = new URLSearchParams();
  if (isMR && wc != null) params.set("wc", String(wc));
  if (isMR && ww != null) params.set("ww", String(ww));
  // Ask the backend to bicubic-upscale the PNG once the user zooms past
  // ~1.5x — without this the CSS scale path produces a blurry/pixelated
  // image because the PNG is delivered at the DICOM's native resolution
  // (often 256x256 or 512x512). Capped at 4x because PIL bicubic gets
  // expensive past that and there's no further sharpness gain.
  const upscale = zoom >= 3 ? 4 : zoom >= 1.5 ? 2 : 1;
  if (upscale > 1) params.set("upscale", String(upscale));
  const qs = params.toString();
  const frameUrl = `/api/imaging/${studyId}/series/${seriesId}/frame/${currentFrame}${qs ? `?${qs}` : ""}`;

  return (
    <div className="flex flex-col h-full">
      {/* Top toolbar */}
      <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/30 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentFrame((f) => Math.max(0, f - 1))}
            disabled={currentFrame <= 0}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
            title="Previous frame"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Frame {currentFrame + 1} / {totalFrames}
          </span>
          <button
            onClick={() => setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1))}
            disabled={currentFrame >= totalFrames - 1}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
            title="Next frame"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))}
            className="rounded p-1 hover:bg-accent"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground tabular-nums w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))}
            className="rounded p-1 hover:bg-accent"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={resetView}
            className="rounded p-1 hover:bg-accent"
            title="Reset view (zoom + pan)"
          >
            <Maximize className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCurrentFrame(0)}
            className="rounded p-1 hover:bg-accent"
            title="Go to first frame"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground hidden md:block">
          <Move className="inline h-3 w-3" /> shift-drag · Ctrl+wheel zoom · arrows scroll
        </span>
      </div>

      {/* MRI contrast controls */}
      {isMR && (
        <div className="flex items-center gap-3 border-b px-3 py-2 bg-muted/20 text-xs">
          <Sun className="h-3.5 w-3.5 text-muted-foreground" />
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Center</span>
            <input
              type="range"
              min={-1024}
              max={3072}
              step={1}
              value={wc ?? 1024}
              onChange={(e) => setWc(Number(e.target.value))}
              className="w-32 accent-primary"
            />
            <span className="tabular-nums w-12 text-right">{wc ?? "auto"}</span>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Width</span>
            <input
              type="range"
              min={1}
              max={4096}
              step={1}
              value={ww ?? 2048}
              onChange={(e) => setWw(Number(e.target.value))}
              className="w-32 accent-primary"
            />
            <span className="tabular-nums w-12 text-right">{ww ?? "auto"}</span>
          </label>
          <button
            onClick={resetContrast}
            className="ml-auto rounded border px-2 py-0.5 hover:bg-accent"
          >
            Auto
          </button>
        </div>
      )}

      {/* Viewport */}
      <div
        ref={viewportRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={resetView}
        className="flex-1 flex items-center justify-center bg-black min-h-[400px] overflow-hidden cursor-crosshair select-none"
      >
        <img
          src={frameUrl}
          alt={`Frame ${currentFrame + 1}`}
          draggable={false}
          className="max-w-full max-h-full object-contain pointer-events-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: dragRef.current ? "none" : "transform 60ms linear",
            imageRendering: "auto",
          }}
        />
      </div>

      {/* Frame slider — extra vertical padding so the range thumb stays
          inside the container (some browsers render it ~16px tall). */}
      {totalFrames > 1 && (
        <div className="px-4 py-3 border-t bg-muted/30 flex-shrink-0">
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e) => setCurrentFrame(Number(e.target.value))}
            className="block w-full accent-primary"
          />
        </div>
      )}
    </div>
  );
}
