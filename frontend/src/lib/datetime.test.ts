import { describe, it, expect } from "vitest";
import { parseBackendTs, formatDuration } from "./datetime";

describe("parseBackendTs", () => {
  it("treats a naive (tz-less) ISO string as UTC", () => {
    // 2026-05-03T13:00:00 with no zone must be read as 13:00 UTC, i.e. the
    // same instant as the explicit ...Z form below.
    const naive = parseBackendTs("2026-05-03T13:00:00");
    expect(naive).toBe(Date.UTC(2026, 4, 3, 13, 0, 0));
  });

  it("matches the explicit-Z form for the same wall-clock string", () => {
    expect(parseBackendTs("2026-05-03T13:00:00")).toBe(
      parseBackendTs("2026-05-03T13:00:00Z"),
    );
  });

  it("respects an explicit UTC offset rather than re-appending Z", () => {
    // +02:00 means 13:00 local == 11:00 UTC.
    expect(parseBackendTs("2026-05-03T13:00:00+02:00")).toBe(
      Date.UTC(2026, 4, 3, 11, 0, 0),
    );
  });

  it("returns null for empty / nullish input", () => {
    expect(parseBackendTs(null)).toBeNull();
    expect(parseBackendTs(undefined)).toBeNull();
    expect(parseBackendTs("")).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(parseBackendTs("not a date")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("renders sub-minute durations in seconds", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("renders minutes below an hour", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(20 * 60)).toBe("20m");
  });

  it("renders hours with remaining minutes", () => {
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3h 20m");
    expect(formatDuration(2 * 3600)).toBe("2h");
  });

  it("renders days, with a remaining-hours suffix under a week", () => {
    expect(formatDuration(2 * 86400 + 5 * 3600)).toBe("2d 5h");
    expect(formatDuration(10 * 86400)).toBe("10d");
  });

  it("clamps negative input to 0s", () => {
    expect(formatDuration(-5)).toBe("0s");
  });
});
