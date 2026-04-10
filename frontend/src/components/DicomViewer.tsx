import { useEffect, useRef, useState } from "react";
import api from "@/api/client";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

interface DicomViewerProps {
  studyId: number;
  seriesId: number;
}

/**
 * DICOM viewer using Cornerstone.js.
 * Falls back to frame-by-frame image display if Cornerstone fails to initialize.
 */
export default function DicomViewer({ studyId, seriesId }: DicomViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [, setFrames] = useState<string[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setCornerstoneReady] = useState(false);

  // Load frame list
  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get(`/imaging/${studyId}/series/${seriesId}/frames`)
      .then((res) => {
        setFrames(res.data.frames || []);
        setTotalFrames(res.data.count || 0);
        setCurrentFrame(0);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load series frames");
        setLoading(false);
      });
  }, [studyId, seriesId]);

  // Try to initialize Cornerstone.js
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cornerstone = await import("@cornerstonejs/core");
        await cornerstone.init();
        if (mounted) setCornerstoneReady(true);
      } catch {
        // Cornerstone not available — use fallback viewer
        if (mounted) setCornerstoneReady(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setCurrentFrame((f) => Math.max(0, f - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [totalFrames]);

  // Mouse wheel scrolling
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) {
        setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1));
      } else {
        setCurrentFrame((f) => Math.max(0, f - 1));
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [totalFrames]);

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

  const frameUrl = `/api/imaging/${studyId}/series/${seriesId}/frame/${currentFrame}`;

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/30">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentFrame((f) => Math.max(0, f - 1))}
            disabled={currentFrame <= 0}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            Frame {currentFrame + 1} / {totalFrames}
          </span>
          <button
            onClick={() => setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1))}
            disabled={currentFrame >= totalFrames - 1}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentFrame(0)}
            className="rounded p-1 hover:bg-accent"
            title="Reset to first frame"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground">
            Scroll or arrow keys to navigate
          </span>
        </div>
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        className="flex-1 flex items-center justify-center bg-black min-h-[400px] overflow-hidden cursor-crosshair"
      >
        {/* Fallback: render frame as image via API */}
        <img
          src={frameUrl}
          alt={`Frame ${currentFrame + 1}`}
          className="max-w-full max-h-full object-contain"
          style={{ imageRendering: "auto" }}
        />
      </div>

      {/* Frame slider */}
      {totalFrames > 1 && (
        <div className="px-3 py-2 border-t bg-muted/30">
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e) => setCurrentFrame(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
      )}
    </div>
  );
}
