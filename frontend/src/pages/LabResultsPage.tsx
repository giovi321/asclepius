import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useToast } from "@/contexts/ToastContext";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileText,
  LineChart as LineChartIcon,
  Search,
  TestTube,
  Trash2,
  X,
} from "lucide-react";
import LabTrendChart from "@/components/lab-results/LabTrendChart";
import OgttCurveChart from "@/components/lab-results/OgttCurveChart";
import { looksLikeOgtt } from "@/lib/ogtt";

interface LabRow {
  id: number;
  document_id: number | null;
  document_filename: string | null;
  document_doc_type: string | null;
  document_event_date: string | null;
  document_missing: number; // SQLite returns 0/1
  patient_id: number;
  test_name_original: string;
  test_name_canonical: string | null;
  canonical_code: string | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  reference_range_low: number | null;
  reference_range_high: number | null;
  is_abnormal: number | null;
  sample_type: string | null;
  panel_name: string | null;
  test_date: string | null;
}

export default function LabResultsPage() {
  const { selectedPatient } = usePatient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [results, setResults] = useState<LabRow[]>([]);
  const [orphans, setOrphans] = useState<LabRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupByDate, setGroupByDate] = useState(true);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartSearch, setChartSearch] = useState("");
  const [showAllTests, setShowAllTests] = useState(false);
  const [showOrphans, setShowOrphans] = useState(false);
  const [orphanBusy, setOrphanBusy] = useState<number | "all" | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVals, setEditVals] = useState<Partial<LabRow>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!selectedPatient) {
      setResults([]);
      setOrphans([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params: Record<string, any> = {
      patient_id: selectedPatient.id,
      limit: 500,
    };
    if (search) params.test_name = search;
    try {
      const [res, orphRes] = await Promise.all([
        api.get("/lab-results", { params }),
        api.get("/lab-results/orphans", {
          params: { patient_id: selectedPatient.id },
        }),
      ]);
      setResults(res.data.items || []);
      setOrphans(orphRes.data.items || []);
    } catch {
      setResults([]);
      setOrphans([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [selectedPatient, search]);

  // Build the pool of canonical tests present in the current result set —
  // drives the chart picker. Only count rows that have a `test_date` AND a
  // numeric `value`, since the trend chart needs both axes to plot a point.
  // Tests with zero chartable datapoints are dropped entirely.
  const canonicalOptions = useMemo(() => {
    const byCode = new Map<
      string,
      { code: string; label: string; count: number }
    >();
    for (const r of results) {
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
  }, [results]);

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

  // Group by (test_date, document_id) when grouping is on. Falls back to the
  // source document's date when the lab row itself has no test_date — otherwise
  // rows parsed from a dated document would cluster under a "no date" header.
  const groups = useMemo(() => {
    if (!groupByDate) return null;
    const m = new Map<
      string,
      {
        key: string;
        date: string;
        document_id: number | null;
        filename: string | null;
        rows: LabRow[];
        abnormal: number;
      }
    >();
    for (const r of results) {
      const effectiveDate = r.test_date || r.document_event_date;
      const key = `${effectiveDate || "no-date"}|${r.document_id ?? "none"}`;
      if (!m.has(key)) {
        m.set(key, {
          key,
          date: effectiveDate || "no date",
          document_id: r.document_id,
          filename: r.document_filename,
          rows: [],
          abnormal: 0,
        });
      }
      const g = m.get(key)!;
      g.rows.push(r);
      if (r.is_abnormal) g.abnormal += 1;
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [results, groupByDate]);

  const toggleCode = (code: string) => {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const startEdit = (row: LabRow) => {
    setEditingId(row.id);
    setEditVals({
      test_name_original: row.test_name_original,
      value: row.value,
      value_text: row.value_text,
      unit: row.unit,
      reference_range_low: row.reference_range_low,
      reference_range_high: row.reference_range_high,
      is_abnormal: row.is_abnormal,
      panel_name: row.panel_name,
      test_date: row.test_date,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditVals({});
  };

  const saveEdit = async (id: number) => {
    setSaving(true);
    try {
      // Strip fields that haven't actually changed — keeps PATCH minimal.
      const body: any = { ...editVals };
      for (const k of Object.keys(body)) {
        if (body[k] === "" || body[k] === undefined) body[k] = null;
      }
      await api.patch(`/lab-results/${id}`, body);
      setEditingId(null);
      setEditVals({});
      await load();
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Save failed";
      toast({
        title: "Save failed",
        description: typeof d === "string" ? d : JSON.stringify(d),
        variant: "error",
      });
    }
    setSaving(false);
  };

  const deleteRow = async (row: LabRow) => {
    const ok = await confirm({
      title: "Delete this lab result?",
      description: `${row.test_name_canonical || row.test_name_original}${row.value != null ? ` = ${row.value}${row.unit ? " " + row.unit : ""}` : ""} on ${row.test_date || "unknown date"} will be removed. The source document is untouched.`,
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/lab-results/${row.id}`);
      await load();
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Delete failed";
      toast({
        title: "Delete failed",
        description: typeof d === "string" ? d : JSON.stringify(d),
        variant: "error",
      });
    }
  };

  const deleteOrphan = async (row: LabRow) => {
    setOrphanBusy(row.id);
    try {
      await api.delete(`/lab-results/${row.id}`);
      setOrphans((prev) => prev.filter((o) => o.id !== row.id));
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Delete failed";
      toast({
        title: "Delete failed",
        description: typeof d === "string" ? d : JSON.stringify(d),
        variant: "error",
      });
    }
    setOrphanBusy(null);
  };

  const deleteAllOrphans = async () => {
    const ok = await confirm({
      title: `Delete ${orphans.length} orphan lab result${orphans.length === 1 ? "" : "s"}?`,
      description:
        "These results reference documents that no longer exist. Removing them keeps the list clean — the non-existent source documents are already gone.",
      variant: "destructive",
      confirmText: "Delete all",
    });
    if (!ok) return;
    setOrphanBusy("all");
    const failed: string[] = [];
    for (const o of orphans) {
      try {
        await api.delete(`/lab-results/${o.id}`);
      } catch {
        failed.push(`#${o.id}`);
      }
    }
    setOrphans([]);
    setShowOrphans(false);
    setOrphanBusy(null);
    await load();
    if (failed.length) {
      toast({
        title: `${failed.length} orphan(s) failed to delete`,
        description: failed.join(", "),
        variant: "error",
      });
    }
  };

  if (!selectedPatient) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <TestTube className="h-8 w-8" />
        <p>Select a patient to view lab results</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Orphan banner */}
      {orphans.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-yellow-400/60 bg-yellow-50 px-3 py-2 text-sm dark:border-yellow-700/50 dark:bg-yellow-900/20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <span>
              {orphans.length} lab result{orphans.length === 1 ? "" : "s"}{" "}
              reference a document that no longer exists.
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowOrphans(true)}
              className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
            >
              Review
            </button>
            <button
              onClick={deleteAllOrphans}
              disabled={orphanBusy === "all"}
              className="rounded-md bg-destructive px-2.5 py-1 text-xs text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {orphanBusy === "all" ? "Deleting..." : "Delete all"}
            </button>
          </div>
        </div>
      )}

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by test name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={groupByDate}
            onChange={(e) => setGroupByDate(e.target.checked)}
          />
          Group by test date
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {results.length} results
        </span>
      </div>

      {/* Chart picker + chart */}
      {canonicalOptions.length > 0 && (
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
                <LabTrendChart rows={results} selectedCodes={selectedCodes} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          No lab results found
        </div>
      ) : groupByDate && groups ? (
        <div className="space-y-2">
          {groups.map((g) => {
            const open = expandedGroups.has(g.key);
            const ogtt = looksLikeOgtt(g.rows);
            return (
              <div key={g.key} className="rounded-lg border">
                <button
                  onClick={() => toggleGroup(g.key)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/40"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-medium">{g.date}</span>
                  {g.document_id && g.filename ? (
                    <Link
                      to={`/documents/${g.document_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <FileText className="h-3 w-3" />
                      {g.filename}
                    </Link>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">
                      no document
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {g.rows.length} test{g.rows.length === 1 ? "" : "s"}
                    {g.abnormal > 0 && (
                      <span className="ml-2 text-red-600 dark:text-red-400">
                        {g.abnormal} abnormal
                      </span>
                    )}
                    {ogtt && (
                      <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                        OGTT
                      </span>
                    )}
                  </span>
                </button>
                {open && (
                  <div className="border-t p-3">
                    {ogtt && (
                      <div className="mb-3">
                        <OgttCurveChart rows={g.rows} />
                      </div>
                    )}
                    <RowsTable
                      rows={g.rows}
                      editingId={editingId}
                      editVals={editVals}
                      setEditVals={setEditVals}
                      startEdit={startEdit}
                      cancelEdit={cancelEdit}
                      saveEdit={saveEdit}
                      deleteRow={deleteRow}
                      saving={saving}
                      showDocument={false}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <RowsTable
            rows={results}
            editingId={editingId}
            editVals={editVals}
            setEditVals={setEditVals}
            startEdit={startEdit}
            cancelEdit={cancelEdit}
            saveEdit={saveEdit}
            deleteRow={deleteRow}
            saving={saving}
          />
        </div>
      )}

      {/* Orphan review modal */}
      {showOrphans && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowOrphans(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">
                Orphan lab results ({orphans.length})
              </h3>
              <button
                onClick={() => setShowOrphans(false)}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              These lab results reference a document that no longer exists.
              Review and delete any you don't want to keep.
            </p>
            <div className="divide-y rounded-md border">
              {orphans.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {o.test_name_canonical || o.test_name_original}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {o.test_date || "no date"}
                      {o.value != null && ` • ${o.value} ${o.unit || ""}`}
                      {o.value_text && !o.value && ` • ${o.value_text}`}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteOrphan(o)}
                    disabled={orphanBusy === o.id}
                    className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setShowOrphans(false)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Close
              </button>
              <button
                onClick={deleteAllOrphans}
                disabled={orphanBusy === "all"}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {orphanBusy === "all" ? "Deleting..." : "Delete all"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Rows table ────────────────────────────────────────────────────

interface RowsTableProps {
  rows: LabRow[];
  editingId: number | null;
  editVals: Partial<LabRow>;
  setEditVals: (v: Partial<LabRow>) => void;
  startEdit: (r: LabRow) => void;
  cancelEdit: () => void;
  saveEdit: (id: number) => void;
  deleteRow: (r: LabRow) => void;
  saving: boolean;
  showDocument?: boolean;
}

function RowsTable({
  rows,
  editingId,
  editVals,
  setEditVals,
  startEdit,
  cancelEdit,
  saveEdit,
  deleteRow,
  saving,
  showDocument = true,
}: RowsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b bg-muted/50">
        <tr>
          {showDocument && (
            <th className="px-3 py-2 text-left font-medium">Document</th>
          )}
          <th className="px-3 py-2 text-left font-medium">Test</th>
          <th className="px-3 py-2 text-left font-medium">Value</th>
          <th className="px-3 py-2 text-left font-medium">Unit</th>
          <th className="px-3 py-2 text-left font-medium">Reference</th>
          <th className="px-3 py-2 text-left font-medium">Date</th>
          <th className="px-3 py-2 text-left font-medium w-px whitespace-nowrap">
            Actions
          </th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((lr) => {
          const editing = editingId === lr.id;
          return (
            <tr
              key={lr.id}
              className={`${lr.is_abnormal ? "bg-red-50/50 dark:bg-red-950/30" : ""} ${editing ? "bg-accent/40" : ""}`}
            >
              {showDocument && (
                <td className="px-3 py-1.5 max-w-[220px] truncate">
                  {lr.document_id ? (
                    <Link
                      to={`/documents/${lr.document_id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      title={lr.document_filename || ""}
                    >
                      <FileText className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">
                        {lr.document_filename || `#${lr.document_id}`}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">
                      no document
                    </span>
                  )}
                </td>
              )}
              <td className="px-3 py-1.5">
                {editing ? (
                  <input
                    type="text"
                    value={(editVals.test_name_original as string) ?? ""}
                    onChange={(e) =>
                      setEditVals({
                        ...editVals,
                        test_name_original: e.target.value,
                      })
                    }
                    className="w-full rounded border bg-background px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  <span>{lr.test_name_canonical || lr.test_name_original}</span>
                )}
              </td>
              <td
                className={`px-3 py-1.5 font-medium ${lr.is_abnormal ? "text-red-600 dark:text-red-400" : ""}`}
              >
                {editing ? (
                  <input
                    type="number"
                    step="any"
                    value={(editVals.value as number) ?? ""}
                    onChange={(e) =>
                      setEditVals({
                        ...editVals,
                        value:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="w-24 rounded border bg-background px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  (lr.value ?? lr.value_text ?? "—")
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {editing ? (
                  <input
                    type="text"
                    value={(editVals.unit as string) ?? ""}
                    onChange={(e) =>
                      setEditVals({ ...editVals, unit: e.target.value })
                    }
                    className="w-20 rounded border bg-background px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  lr.unit || ""
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {editing ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="any"
                      value={(editVals.reference_range_low as number) ?? ""}
                      onChange={(e) =>
                        setEditVals({
                          ...editVals,
                          reference_range_low:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      className="w-16 rounded border bg-background px-1.5 py-0.5 text-sm"
                      placeholder="low"
                    />
                    <span>–</span>
                    <input
                      type="number"
                      step="any"
                      value={(editVals.reference_range_high as number) ?? ""}
                      onChange={(e) =>
                        setEditVals({
                          ...editVals,
                          reference_range_high:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      className="w-16 rounded border bg-background px-1.5 py-0.5 text-sm"
                      placeholder="high"
                    />
                  </div>
                ) : lr.reference_range_low != null &&
                  lr.reference_range_high != null ? (
                  `${lr.reference_range_low}–${lr.reference_range_high}`
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                {editing ? (
                  <input
                    type="date"
                    value={(editVals.test_date as string) ?? ""}
                    onChange={(e) =>
                      setEditVals({ ...editVals, test_date: e.target.value })
                    }
                    className="rounded border bg-background px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  lr.test_date || "—"
                )}
              </td>
              <td
                className="px-3 py-1.5 whitespace-nowrap"
                onClick={(e) => e.stopPropagation()}
              >
                {editing ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => saveEdit(lr.id)}
                      disabled={saving}
                      className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEdit(lr)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                      title="Edit"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => deleteRow(lr)}
                      className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
