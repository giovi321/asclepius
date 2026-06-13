/**
 * Shared date/time helpers for backend timestamps.
 *
 * The backend writes most timestamps with ``datetime.utcnow().isoformat()``,
 * which emits **naive** ISO strings like ``2026-05-03T13:00:00`` (no ``Z``, no
 * ``+HH:MM`` offset). ``new Date(...)`` parses those as *local* time per the
 * ECMAScript spec, so anything rendered in a non-UTC zone ends up offset by
 * the local UTC offset. The canonical fix is to treat a tz-less string as UTC
 * by appending ``Z`` before constructing the ``Date``. These helpers centralise
 * that so individual components can't forget it (which is exactly the bug
 * RegionTranslationsSection's old ``formatTs`` had).
 */

/**
 * Parse an ISO timestamp coming from the backend, treating naive strings
 * (no ``Z``, no ``+HH:MM`` / ``-HH:MM`` offset) as UTC. Returns epoch
 * milliseconds, or ``null`` when the input is empty or unparseable.
 */
export function parseBackendTs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts);
  const ms = new Date(hasTz ? ts : `${ts}Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Format a backend timestamp as a localized absolute date+time using the
 * runtime's default locale formatting (``Date.prototype.toLocaleString()``).
 * Returns the raw input back when it can't be parsed, and ``""`` for empty
 * input. This matches the majority inline copies (``formatLocal`` /
 * ``formatAbsolute``).
 */
export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const ms = parseBackendTs(ts);
  if (ms == null) return ts;
  return new Date(ms).toLocaleString();
}

/**
 * Render a coarse duration in seconds as a compact human string:
 * ``45s`` · ``12m`` · ``3h 20m`` · ``2d`` · ``5d 4h``. Mirrors the
 * SessionsTab formatter that feeds the relative-time labels.
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(s / 3600);
  if (hr < 24) {
    const m = Math.round((s - hr * 3600) / 60);
    return m > 0 ? `${hr}h ${m}m` : `${hr}h`;
  }
  const days = Math.floor(s / 86400);
  const remHr = Math.round((s - days * 86400) / 3600);
  if (days < 7 && remHr > 0) return `${days}d ${remHr}h`;
  return `${days}d`;
}

/**
 * Render a backend timestamp relative to now.
 *
 * ``direction`` selects the framing, matching the two original inline
 * formatters:
 *   - ``"past"``   → ``"3m ago"``; ``"just now"`` when the timestamp is in
 *                    the future (negative elapsed).
 *   - ``"future"`` → ``"in 2h"``; ``"expired"`` once the timestamp is at or
 *                    in the past.
 * Returns ``""`` for empty/unparseable input.
 */
export function formatRelative(
  ts: string | null | undefined,
  direction: "past" | "future" = "past",
): string {
  const ms = parseBackendTs(ts);
  if (ms == null) return "";
  if (direction === "future") {
    const delta = (ms - Date.now()) / 1000;
    if (delta <= 0) return "expired";
    return `in ${formatDuration(delta)}`;
  }
  const delta = (Date.now() - ms) / 1000;
  if (delta < 0) return "just now";
  return `${formatDuration(delta)} ago`;
}
