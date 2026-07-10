import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { usePatient } from "@/contexts/PatientContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useToast } from "@/contexts/ToastContext";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Search,
  TestTube,
} from "lucide-react";
import OgttCurveChart from "@/components/lab-results/OgttCurveChart";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { looksLikeOgtt } from "@/lib/ogtt";
import type { LabRow } from "@/pages/lab-results/types";
import { useLabResults } from "@/pages/lab-results/useLabResults";
import { TrendChartPanel } from "@/pages/lab-results/TrendChartPanel";
import { OrphanReviewModal } from "@/pages/lab-results/OrphanReviewModal";
import { RowsTable } from "@/pages/lab-results/RowsTable";

export default function LabResultsPage() {
  const { selectedPatient } = usePatient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [groupByDate, setGroupByDate] = useState(true);
  const [showOrphans, setShowOrphans] = useState(false);
  const [orphanBusy, setOrphanBusy] = useState<number | "all" | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVals, setEditVals] = useState<Partial<LabRow>>({});
  const [saving, setSaving] = useState(false);

  const { results, orphans, setOrphans, loading, load } = useLabResults(
    selectedPatient,
    search,
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
      const d = getErrorMessage(err, "Save failed");
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
      const d = getErrorMessage(err, "Delete failed");
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
      const d = getErrorMessage(err, "Delete failed");
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
      <TrendChartPanel rows={results} />

      {/* Results */}
      {loading ? (
        <SkeletonRows rows={6} cols={4} className="rounded-lg border" />
      ) : results.length === 0 ? (
        <div className="rounded-lg border">
          <EmptyState
            icon={TestTube}
            title="No lab results"
            description={
              search.trim()
                ? `No tests match "${search.trim()}". Try a different search.`
                : "Lab values extracted from uploaded documents show up here. Upload a lab report and run extraction to populate this list."
            }
          />
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
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-accent/40"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-medium">{g.date}</span>
                  {g.document_id && g.filename ? (
                    <Link
                      to={`/documents/${g.document_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex min-w-0 max-w-full items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <FileText className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{g.filename}</span>
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
      <OrphanReviewModal
        open={showOrphans}
        onClose={() => setShowOrphans(false)}
        orphans={orphans}
        orphanBusy={orphanBusy}
        deleteOrphan={deleteOrphan}
        deleteAllOrphans={deleteAllOrphans}
      />
    </div>
  );
}
