/**
 * Pure gesture math shared by the pan/zoom/selection hooks. No DOM access —
 * everything here is unit-testable with plain numbers.
 */

export interface Point {
  x: number;
  y: number;
}

/** Straight-line distance between two pointers (pinch spread). */
export function pinchDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Midpoint between two pointers (pinch focal point). */
export function pinchCentroid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function clampScale(scale: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, scale));
}

/**
 * Scroll offsets that keep the content point under the fingers stationary
 * after a zoom commit. Given the pre-zoom scroll position and the focal
 * point in viewport (container-local) coordinates, the content coordinate
 * under the focal point is `scroll + focal`; after scaling by `ratio` that
 * content point sits at `(scroll + focal) * ratio`, so the new scroll must
 * place it back under the focal point.
 */
export function focalScrollAfterZoom(args: {
  scrollLeft: number;
  scrollTop: number;
  focalX: number;
  focalY: number;
  ratio: number;
}): { scrollLeft: number; scrollTop: number } {
  const { scrollLeft, scrollTop, focalX, focalY, ratio } = args;
  return {
    scrollLeft: Math.max(0, (scrollLeft + focalX) * ratio - focalX),
    scrollTop: Math.max(0, (scrollTop + focalY) * ratio - focalY),
  };
}

/**
 * Classify a completed one-finger drag as a horizontal swipe.
 * Requirements: >= 50px horizontal travel, horizontal dominance
 * (|dx| > 2|dy|), completed in under 400ms. Returns the direction of
 * page-turn intent ("left" = fingers moved left = next page).
 */
export function classifySwipe(
  dx: number,
  dy: number,
  dtMs: number,
): "left" | "right" | null {
  if (dtMs >= 400) return null;
  if (Math.abs(dx) < 50) return null;
  if (Math.abs(dx) <= 2 * Math.abs(dy)) return null;
  return dx < 0 ? "left" : "right";
}

/** Whether two taps constitute a double-tap (time and travel budget). */
export function isDoubleTap(
  prev: { x: number; y: number; time: number } | null,
  next: { x: number; y: number; time: number },
): boolean {
  if (!prev) return false;
  if (next.time - prev.time >= 300) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) < 24;
}

/** Live check for the OS reduced-motion preference. Any transform applied
 *  for double-tap zoom must snap (no transition) when this is true;
 *  finger-tracking transforms are direct manipulation and exempt. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
