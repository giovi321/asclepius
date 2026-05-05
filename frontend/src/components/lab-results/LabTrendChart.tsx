import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Tailwind "primary" / "accent" equivalents in HSL-ish hex so recharts can
// draw them directly. Rotated per series.
const SERIES_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
];

interface LabRow {
  id: number;
  test_date: string | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  reference_range_low: number | null;
  reference_range_high: number | null;
  canonical_code: string | null;
  test_name_canonical: string | null;
  test_name_original: string | null;
}

interface Props {
  rows: LabRow[];
  selectedCodes: string[];
}

/**
 * Line chart of lab values over time, one series per selected canonical code.
 * X axis is test_date; Y axis is the numeric value. A faint reference band
 * is drawn using the MOST COMMON reference range across the selected rows
 * (ranges vary by lab, so we pick the mode to avoid a mess of overlapping
 * bands).
 */
export default function LabTrendChart({ rows, selectedCodes }: Props) {
  if (selectedCodes.length === 0) return null;

  // Filter to the selected codes + rows with a numeric value + a date.
  const usable = rows.filter(
    (r) =>
      r.canonical_code != null &&
      selectedCodes.includes(r.canonical_code) &&
      r.value != null &&
      r.test_date != null,
  );

  if (usable.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No numeric values to chart for the selected tests.
      </div>
    );
  }

  // Build { date, [code]: value } points, grouped by date.
  const byDate = new Map<string, Record<string, number>>();
  for (const r of usable) {
    const key = r.test_date as string;
    if (!byDate.has(key)) byDate.set(key, {});
    const code = r.canonical_code as string;
    const existing = byDate.get(key)![code];
    // If two rows on the same date share a code, average them — avoids flickery
    // duplicates when the same panel was entered twice.
    byDate.get(key)![code] =
      existing == null
        ? (r.value as number)
        : (existing + (r.value as number)) / 2;
  }
  const data = Array.from(byDate.entries())
    .map(([date, vals]) => ({ date, ...vals }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Display label per code — prefer the canonical display, fall back to code.
  const labelByCode: Record<string, string> = {};
  for (const r of usable) {
    if (r.canonical_code && !labelByCode[r.canonical_code]) {
      labelByCode[r.canonical_code] =
        r.test_name_canonical || r.canonical_code || r.test_name_original || "";
    }
  }

  // Pick a reference band (mode of range for the first selected code).
  let refBand: { low: number; high: number } | null = null;
  const first = selectedCodes[0];
  const ranges = usable.filter(
    (r) =>
      r.canonical_code === first &&
      r.reference_range_low != null &&
      r.reference_range_high != null,
  );
  if (ranges.length > 0) {
    const counts = new Map<string, { n: number; low: number; high: number }>();
    for (const r of ranges) {
      const k = `${r.reference_range_low}-${r.reference_range_high}`;
      const e = counts.get(k) || {
        n: 0,
        low: r.reference_range_low!,
        high: r.reference_range_high!,
      };
      e.n += 1;
      counts.set(k, e);
    }
    const mode = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    if (mode) refBand = { low: mode.low, high: mode.high };
  }

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Trend — {data.length} data point{data.length === 1 ? "" : "s"}
        </span>
        {refBand && (
          <span>
            Reference band (shaded): {refBand.low}–{refBand.high}
          </span>
        )}
      </div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 5, right: 16, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
            <XAxis
              dataKey="date"
              stroke="currentColor"
              tick={{ fontSize: 11 }}
            />
            <YAxis stroke="currentColor" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {refBand && (
              <ReferenceArea
                y1={refBand.low}
                y2={refBand.high}
                fill="#22c55e"
                fillOpacity={0.08}
                strokeOpacity={0}
              />
            )}
            {selectedCodes.map((code, i) => (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                name={labelByCode[code] || code}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
