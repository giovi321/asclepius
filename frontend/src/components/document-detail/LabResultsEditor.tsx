import { useEffect, useMemo, useRef, useState } from "react";
import api from "@/api/client";
import { TestTube, Pencil, Trash2, Plus, Search } from "lucide-react";
import { Section } from "./DocumentDetailHelpers";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useLabTests } from "@/hooks/data";

type LabRow = {
  id?: number;
  test_name_original?: string | null;
  test_name_canonical?: string | null;
  canonical_code?: string | null;
  norm_lab_test_id?: number | null;
  value?: number | null;
  value_text?: string | null;
  unit?: string | null;
  reference_range_low?: number | null;
  reference_range_high?: number | null;
  is_abnormal?: boolean | null;
  sample_type?: string | null;
  panel_name?: string | null;
  test_date?: string | null;
};

// A blank draft used for new rows.
const blankDraft = (): LabRow => ({
  test_name_original: "",
  value: null,
  value_text: null,
  unit: null,
  reference_range_low: null,
  reference_range_high: null,
  is_abnormal: false,
  sample_type: null,
  panel_name: null,
  test_date: null,
  norm_lab_test_id: null,
});

// Number inputs return "" for empty; normalize to null, and parse numerics.
const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function TestPicker({
  value, canonicalId, onPick,
}: {
  value: string;
  canonicalId: number | null | undefined;
  onPick: (v: { name: string; normId: number | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const { data: labTests, loading } = useLabTests();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value || ""); }, [value]);

  // Filter client-side — the normalization table is bounded (seeded list,
  // plus user-added aliases) so pulling it once and matching in JS is fast.
  const options = useMemo(() => {
    const list = Array.isArray(labTests) ? labTests : [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((o: any) =>
      (o.canonical_display || "").toLowerCase().includes(q) ||
      (o.canonical_code || "").toLowerCase().includes(q),
    );
  }, [labTests, query]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const q = query.trim().toLowerCase();
  const exact = options.some((o: any) => (o.canonical_display || "").toLowerCase() === q);
  const canCreate = q.length > 0 && !exact;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); onPick({ name: e.target.value, normId: null }); }}
          onFocus={() => setOpen(true)}
          placeholder="Search or create test..."
          className="w-full rounded border bg-background pl-7 pr-2 py-1 text-sm"
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border bg-background shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
          ) : (
            <>
              {options.length === 0 && !canCreate && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No matches. Type a name to create one.
                </div>
              )}
              {options.slice(0, 50).map((opt: any) => {
                const d = opt.canonical_display || "";
                const isCurrent = canonicalId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onPick({ name: d, normId: opt.id }); setQuery(d); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent ${isCurrent ? "bg-accent/40" : ""}`}
                  >
                    <span className="truncate">{d}</span>
                    {opt.canonical_code && (
                      <span className="text-[10px] font-mono text-muted-foreground truncate">
                        {opt.canonical_code}
                      </span>
                    )}
                  </button>
                );
              })}
              {canCreate && (
                <button
                  type="button"
                  onClick={() => { onPick({ name: query.trim(), normId: null }); setOpen(false); }}
                  className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-primary hover:bg-primary/10"
                >
                  <Plus className="h-3 w-3" />
                  Use: <span className="font-medium">"{query.trim()}"</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EditorRow({
  docId, row, onCancel, onSaved,
}: {
  docId: number;
  row: LabRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<LabRow>(row);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<LabRow>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    const name = (draft.test_name_original || "").trim();
    if (!name) {
      toast({ title: "Test name is required", variant: "error" });
      return;
    }
    setSaving(true);
    const payload = {
      test_name_original: name,
      value: draft.value,
      value_text: draft.value_text || null,
      unit: draft.unit || null,
      reference_range_low: draft.reference_range_low,
      reference_range_high: draft.reference_range_high,
      is_abnormal: !!draft.is_abnormal,
      sample_type: draft.sample_type || null,
      panel_name: draft.panel_name || null,
      test_date: draft.test_date || null,
      norm_lab_test_id: draft.norm_lab_test_id ?? null,
    };
    try {
      if (draft.id) {
        await api.patch(`/lab-results/${draft.id}`, payload);
      } else {
        await api.post(`/lab-results`, { document_id: docId, ...payload });
      }
      onSaved();
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Failed to save";
      toast({ title: typeof d === "string" ? d : "Failed to save", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="align-top">
      <td colSpan={6} className="py-2">
        <div className="rounded border bg-muted/30 p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="text-muted-foreground block mb-1">Test</span>
              <TestPicker
                value={draft.test_name_original || ""}
                canonicalId={draft.norm_lab_test_id}
                onPick={({ name, normId }) => set({ test_name_original: name, norm_lab_test_id: normId })}
              />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground block mb-1">Date</span>
              <input type="date"
                value={draft.test_date || ""}
                onChange={(e) => set({ test_date: e.target.value || null })}
                className="w-full rounded border bg-background px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground block mb-1">Value (numeric)</span>
              <input type="number" step="any"
                value={draft.value ?? ""}
                onChange={(e) => set({ value: numOrNull(e.target.value) })}
                className="w-full rounded border bg-background px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground block mb-1">Value (text)</span>
              <input type="text"
                value={draft.value_text || ""}
                onChange={(e) => set({ value_text: e.target.value })}
                placeholder="e.g. Positive, Negative"
                className="w-full rounded border bg-background px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground block mb-1">Unit</span>
              <input type="text"
                value={draft.unit || ""}
                onChange={(e) => set({ unit: e.target.value })}
                className="w-full rounded border bg-background px-2 py-1 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                <span className="text-muted-foreground block mb-1">Ref low</span>
                <input type="number" step="any"
                  value={draft.reference_range_low ?? ""}
                  onChange={(e) => set({ reference_range_low: numOrNull(e.target.value) })}
                  className="w-full rounded border bg-background px-2 py-1 text-sm" />
              </label>
              <label className="text-xs">
                <span className="text-muted-foreground block mb-1">Ref high</span>
                <input type="number" step="any"
                  value={draft.reference_range_high ?? ""}
                  onChange={(e) => set({ reference_range_high: numOrNull(e.target.value) })}
                  className="w-full rounded border bg-background px-2 py-1 text-sm" />
              </label>
            </div>
            <label className="text-xs">
              <span className="text-muted-foreground block mb-1">Sample type</span>
              <input type="text"
                value={draft.sample_type || ""}
                onChange={(e) => set({ sample_type: e.target.value })}
                placeholder="e.g. serum, urine"
                className="w-full rounded border bg-background px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground block mb-1">Panel</span>
              <input type="text"
                value={draft.panel_name || ""}
                onChange={(e) => set({ panel_name: e.target.value })}
                placeholder="e.g. CBC, Lipid"
                className="w-full rounded border bg-background px-2 py-1 text-sm" />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox"
                checked={!!draft.is_abnormal}
                onChange={(e) => set({ is_abnormal: e.target.checked })} />
              <span>Abnormal</span>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={onCancel} disabled={saving}
                className="rounded border px-3 py-1 text-xs">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={saving}
                className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50">
                {saving ? "Saving..." : (draft.id ? "Save" : "Add")}
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function LabResultsEditor({
  docId, patientId, docType, labResults, onChange,
}: {
  docId: number;
  patientId: number | null;
  docType: string | null | undefined;
  labResults: LabRow[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<number | "new" | null>(null);

  const isLabType = docType === "bloodtest" || docType === "labtest_other";
  const rows = labResults || [];
  // Hide the whole block when doc isn't a lab doc AND has no existing labs —
  // keeps the UI clean on unrelated doc types.
  if (!isLabType && rows.length === 0) return null;

  const startAdd = () => {
    if (!patientId) {
      toast({ title: "Assign a patient to this document first", variant: "error" });
      return;
    }
    setEditingId("new");
  };

  const onRowSaved = () => { setEditingId(null); onChange(); };

  const del = async (id: number) => {
    const ok = await confirm({ title: "Delete this lab result?", variant: "destructive" });
    if (!ok) return;
    try {
      await api.delete(`/lab-results/${id}`);
      onChange();
    } catch (err: any) {
      const d = err?.response?.data?.detail || "Failed to delete";
      toast({ title: typeof d === "string" ? d : "Failed to delete", variant: "error" });
    }
  };

  return (
    <Section title="Lab Results" icon={TestTube}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1 text-left font-medium">Test</th>
              <th className="py-1 text-left font-medium">Value</th>
              <th className="py-1 text-left font-medium">Unit</th>
              <th className="py-1 text-left font-medium">Ref</th>
              <th className="py-1 text-left font-medium">Date</th>
              <th className="py-1 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((lr) =>
              editingId === lr.id ? (
                <EditorRow key={lr.id} docId={docId} row={lr}
                  onCancel={() => setEditingId(null)}
                  onSaved={onRowSaved} />
              ) : (
                <tr key={lr.id} className={lr.is_abnormal ? "text-red-600" : ""}>
                  <td className="py-1 pr-2">
                    <div className="font-medium">
                      {lr.test_name_canonical || lr.test_name_original || "\u2014"}
                    </div>
                    {lr.test_name_canonical && lr.test_name_original && lr.test_name_canonical !== lr.test_name_original && (
                      <div className="text-[11px] text-muted-foreground">{lr.test_name_original}</div>
                    )}
                  </td>
                  <td className="py-1 pr-2 font-medium">{lr.value ?? lr.value_text ?? "\u2014"}</td>
                  <td className="py-1 pr-2">{lr.unit || ""}</td>
                  <td className="py-1 pr-2 text-muted-foreground">
                    {lr.reference_range_low != null && lr.reference_range_high != null
                      ? `${lr.reference_range_low}\u2013${lr.reference_range_high}`
                      : "\u2014"}
                  </td>
                  <td className="py-1 pr-2 text-muted-foreground">{lr.test_date || "\u2014"}</td>
                  <td className="py-1 text-right">
                    <div className="inline-flex gap-1">
                      <button type="button" onClick={() => setEditingId(lr.id!)}
                        className="rounded border p-1 hover:bg-accent" title="Edit">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => del(lr.id!)}
                        className="rounded border p-1 hover:bg-accent text-destructive" title="Delete">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {editingId === "new" && (
              <EditorRow docId={docId} row={blankDraft()}
                onCancel={() => setEditingId(null)}
                onSaved={onRowSaved} />
            )}
            {rows.length === 0 && editingId !== "new" && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-xs text-muted-foreground">
                  No lab results yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editingId !== "new" && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={startAdd}
            className="inline-flex items-center gap-1 rounded border px-3 py-1 text-xs hover:bg-accent">
            <Plus className="h-3 w-3" /> Add test
          </button>
        </div>
      )}
    </Section>
  );
}
