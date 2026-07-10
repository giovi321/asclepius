import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Bbox in normalized [0,1] coords relative to the rendered page. */
export interface NormalizedBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SelectionCorner = "nw" | "ne" | "sw" | "se";

export interface UseRegionSelectionOptions {
  /** The page wrapper the rect is drawn against (bbox normalization base). */
  wrapperRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** Esc pressed or cancel() called. */
  onCancel?: () => void;
}

const MIN_RECT_FINE = 6;
/** Fat-finger taps on coarse pointers shouldn't lock sliver rects. */
const MIN_RECT_COARSE = 24;

/**
 * Pointer-events drag-rectangle selection with post-lock refinement.
 * Replaces the mouse-only drawingRect/lockedRect logic that was duplicated
 * in PdfViewer and ShareDocumentViewer; pointer capture makes the same
 * code path work for mouse, touch, and pen.
 *
 * States: idle → drawing (pointer down on wrapper) → locked (pointer up
 * with a big-enough rect). While locked, corner handles resize and
 * dragging inside the rect moves it. The consumer flips the wrapper to
 * `touch-action: none` while enabled — one-finger draw must never scroll.
 *
 * confirm() converts the locked rect to a normalized [0,1] bbox against
 * the wrapper's current bounding rect. The wrapper must carry no CSS
 * transform at confirm time (selection mode disables pinch by
 * construction; a dev-mode assert guards the invariant).
 */
export function useRegionSelection({
  wrapperRef,
  enabled,
  onCancel,
}: UseRegionSelectionOptions) {
  const [drawingRect, setDrawingRect] = useState<SelectionRect | null>(null);
  const [lockedRect, setLockedRect] = useState<SelectionRect | null>(null);
  const gestureRef = useRef<{
    mode: "draw" | "move" | "resize";
    pointerId: number;
    corner?: SelectionCorner;
    /** Draw: anchor point. Move: pointer offset from rect origin.
     *  Resize: the fixed opposite corner. */
    origin: { x: number; y: number };
    startRect: SelectionRect | null;
    pointerType: string;
  } | null>(null);

  const reset = useCallback(() => {
    setDrawingRect(null);
    setLockedRect(null);
    gestureRef.current = null;
  }, []);

  // Leaving selection mode clears everything.
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  // Esc cancels selection mode entirely.
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        reset();
        onCancel?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onCancel, reset]);

  const localPoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return null;
      const rect = wrapper.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
        width: rect.width,
        height: rect.height,
      };
    },
    [wrapperRef],
  );

  /** Attach to the page wrapper's onPointerDown. Starts a fresh draw, or a
   *  move when the press lands inside the locked rect. */
  const startDraw = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const p = localPoint(e);
      if (!p) return;

      const locked = lockedRect;
      if (
        locked &&
        p.x >= locked.x &&
        p.x <= locked.x + locked.w &&
        p.y >= locked.y &&
        p.y <= locked.y + locked.h
      ) {
        // Drag inside the locked rect moves it whole.
        gestureRef.current = {
          mode: "move",
          pointerId: e.pointerId,
          origin: { x: p.x - locked.x, y: p.y - locked.y },
          startRect: locked,
          pointerType: e.pointerType,
        };
      } else {
        gestureRef.current = {
          mode: "draw",
          pointerId: e.pointerId,
          origin: { x: p.x, y: p.y },
          startRect: null,
          pointerType: e.pointerType,
        };
        setDrawingRect({ x: p.x, y: p.y, w: 0, h: 0 });
        setLockedRect(null);
      }
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    [enabled, localPoint, lockedRect],
  );

  /** Attach to a corner handle's onPointerDown. */
  const startResize = useCallback(
    (corner: SelectionCorner, e: React.PointerEvent) => {
      if (!enabled || !lockedRect) return;
      const r = lockedRect;
      // The corner opposite the grabbed one stays fixed.
      const anchor = {
        x: corner === "nw" || corner === "sw" ? r.x + r.w : r.x,
        y: corner === "nw" || corner === "ne" ? r.y + r.h : r.y,
      };
      gestureRef.current = {
        mode: "resize",
        pointerId: e.pointerId,
        corner,
        origin: anchor,
        startRect: r,
        pointerType: e.pointerType,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    [enabled, lockedRect],
  );

  // Window-level move/up: pointer capture keeps events flowing to the
  // captured element, but listening on the window survives handle unmounts.
  useEffect(() => {
    if (!enabled) return;
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const p = localPoint(e);
      if (!p) return;

      if (g.mode === "draw") {
        const x = Math.min(g.origin.x, p.x);
        const y = Math.min(g.origin.y, p.y);
        setDrawingRect({
          x,
          y,
          w: Math.abs(p.x - g.origin.x),
          h: Math.abs(p.y - g.origin.y),
        });
      } else if (g.mode === "move" && g.startRect) {
        const x = Math.max(
          0,
          Math.min(p.width - g.startRect.w, p.x - g.origin.x),
        );
        const y = Math.max(
          0,
          Math.min(p.height - g.startRect.h, p.y - g.origin.y),
        );
        setLockedRect({ ...g.startRect, x, y });
      } else if (g.mode === "resize") {
        const x = Math.min(g.origin.x, p.x);
        const y = Math.min(g.origin.y, p.y);
        setLockedRect({
          x,
          y,
          w: Math.abs(p.x - g.origin.x),
          h: Math.abs(p.y - g.origin.y),
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      gestureRef.current = null;
      if (g.mode === "draw") {
        setDrawingRect((final) => {
          const min =
            g.pointerType === "touch" ? MIN_RECT_COARSE : MIN_RECT_FINE;
          if (final && final.w >= min && final.h >= min) {
            setLockedRect(final);
          }
          return null;
        });
      }
      // move/resize: the locked rect is already up to date.
    };

    const onCancelEvt = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      gestureRef.current = null;
      if (g.mode === "draw") setDrawingRect(null);
      else if (g.startRect) setLockedRect(g.startRect);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancelEvt);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancelEvt);
    };
  }, [enabled, localPoint]);

  /** Normalized bbox of the locked rect, clearing it. Null when nothing is
   *  locked or the wrapper is unmeasurable. */
  const confirm = useCallback((): NormalizedBbox | null => {
    const wrapper = wrapperRef.current;
    const rect = lockedRect;
    if (!wrapper || !rect) return null;
    if (import.meta.env.DEV) {
      const t = getComputedStyle(wrapper).transform;
      if (t && t !== "none") {
        console.warn(
          "useRegionSelection: wrapper has a CSS transform at confirm time; bbox will be wrong",
        );
      }
    }
    const wrapperRect = wrapper.getBoundingClientRect();
    if (wrapperRect.width <= 0 || wrapperRect.height <= 0) return null;
    setLockedRect(null);
    return {
      x: rect.x / wrapperRect.width,
      y: rect.y / wrapperRect.height,
      w: rect.w / wrapperRect.width,
      h: rect.h / wrapperRect.height,
    };
  }, [wrapperRef, lockedRect]);

  const cancel = useCallback(() => {
    reset();
    onCancel?.();
  }, [reset, onCancel]);

  return {
    /** Rect to render right now (in-flight draw takes precedence). */
    activeRect: drawingRect ?? lockedRect,
    /** Non-null while awaiting confirm/cancel. */
    lockedRect,
    startDraw,
    startResize,
    confirm,
    cancel,
    /** Clear on page change. */
    reset,
  };
}
