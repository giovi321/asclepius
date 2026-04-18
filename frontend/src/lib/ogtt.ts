/**
 * Parse the time offset (minutes) of a glucose measurement taken during an
 * Oral Glucose Tolerance Test ("curva glicemica") from its test name.
 *
 * Returns the offset in minutes (0 for fasting/basal/T0), or null if the name
 * doesn't look like a time-offset glucose measurement.
 *
 * Recognized shapes (case-insensitive):
 *   T0 / T+0 / T-0 / "glicemia T0" / "glucose T 0"
 *   T30 / T+30 / T-30 / "glucose T+120"
 *   60' / 90′ / "glucose 60'"
 *   "60 min" / "90 minutes" / "2 hour" / "2h" / "120 m"
 *   "basal" / "basale" / "a digiuno" / "fasting" / "pre" → 0
 */

// Italian words that mean "the baseline / fasting reading" (minute offset = 0).
const FASTING_WORDS = /\b(basale|basal|digiuno|fasting|pre[-\s]?prandial|pre\b)/i;

// Only glucose measurements should yield a minute offset — a random HbA1c
// labelled "T90 HbA1c" still shouldn't pass.
const GLUCOSE_WORDS = /\b(gluc|glyc|glic|zucchero|suga?r|glukos|ogtt|tolerance)/i;

/** Return the minute offset (0..720) parsed out of a test name, or null. */
export function parseOgttMinutes(testName: string | null | undefined): number | null {
  if (!testName) return null;
  const raw = String(testName);

  const hasGlucose = GLUCOSE_WORDS.test(raw);

  // T-prefix pattern: T0, T+30, T 120, t-90, "T +60"
  const t = raw.match(/(?:^|[\s_\-(])t\s*[+\-]?\s*(\d{1,3})\b/i);
  if (t && hasGlucose) return clamp(parseInt(t[1], 10));

  // Minute / prime markers — only trusted when we see a glucose keyword nearby.
  // Accept ASCII "'" and typographic "′" / "’" / "`".
  const primes = raw.match(/\b(\d{1,3})\s*['\u2032\u2019`]/);
  if (primes && hasGlucose) return clamp(parseInt(primes[1], 10));

  const min = raw.match(/\b(\d{1,3})\s*(?:m(?:in(?:uti?|utes?)?)?)\b/i);
  if (min && hasGlucose) return clamp(parseInt(min[1], 10));

  // Hours: "2 h", "2h", "2 hour", "2 ore", "1 ora"
  const hr = raw.match(/\b(\d{1,2})\s*(?:h|hr|hour|ora|ore|std)\b/i);
  if (hr && hasGlucose) return clamp(parseInt(hr[1], 10) * 60);

  // Fasting / basal keywords — treat as T0.
  if (FASTING_WORDS.test(raw) && hasGlucose) return 0;

  return null;
}

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 720) return 720;
  return n;
}

/**
 * Does a group of lab-result rows (all on the same document) look like an
 * OGTT? Rule of thumb: at least 3 rows parse to a minute offset and all
 * appear to be glucose.
 */
export function looksLikeOgtt(rows: Array<{ test_name_original?: string | null }>): boolean {
  const parsed = rows.filter((r) => parseOgttMinutes(r.test_name_original) !== null);
  return parsed.length >= 3;
}
