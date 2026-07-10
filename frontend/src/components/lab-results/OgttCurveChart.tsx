import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { parseOgttMinutes } from "@/lib/ogtt";

interface LabRow {
  id: number;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  test_name_original: string | null;
  test_name_canonical: string | null;
}

/**
 * OGTT ("curva glicemica") curve. X axis is minutes from the glucose load,
 * Y axis is glucose concentration (typically mg/dL).
 *
 * WHO / ADA diagnostic thresholds for the 75 g OGTT at the 2 h mark:
 *   • 140 mg/dL → impaired glucose tolerance
 *   • 200 mg/dL → diabetes
 * Drawn as dashed reference lines for orientation.
 */
export default function OgttCurveChart({ rows }: { rows: LabRow[] }) {
  const points = rows
    .map((r) => {
      const minutes = parseOgttMinutes(r.test_name_original);
      if (minutes === null) return null;
      const v = r.value;
      if (v == null) return null;
      return { minutes, value: v };
    })
    .filter((p): p is { minutes: number; value: number } => p !== null)
    .sort((a, b) => a.minutes - b.minutes);

  // Merge duplicate minutes (rare — same-minute repeat reading) by averaging.
  const merged = new Map<number, number>();
  for (const p of points) {
    const existing = merged.get(p.minutes);
    merged.set(
      p.minutes,
      existing == null ? p.value : (existing + p.value) / 2,
    );
  }
  const data = [...merged.entries()]
    .map(([minutes, value]) => ({ minutes, value }))
    .sort((a, b) => a.minutes - b.minutes);

  if (data.length < 2) {
    return (
      <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
        Not enough parseable glucose readings to plot a curve.
      </div>
    );
  }

  const unit = rows.find((r) => r.unit)?.unit || "mg/dL";

  return (
    <div className="rounded-md border bg-background p-2 sm:p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Glucose curve (OGTT) — {data.length} points · unit {unit}
      </div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 5, right: 16, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
            <XAxis
              dataKey="minutes"
              type="number"
              domain={[0, "dataMax"]}
              ticks={[0, 30, 60, 90, 120, 150, 180]}
              label={{
                value: "minutes",
                position: "insideBottom",
                offset: -2,
                fontSize: 11,
              }}
              stroke="currentColor"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis stroke="currentColor" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(v: any) => [`${v} ${unit}`, "Glucose"]}
              labelFormatter={(m: any) => `T+${m} min`}
            />
            {/* WHO / ADA 2-hour thresholds (only meaningful when unit is mg/dL). */}
            {unit.toLowerCase().includes("mg") && (
              <>
                <ReferenceLine
                  y={140}
                  stroke="#f59e0b"
                  strokeDasharray="4 3"
                  label={{
                    value: "IGT 140",
                    position: "right",
                    fontSize: 10,
                    fill: "#f59e0b",
                  }}
                />
                <ReferenceLine
                  y={200}
                  stroke="#ef4444"
                  strokeDasharray="4 3"
                  label={{
                    value: "Diabetes 200",
                    position: "right",
                    fontSize: 10,
                    fill: "#ef4444",
                  }}
                />
              </>
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
