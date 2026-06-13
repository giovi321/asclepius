import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  LineChart as LineChartIcon,
  Search,
  X,
} from "lucide-react";
import LabTrendChart from "@/components/lab-results/LabTrendChart";
import type { LabRow } from "./types";

/**
 * Trend-chart feature for the lab-results page: the collapsible picker
 * (selected chips, fuzzy search, results list) plus the chart itself.
 *
 * Owns all chart-local state (selected codes, open/search/show-all toggles)
 * and the derived option lists — none of which were referenced anywhere
 * else on the page. Renders nothing when there are no chartable tests,
 * matching the original ``canonicalOptions.length > 0`` render gate.
 */
export function TrendChartPanel({ rows }: { rows: LabRow[] }) {
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartSearch, setChartSearch] = useState("");
  const [showAllTests, setShowAllTests] = useState(false);

  // Build the pool of canonical tests present in the current result set —
  // drives the chart picker. Only count rows that have a `test_date` AND a
  // numeric `value`, since the trend chart needs both axes to plot a point.
  // Tests with zero chartable datapoints are dropped entirely.
  const canonicalOptions = useMemo(() => {
    const byCode = new Map<
      string,
      { code: string; label: string; count: number }
    >();
    for (const r of rows) {
      if (!r.canonical_code) continue;
      if (!r.test_date || r.value == null) continue;
      const e = byCode.get(r.canonical_code) || {
        code: r.canonical_code,
        label: r.test_name_canonical || r.canonical_code,
        count: 0,
      };
      e.count += 1;
      byCode.set(r.canonical_code, e);
    }
    return [...byCode.values()].sort((a, b) => b.count - a.count);
  }, [rows]);

  // Subsequence fuzzy match: every char of the query must appear in order in
  // the candidate. Lightweight, no extra dep — and good enough to find
  // "hdl" inside "HDL Cholesterol" or "tsh" inside "TSH (Thyroid-...)".
  const fuzzyMatch = (query: string, text: string): boolean => {
    if (!query) return true;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t.includes(q)) return true; // fast path, also ranks exact substrings
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) qi += 1;
    }
    return qi === q.length;
  };

  const filteredChartOptions = useMemo(() => {
    const q = chartSearch.trim();
    if (!q && !showAllTests) return [];
    if (!q) return canonicalOptions;
    return canonicalOptions.filter(
      (o) => fuzzyMatch(q, o.label) || fuzzyMatch(q, o.code),
    );
  }, [canonicalOptions, chartSearch, showAllTests]);

  const selectedOptions = useMemo(
    () => canonicalOptions.filter((o) => selectedCodes.includes(o.code)),
    [canonicalOptions, selectedCodes],
  );

  const toggleCode = (code: string) => {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  if (canonicalOptions.length === 0) return null;

  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setChartOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-accent/40"
      >
        {chartOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <LineChartIcon className="h-4 w-4 text-primary" />
        <span>Trend chart</span>
        {selectedCodes.length > 0 && (
          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {selectedCodes.length} selected
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {canonicalOptions.length} test
          {canonicalOptions.length === 1 ? "" : "s"} available
        </span>
      </button>
      {chartOpen && (
        <div className="border-t p-3 space-y-3">
          {/* Selected chips */}
          {selectedOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedOptions.map((opt) => (
                <span
                  key={opt.code}
                  className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-xs text-primary"
                >
                  {opt.label}
                  <button
                    onClick={() => toggleCode(opt.code)}
                    className="rounded-full hover:bg-primary/20"
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button
                onClick={() => setSelectedCodes([])}
                className="rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                clear all
              </button>
            </div>
          )}

          {/* Search */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={chartSearch}
                onChange={(e) => setChartSearch(e.target.value)}
                placeholder="Search lab tests..."
                className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              onClick={() => setShowAllTests((v) => !v)}
              className="whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
            >
              {showAllTests ? "Hide list" : "Show all"}
            </button>
          </div>

          {/* Results list */}
          {filteredChartOptions.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-md border">
              {filteredChartOptions.map((opt) => {
                const on = selectedCodes.includes(opt.code);
                return (
                  <button
                    key={opt.code}
                    onClick={() => toggleCode(opt.code)}
                    className={`flex w-full items-center justify-between gap-2 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-accent/60 ${on ? "bg-primary/5" : ""}`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {on && (
                        <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                      )}
                      <span
                        className={`truncate ${on ? "font-medium text-primary" : ""}`}
                      >
                        {opt.label}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {opt.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {chartSearch.trim() && filteredChartOptions.length === 0 && (
            <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              No tests match "{chartSearch}".
            </div>
          )}

          {selectedCodes.length > 0 && (
            <LabTrendChart rows={rows} selectedCodes={selectedCodes} />
          )}
        </div>
      )}
    </div>
  );
}
