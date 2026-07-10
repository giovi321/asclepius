import { describe, it, expect } from "vitest";
import {
  classifySwipe,
  clampScale,
  focalScrollAfterZoom,
  isDoubleTap,
  pinchCentroid,
  pinchDistance,
} from "./gestureMath";

describe("pinchDistance / pinchCentroid", () => {
  it("computes the spread between two pointers", () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("computes the midpoint focal", () => {
    expect(pinchCentroid({ x: 0, y: 10 }, { x: 10, y: 30 })).toEqual({
      x: 5,
      y: 20,
    });
  });
});

describe("clampScale", () => {
  it("clamps into [min, max]", () => {
    expect(clampScale(0.2, 0.5, 3)).toBe(0.5);
    expect(clampScale(5, 0.5, 3)).toBe(3);
    expect(clampScale(1.7, 0.5, 3)).toBe(1.7);
  });
});

describe("focalScrollAfterZoom", () => {
  it("keeps the content point under the focal point stationary", () => {
    // Content point under focal: scroll 100 + focal 50 = 150. After 2x zoom
    // that point sits at 300; new scroll must be 300 - 50 = 250.
    expect(
      focalScrollAfterZoom({
        scrollLeft: 100,
        scrollTop: 40,
        focalX: 50,
        focalY: 10,
        ratio: 2,
      }),
    ).toEqual({ scrollLeft: 250, scrollTop: 90 });
  });

  it("never returns negative scroll", () => {
    const r = focalScrollAfterZoom({
      scrollLeft: 0,
      scrollTop: 0,
      focalX: 100,
      focalY: 100,
      ratio: 0.5,
    });
    expect(r.scrollLeft).toBe(0);
    expect(r.scrollTop).toBe(0);
  });

  it("is identity at ratio 1", () => {
    expect(
      focalScrollAfterZoom({
        scrollLeft: 123,
        scrollTop: 45,
        focalX: 10,
        focalY: 20,
        ratio: 1,
      }),
    ).toEqual({ scrollLeft: 123, scrollTop: 45 });
  });
});

describe("classifySwipe", () => {
  it("detects a fast horizontal swipe left", () => {
    expect(classifySwipe(-80, 10, 200)).toBe("left");
  });

  it("detects a fast horizontal swipe right", () => {
    expect(classifySwipe(80, -10, 200)).toBe("right");
  });

  it("rejects slow drags", () => {
    expect(classifySwipe(-80, 10, 600)).toBeNull();
  });

  it("rejects short travel", () => {
    expect(classifySwipe(-30, 0, 100)).toBeNull();
  });

  it("rejects diagonal drags without horizontal dominance", () => {
    expect(classifySwipe(-60, 40, 200)).toBeNull();
  });
});

describe("isDoubleTap", () => {
  it("accepts two quick close taps", () => {
    expect(
      isDoubleTap({ x: 10, y: 10, time: 0 }, { x: 15, y: 12, time: 200 }),
    ).toBe(true);
  });

  it("rejects slow second taps", () => {
    expect(
      isDoubleTap({ x: 10, y: 10, time: 0 }, { x: 10, y: 10, time: 400 }),
    ).toBe(false);
  });

  it("rejects far-apart taps", () => {
    expect(
      isDoubleTap({ x: 10, y: 10, time: 0 }, { x: 60, y: 10, time: 100 }),
    ).toBe(false);
  });

  it("rejects when there is no previous tap", () => {
    expect(isDoubleTap(null, { x: 0, y: 0, time: 0 })).toBe(false);
  });
});
