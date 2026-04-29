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
  Contrast,
  Info,
  X,
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
  // when both are null. Either slider can move independently — the
  // backend now falls back to the file's other tag for the missing
  // axis, so a single slider move applies immediately.
  const isMR = (modality || "").toUpperCase() === "MR";
  const [wc, setWc] = useState<number | null>(null);
  const [ww, setWw] = useState<number | null>(null);
  const [invert, setInvert] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaItems, setMetaItems] = useState<any[] | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaQuery, setMetaQuery] = useState("");

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
    setInvert(false);
    setMetaItems(null);
    setMetaQuery("");
  }, [studyId, seriesId]);

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
      .get(`/imaging/${studyId}/series/${seriesId}/frame/${currentFrame}/metadata`)
      .then((res) => setMetaItems(Array.isArray(res.data?.items) ? res.data.items : []))
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
    setInvert(false);
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
  if (invert) params.set("invert", "1");
  // Ask the backend to bicubic-upscale the PNG so the CSS-zoomed image
  // stays sharp. Schedule keeps the effective on-screen pixel ratio
  // close to 1: pick a backend upscale that's at least the visible zoom.
  const upscale =
    zoom >= 5 ? 8 : zoom >= 3 ? 4 : zoom >= 1.5 ? 2 : 1;
  if (upscale > 1) params.set("upscale", String(upscale));
  const qs = params.toString();
  const frameUrl = `/api/imaging/${studyId}/series/${seriesId}/frame/${currentFrame}${qs ? `?${qs}` : ""}`;

  const filteredMetaItems = (metaItems || []).filter((it: any) => {
    const q = metaQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = `${it.keyword || ""} ${it.name || ""} ${it.tag || ""} ${it.value ?? ""}`.toLowerCase();
    return hay.includes(q);
  });

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
          <button
            onClick={() => setInvert((v) => !v)}
            className={`rounded p-1 hover:bg-accent ${invert ? "bg-accent text-primary" : ""}`}
            title="Invert colours"
            aria-pressed={invert}
          >
            <Contrast className="h-4 w-4" />
          </button>
          <button
            onClick={openMetadata}
            className="rounded p-1 hover:bg-accent"
            title="View DICOM metadata"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground hidden md:block">
          <Move className="inline h-3 w-3" /> shift-drag · Ctrl+wheel zoom · arrows scroll
        </span>
      </div>

      {/* MRI contrast controls. Wider sliders + step=10 so a small mouse
          movement maps to a small window-level change. The previous
          step=1 over a 4096-value range made every pixel of slider
          travel jump the image by ~32 intensity units. */}
      {isMR && (
        <div className="flex items-center gap-3 border-b px-3 py-2 bg-muted/20 text-xs flex-wrap">
          <Sun className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <label className="flex items-center gap-2 flex-1 min-w-[200px]">
            <span className="text-muted-foreground w-12 flex-shrink-0">Center</span>
            <input
              type="range"
              min={-1024}
              max={3072}
              step={10}
              value={wc ?? 1024}
              onChange={(e) => setWc(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="tabular-nums w-14 text-right flex-shrink-0">{wc ?? "auto"}</span>
          </label>
          <label className="flex items-center gap-2 flex-1 min-w-[200px]">
            <span className="text-muted-foreground w-12 flex-shrink-0">Width</span>
            <input
              type="range"
              min={1}
              max={4096}
              step={10}
              value={ww ?? 2048}
              onChange={(e) => setWw(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="tabular-nums w-14 text-right flex-shrink-0">{ww ?? "auto"}</span>
          </label>
          <button
            onClick={resetContrast}
            className="rounded border px-2 py-0.5 hover:bg-accent flex-shrink-0"
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

      {/* DICOM metadata viewer — modal listing every header tag for the
          current frame. Search filters by keyword / name / value so the
          user can pin a tag without scrolling through hundreds of rows. */}
      {metaOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50"
          onClick={() => setMetaOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-[min(800px,90vw)] flex-col rounded-lg border bg-background shadow-xl"
          >
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Info className="h-4 w-4" />
                DICOM metadata
                <span className="text-xs font-normal text-muted-foreground">
                  Frame {currentFrame + 1} / {totalFrames}
                </span>
              </div>
              <button
                onClick={() => setMetaOpen(false)}
                className="rounded p-1 hover:bg-accent"
                aria-label="Close metadata panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b px-4 py-2">
              <input
                type="text"
                value={metaQuery}
                onChange={(e) => setMetaQuery(e.target.value)}
                placeholder="Filter by tag, keyword or value..."
                className="w-full rounded border bg-background px-2 py-1 text-sm"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {metaLoading ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">Loading metadata...</div>
              ) : !metaItems || metaItems.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No metadata available.</div>
              ) : filteredMetaItems.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No tags match the filter.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 border-b bg-muted/50">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium w-20">Tag</th>
                      <th className="px-3 py-1.5 text-left font-medium w-12">VR</th>
                      <th className="px-3 py-1.5 text-left font-medium">Name</th>
                      <th className="px-3 py-1.5 text-left font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredMetaItems.map((it: any, i: number) => (
                      <tr key={`${it.tag}-${i}`}>
                        <td className="px-3 py-1 font-mono text-[11px] text-muted-foreground">{it.tag}</td>
                        <td className="px-3 py-1 font-mono text-[11px] text-muted-foreground">{it.vr}</td>
                        <td className="px-3 py-1">{it.name}</td>
                        <td className="px-3 py-1 break-all">
                          {it.value === null || it.value === undefined ? (
                            <span className="text-muted-foreground italic">none</span>
                          ) : (
                            String(it.value)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
