import { useEffect, useRef, type RefObject } from "react";
import {
  classifySwipe,
  isDoubleTap,
  pinchCentroid,
  pinchDistance,
  type Point,
} from "@/lib/gestureMath";

export interface PinchGesture {
  /** Scale factor relative to the gesture start (1.0 = unchanged). */
  ratio: number;
  /** Focal point in target-element-local coordinates. */
  focalX: number;
  focalY: number;
}

export interface DragGesture {
  /** Delta since the previous move event. */
  dx: number;
  dy: number;
  /** Current position, target-element-local. */
  x: number;
  y: number;
  first: boolean;
  last: boolean;
  pointerType: string;
}

export interface PanZoomGestureOptions {
  targetRef: RefObject<HTMLElement | null>;
  /** Suspend all gesture handling (e.g. while selection mode owns input). */
  disabled?: boolean;
  /**
   * Continuous two-pointer pinch. Consumers must apply a CSS transform
   * only — NEVER feed this into a re-render-triggering scale (the pdf.js
   * worker crashes under concurrent renders; see the viewer plan).
   */
  onPinch?: (g: PinchGesture) => void;
  /** Fired once when the pinch ends (last finger up or pointercancel).
   *  This is the commit point for real scale changes. */
  onPinchEnd?: (g: PinchGesture) => void;
  /** Two quick taps within 300ms / 24px. */
  onDoubleTap?: (pt: Point) => void;
  /** Completed horizontal one-finger swipe. Only reachable when the
   *  element's touch-action leaves horizontal drags to JS (e.g. pan-y). */
  onSwipe?: (dir: "left" | "right") => void;
  /** One-finger drag stream (mouse always; touch when touch-action lets
   *  JS keep the pointer). */
  onDrag?: (d: DragGesture) => void;
  /** Centroid translation while two pointers are down (pinch-pan). */
  onTwoFingerDrag?: (d: { dx: number; dy: number }) => void;
  /** Desktop wheel preserved: ctrl/meta+wheel → onZoom(±1) with the
   *  browser zoom suppressed; plain wheel → onPlain(deltaY). */
  wheel?: {
    onZoom?: (direction: 1 | -1) => void;
    onPlain?: (deltaY: number) => void;
  };
}

/**
 * Unified pointer-events gesture layer for the document viewers.
 *
 * All state lives in refs — the hook never triggers React renders on
 * pointer movement. Every pointer is captured on pointerdown; if the
 * browser claims the gesture for native scrolling (per the element's
 * touch-action), it fires pointercancel, which ends the gesture and
 * commits the current pinch ratio (drags abort silently).
 *
 * iOS Safari belt-and-braces: the proprietary gesturestart/gesturechange
 * events are preventDefault-ed on the target so a pinch that begins inside
 * the viewer can never zoom the page, even if touch-action handling lags.
 */
export function usePanZoomGestures(opts: PanZoomGestureOptions): void {
  // Latest-ref pattern: handlers can be inline closures without re-binding
  // native listeners on every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stateRef = useRef({
    pointers: new Map<number, Point>(),
    // pinch
    pinching: false,
    pinchStartDist: 0,
    lastRatio: 1,
    lastCentroid: null as Point | null,
    // one-finger drag / tap
    dragPointerId: null as number | null,
    dragOrigin: null as (Point & { time: number }) | null,
    dragLast: null as Point | null,
    dragMoved: false,
    dragDelivered: false,
    // double tap
    lastTap: null as (Point & { time: number }) | null,
  });

  useEffect(() => {
    const el = opts.targetRef.current;
    if (!el || opts.disabled) return;
    const s = stateRef.current;

    const local = (e: PointerEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const resetDrag = () => {
      s.dragPointerId = null;
      s.dragOrigin = null;
      s.dragLast = null;
      s.dragMoved = false;
      s.dragDelivered = false;
    };

    const endPinch = (commit: boolean) => {
      if (!s.pinching) return;
      s.pinching = false;
      if (commit && s.lastCentroid) {
        optsRef.current.onPinchEnd?.({
          ratio: s.lastRatio,
          focalX: s.lastCentroid.x,
          focalY: s.lastCentroid.y,
        });
      }
      s.pinchStartDist = 0;
      s.lastRatio = 1;
      s.lastCentroid = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      const o = optsRef.current;
      s.pointers.set(e.pointerId, local(e));
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Capture can fail if the pointer is already gone; harmless.
      }

      if (s.pointers.size === 2) {
        // Second finger down: a one-finger drag in flight aborts and the
        // pinch begins from the current spread.
        if (s.dragDelivered && s.dragLast) {
          o.onDrag?.({
            dx: 0,
            dy: 0,
            x: s.dragLast.x,
            y: s.dragLast.y,
            first: false,
            last: true,
            pointerType: e.pointerType,
          });
        }
        resetDrag();
        const [a, b] = [...s.pointers.values()];
        s.pinching = true;
        s.pinchStartDist = Math.max(1, pinchDistance(a, b));
        s.lastRatio = 1;
        s.lastCentroid = pinchCentroid(a, b);
      } else if (s.pointers.size === 1) {
        const p = local(e);
        s.dragPointerId = e.pointerId;
        s.dragOrigin = { ...p, time: e.timeStamp };
        s.dragLast = p;
        s.dragMoved = false;
        s.dragDelivered = false;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return;
      const o = optsRef.current;
      const p = local(e);
      s.pointers.set(e.pointerId, p);

      if (s.pinching && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()];
        const centroid = pinchCentroid(a, b);
        const ratio = pinchDistance(a, b) / s.pinchStartDist;
        if (s.lastCentroid) {
          const dx = centroid.x - s.lastCentroid.x;
          const dy = centroid.y - s.lastCentroid.y;
          if (dx !== 0 || dy !== 0) o.onTwoFingerDrag?.({ dx, dy });
        }
        s.lastRatio = ratio;
        s.lastCentroid = centroid;
        o.onPinch?.({ ratio, focalX: centroid.x, focalY: centroid.y });
        e.preventDefault();
        return;
      }

      if (e.pointerId === s.dragPointerId && s.dragOrigin && s.dragLast) {
        const dx = p.x - s.dragLast.x;
        const dy = p.y - s.dragLast.y;
        const totalDx = p.x - s.dragOrigin.x;
        const totalDy = p.y - s.dragOrigin.y;
        if (!s.dragMoved && Math.hypot(totalDx, totalDy) < 4) return;
        const first = !s.dragDelivered;
        s.dragMoved = true;
        s.dragDelivered = true;
        s.dragLast = p;
        o.onDrag?.({
          dx,
          dy,
          x: p.x,
          y: p.y,
          first,
          last: false,
          pointerType: e.pointerType,
        });
      }
    };

    const finishPointer = (e: PointerEvent, cancelled: boolean) => {
      if (!s.pointers.has(e.pointerId)) return;
      const o = optsRef.current;
      s.pointers.delete(e.pointerId);

      if (s.pinching) {
        if (s.pointers.size < 2) {
          // Commit even on pointercancel: the user saw the preview at this
          // ratio, snapping back would discard their intent.
          endPinch(true);
          // The remaining finger (if any) does not become a drag — gestures
          // restart cleanly when all pointers lift.
          resetDrag();
        }
        return;
      }

      if (e.pointerId === s.dragPointerId && s.dragOrigin && s.dragLast) {
        const origin = s.dragOrigin;
        const last = local(e);
        const dt = e.timeStamp - origin.time;
        const totalDx = last.x - origin.x;
        const totalDy = last.y - origin.y;

        if (s.dragDelivered) {
          o.onDrag?.({
            dx: 0,
            dy: 0,
            x: last.x,
            y: last.y,
            first: false,
            last: true,
            pointerType: e.pointerType,
          });
        }

        if (!cancelled) {
          if (s.dragMoved) {
            const dir = classifySwipe(totalDx, totalDy, dt);
            if (dir) o.onSwipe?.(dir);
          } else if (dt < 250) {
            const tap = { x: last.x, y: last.y, time: e.timeStamp };
            if (isDoubleTap(s.lastTap, tap)) {
              s.lastTap = null;
              o.onDoubleTap?.({ x: tap.x, y: tap.y });
            } else {
              s.lastTap = tap;
            }
          }
        }
        resetDrag();
      }
    };

    const onPointerUp = (e: PointerEvent) => finishPointer(e, false);
    const onPointerCancel = (e: PointerEvent) => finishPointer(e, true);

    const onWheel = (e: WheelEvent) => {
      const o = optsRef.current;
      if (e.ctrlKey || e.metaKey) {
        if (!o.wheel?.onZoom) return;
        e.preventDefault();
        o.wheel.onZoom(e.deltaY < 0 ? 1 : -1);
      } else if (o.wheel?.onPlain) {
        e.preventDefault();
        o.wheel.onPlain(e.deltaY);
      }
    };

    // iOS Safari proprietary pinch events; not in TS lib.dom.
    const preventGesture = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", preventGesture);
    el.addEventListener("gesturechange", preventGesture);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", preventGesture);
      el.removeEventListener("gesturechange", preventGesture);
      s.pointers.clear();
      s.pinching = false;
      resetDrag();
    };
    // Re-bind only when the element or disabled flag changes; handlers go
    // through optsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.targetRef, opts.disabled, opts.targetRef.current]);
}
