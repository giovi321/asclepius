import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "@/api/client";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useToast } from "@/contexts/ToastContext";
import {
  Plus, Trash2, Save, Check, Search, Edit3, GitMerge, X, ChevronRight,
  FileText, Sparkles, Loader2,
} from "lucide-react";

const NORM_TYPES = [
  "lab_tests", "specialties", "diagnoses", "medications", "doctors", "facilities",
] as const;
type NormType = typeof NORM_TYPES[number];
const DEFAULT_NORM: NormType = "lab_tests";

function isNormType(v: string | undefined): v is NormType {
  return !!v && (NORM_TYPES as readonly string[]).includes(v);
}

export default function NormalizationTab() {
  const confirm = useConfirm();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  // Pathname shape: /settings/analysis/normalization/<normType>
  const segments = location.pathname.split("/").filter(Boolean);
  const normType: NormType = isNormType(segments[3]) ? segments[3] as NormType : DEFAULT_NORM;
  const setNormType = (v: string) => {
    navigate(`/settings/analysis/normalization/${v}`, { replace: false });
  };
  const [normItems, setNormItems] = useState<any[]>([]);
  const [normFilter, setNormFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [editCode, setEditCode] = useState("");
  const [editDisplay, setEditDisplay] = useState("");
  const [editing, setEditing] = useState(false);
  const [newAlias, setNewAlias] = useState("");
  const [newAliasLang, setNewAliasLang] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [showMergeFor, setShowMergeFor] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchTargetId, setBatchTargetId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [batchNewDisplay, setBatchNewDisplay] = useState("");
  const [batchNewCode, setBatchNewCode] = useState("");
  const [rowNewDisplay, setRowNewDisplay] = useState("");
  const [rowNewCode, setRowNewCode] = useState("");
  const [linkedDocs, setLinkedDocs] = useState<any[] | null>(null);
  const [linkedDocsFor, setLinkedDocsFor] = useState<{ id: number; name: string } | null>(null);
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [autoMergeLoading, setAutoMergeLoading] = useState(false);
  const [autoMergeProposals, setAutoMergeProposals] = useState<any[] | null>(null);
  const [autoMergeEntries, setAutoMergeEntries] = useState<any[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(() => {
    const params: Record<string, any> = {};
    if (normFilter) params.filter = normFilter;
    if (searchQuery) params.search = searchQuery;
    api.get(`/normalization/${normType}`, { params }).then((res: any) => {
      setNormItems(Array.isArray(res.data) ? res.data : []);
    });
  }, [normType, normFilter, searchQuery]);

  useEffect(() => { loadList(); }, [loadList]);

  // Clear selection and any open detail when switching entity type or filters
  // (URL navigation can change normType without the select onChange firing).
  useEffect(() => {
    setSelectedIds(new Set());
    setBatchTargetId(null);
    setExpandedId(null);
    setDetail(null);
  }, [normType, normFilter, searchQuery]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === normItems.length && normItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(normItems.map((i: any) => i.id)));
    }
  };

  const handleBatchMerge = async () => {
    if (selectedIds.size === 0) return;

    let payload: any;
    let sources: number[];
    let label: string;

    if (batchTargetId === -1) {
      // Create new target
      if (!batchNewDisplay.trim()) {
        toast({ title: "Display name is required for a new target.", variant: "warning" });
        return;
      }
      sources = Array.from(selectedIds);
      label = `new "${batchNewDisplay.trim()}"`;
      payload = {
        source_ids: sources,
        new_target: {
          canonical_code: batchNewCode.trim(),
          canonical_display: batchNewDisplay.trim(),
        },
      };
    } else if (batchTargetId) {
      sources = Array.from(selectedIds).filter((id) => id !== batchTargetId);
      if (sources.length === 0) return;
      label = "the selected target";
      payload = { source_ids: sources, target_id: batchTargetId };
    } else {
      return;
    }

    const ok = await confirm({
      title: `Merge ${sources.length} entries?`,
      description: `Aliases and references will be moved into ${label}, and the source rows will be deleted.`,
      confirmText: "Merge",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.post(`/normalization/${normType}/merge-batch`, payload);
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Merge failed";
      toast({ title: "Merge failed", description: typeof d === "string" ? d : JSON.stringify(d), variant: "error" });
      return;
    }
    setSelectedIds(new Set());
    setBatchTargetId(null);
    setBatchNewDisplay("");
    setBatchNewCode("");
    setExpandedId(null);
    setDetail(null);
    loadList();
  };

  // Debounced search
  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(val), 300);
  };

  // Load detail when expanding a row
  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      setEditing(false);
      return;
    }
    setExpandedId(id);
    setEditing(false);
    setShowMergeFor(null);
    const res = await api.get(`/normalization/${normType}/${id}`);
    setDetail(res.data);
    setEditCode(res.data.canonical_code || "");
    setEditDisplay(res.data.canonical_display || "");
  };

  const handleSaveEdit = async () => {
    if (!expandedId) return;
    setSaveError(null);
    try {
      await api.patch(`/normalization/${normType}/${expandedId}`, {
        canonical_code: editCode,
        canonical_display: editDisplay,
      });
      setEditing(false);
      // Reload detail and list
      const res = await api.get(`/normalization/${normType}/${expandedId}`);
      setDetail(res.data);
      loadList();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || "Save failed";
      setSaveError(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
  };

  const handleViewDocuments = async (id: number, name: string) => {
    setLinkedDocsFor({ id, name });
    setLinkedDocs(null);
    setLinkedLoading(true);
    try {
      const res = await api.get(`/normalization/${normType}/${id}/documents`);
      setLinkedDocs(Array.isArray(res.data) ? res.data : []);
    } catch {
      setLinkedDocs([]);
    } finally {
      setLinkedLoading(false);
    }
  };

  const closeLinkedDocs = () => {
    setLinkedDocsFor(null);
    setLinkedDocs(null);
  };

  const handleAutoMerge = async () => {
    setAutoMergeLoading(true);
    setAutoMergeProposals(null);
    try {
      const res = await api.post(`/normalization/${normType}/auto-merge`);
      setAutoMergeProposals(Array.isArray(res.data?.proposals) ? res.data.proposals : []);
      setAutoMergeEntries(Array.isArray(res.data?.entries) ? res.data.entries : []);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || "Auto-merge request failed";
      toast({ title: "Auto-merge failed", description: typeof detail === "string" ? detail : JSON.stringify(detail), variant: "error" });
    } finally {
      setAutoMergeLoading(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      description: "References from documents, encounters, imaging, and lab results will be cleared (the documents stay, they just lose this classification). Aliases will also be removed.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/normalization/${normType}/${id}`);
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Delete failed";
      toast({ title: "Delete failed", description: typeof d === "string" ? d : JSON.stringify(d), variant: "error" });
      return;
    }
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
    }
    closeLinkedDocs();
    loadList();
  };

  const applyProposal = async (proposal: { target_id: number; source_ids: number[] }) => {
    const sources = proposal.source_ids.filter((id) => id !== proposal.target_id);
    if (sources.length === 0) return;
    await api.post(`/normalization/${normType}/merge-batch`, {
      source_ids: sources,
      target_id: proposal.target_id,
    });
    // Drop the applied proposal from the list
    setAutoMergeProposals((prev) => prev?.filter((p) => p !== proposal) ?? null);
    loadList();
  };

  const updateProposalTarget = (idx: number, newTargetId: number) => {
    setAutoMergeProposals((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const cur = next[idx];
      // If the new target was among sources, swap it out
      next[idx] = {
        ...cur,
        target_id: newTargetId,
        source_ids: cur.source_ids
          .filter((s: number) => s !== newTargetId)
          .concat(cur.target_id !== newTargetId ? [cur.target_id] : []),
      };
      return next;
    });
  };

  const toggleProposalSource = (idx: number, sourceId: number) => {
    setAutoMergeProposals((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const cur = next[idx];
      const has = cur.source_ids.includes(sourceId);
      next[idx] = {
        ...cur,
        source_ids: has
          ? cur.source_ids.filter((s: number) => s !== sourceId)
          : [...cur.source_ids, sourceId],
      };
      return next;
    });
  };

  const handleAddAlias = async () => {
    if (!expandedId || !newAlias.trim()) return;
    const res = await api.post(`/normalization/${normType}/${expandedId}/aliases`, {
      alias: newAlias.trim(),
      language: newAliasLang.trim() || null,
    });
    setDetail(res.data);
    setNewAlias("");
    setNewAliasLang("");
    loadList();
  };

  const handleDeleteAlias = async (aliasId: number) => {
    const ok = await confirm({
      title: "Delete this alias?",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/normalization/${normType}/aliases/${aliasId}`);
    if (expandedId) {
      const res = await api.get(`/normalization/${normType}/${expandedId}`);
      setDetail(res.data);
    }
    loadList();
  };

  const handleConfirmAll = async (id: number) => {
    await api.post(`/normalization/${normType}/${id}/confirm`);
    if (expandedId === id) {
      const res = await api.get(`/normalization/${normType}/${id}`);
      setDetail(res.data);
    }
    loadList();
  };

  const handleMerge = async (sourceId: number, targetId: number) => {
    let payload: any;
    let label: string;
    if (targetId === -1) {
      if (!rowNewDisplay.trim()) {
        toast({ title: "Display name is required for a new target.", variant: "warning" });
        return;
      }
      label = `new "${rowNewDisplay.trim()}"`;
      payload = {
        source_ids: [sourceId],
        new_target: {
          canonical_code: rowNewCode.trim(),
          canonical_display: rowNewDisplay.trim(),
        },
      };
    } else {
      label = "the target";
      payload = { source_ids: [sourceId], target_id: targetId };
    }
    const ok = await confirm({
      title: "Merge this entry?",
      description: `All aliases and references will be moved into ${label}, and the source row will be deleted.`,
      confirmText: "Merge",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      // Use merge-batch so we can share the new-target path with batch merge.
      await api.post(`/normalization/${normType}/merge-batch`, payload);
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Merge failed";
      toast({ title: "Merge failed", description: typeof d === "string" ? d : JSON.stringify(d), variant: "error" });
      return;
    }
    setExpandedId(null);
    setDetail(null);
    setShowMergeFor(null);
    setMergeTargetId(null);
    setRowNewDisplay("");
    setRowNewCode("");
    loadList();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        Normalization maps different names for the same medical concept (e.g. "CBC", "Complete Blood Count", "Emocromo")
        to a single canonical entry. Click a row to view and manage its aliases, edit the canonical name, or merge duplicates.
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={normType} onChange={(e: any) => setNormType(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="lab_tests">Lab Tests</option>
          <option value="specialties">Specialties</option>
          <option value="diagnoses">Diagnoses</option>
          <option value="medications">Medications</option>
          <option value="doctors">Doctors</option>
          <option value="facilities">Facilities</option>
        </select>
        <select value={normFilter || ""} onChange={(e: any) => setNormFilter(e.target.value || null)}
          className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">All</option>
          <option value="unreviewed">Unreviewed only</option>
        </select>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" value={searchInput} onChange={(e: any) => handleSearchInput(e.target.value)}
            placeholder="Search by name, code, or alias..."
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm" />
          {searchInput && (
            <button onClick={() => { setSearchInput(""); setSearchQuery(""); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={handleAutoMerge}
          disabled={autoMergeLoading || normItems.length < 2}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
          title="Ask the AI to propose merges — you review and approve each one"
        >
          {autoMergeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Auto-merge with AI
        </button>
        <span className="text-xs text-muted-foreground">{normItems.length} entries</span>
      </div>

      {/* Auto-merge proposals panel */}
      {autoMergeProposals !== null && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              AI merge proposals ({autoMergeProposals.length})
            </div>
            <button
              onClick={() => setAutoMergeProposals(null)}
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              Close
            </button>
          </div>
          {autoMergeProposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No merge candidates found. All entries look distinct.
            </p>
          ) : (
            <div className="space-y-3">
              {autoMergeProposals.map((p: any, idx: number) => {
                const entryById: Record<number, any> = Object.fromEntries(
                  autoMergeEntries.map((e: any) => [e.id, e])
                );
                const groupIds: number[] = [p.target_id, ...p.source_ids];
                return (
                  <div key={idx} className="rounded-md border bg-background p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Target:</span>
                      <select
                        value={p.target_id}
                        onChange={(e: any) => updateProposalTarget(idx, Number(e.target.value))}
                        className="rounded-md border bg-background px-2 py-1 text-sm"
                      >
                        {groupIds.map((id: number) => (
                          <option key={id} value={id}>
                            {entryById[id]?.canonical_display || `#${id}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    {p.reason && (
                      <p className="text-xs italic text-muted-foreground">"{p.reason}"</p>
                    )}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">Merge these into target:</div>
                      {p.source_ids.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No sources selected.</p>
                      ) : (
                        p.source_ids.map((sid: number) => (
                          <label key={sid} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked
                              onChange={() => toggleProposalSource(idx, sid)}
                            />
                            <span>{entryById[sid]?.canonical_display || `#${sid}`}</span>
                            {entryById[sid]?.canonical_code && (
                              <span className="text-xs text-muted-foreground font-mono">
                                ({entryById[sid].canonical_code})
                              </span>
                            )}
                          </label>
                        ))
                      )}
                      {/* Allow re-adding a source that was toggled off — fetch untouched sources */}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => applyProposal(p)}
                        disabled={p.source_ids.length === 0}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-40"
                      >
                        <GitMerge className="h-3 w-3" /> Apply merge
                      </button>
                      <button
                        onClick={() => setAutoMergeProposals((prev) => prev?.filter((_: any, i: number) => i !== idx) ?? null)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Linked documents modal */}
      {linkedDocsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeLinkedDocs}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-5 shadow-xl" onClick={(e: any) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Documents referencing "{linkedDocsFor.name}"</h3>
              <button onClick={closeLinkedDocs} className="rounded-md p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            {linkedLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : (linkedDocs?.length ?? 0) === 0 ? (
              <div className="space-y-3 py-4">
                <p className="text-sm text-muted-foreground">
                  No documents reference this entry. It's safe to delete.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (linkedDocsFor) {
                        const { id, name } = linkedDocsFor;
                        handleDelete(id, name);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:bg-destructive/90"
                  >
                    <Trash2 className="h-3 w-3" /> Delete "{linkedDocsFor?.name}"
                  </button>
                  <button
                    onClick={closeLinkedDocs}
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {linkedDocs!.map((d: any) => (
                  <a
                    key={d.id}
                    href={`/documents/${d.id}`}
                    className="flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <span className="font-medium truncate">{d.original_filename || `Document #${d.id}`}</span>
                    <span className="text-xs text-muted-foreground">
                      {[d.doc_type, d.doc_date, d.patient_name].filter(Boolean).join(" • ")}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Batch merge bar — visible when at least one item is selected */}
      {selectedIds.size > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{selectedIds.size} selected</span>
            <span className="text-muted-foreground">Merge into:</span>
            <select
              value={batchTargetId ?? ""}
              onChange={(e: any) => {
                const v = e.target.value;
                if (v === "") setBatchTargetId(null);
                else setBatchTargetId(Number(v));
              }}
              className="rounded-md border bg-background px-2 py-1 text-sm max-w-xs"
            >
              <option value="">Select target...</option>
              <option value={-1}>+ Create new entry...</option>
              {normItems
                .filter((n: any) => !selectedIds.has(n.id))
                .map((n: any) => (
                  <option key={n.id} value={n.id}>
                    {n.canonical_display} ({n.canonical_code})
                  </option>
                ))}
            </select>
            <button
              onClick={handleBatchMerge}
              disabled={!batchTargetId || (batchTargetId === -1 && !batchNewDisplay.trim())}
              className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
            >
              <GitMerge className="h-3 w-3" /> Merge
            </button>
            <button
              onClick={() => { setSelectedIds(new Set()); setBatchTargetId(null); setBatchNewDisplay(""); setBatchNewCode(""); }}
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              Clear
            </button>
          </div>
          {batchTargetId === -1 && (
            <div className="flex flex-wrap items-center gap-2 pl-1">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Name
                <input
                  type="text"
                  value={batchNewDisplay}
                  onChange={(e: any) => setBatchNewDisplay(e.target.value)}
                  placeholder="e.g. Humanitas Medical Care"
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Code <span className="text-[10px]">(optional — defaults to slug of name)</span>
                <input
                  type="text"
                  value={batchNewCode}
                  onChange={(e: any) => setBatchNewCode(e.target.value)}
                  placeholder="auto"
                  className="rounded-md border bg-background px-2 py-1 text-sm font-mono"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium w-8">
                <input
                  type="checkbox"
                  checked={normItems.length > 0 && selectedIds.size === normItems.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-2 py-2 text-left font-medium w-6"></th>
              <th className="px-3 py-2 text-left font-medium">Code</th>
              <th className="px-3 py-2 text-left font-medium">Display Name</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Aliases</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {normItems.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">
                {searchQuery ? "No matches found" : "No entries"}
              </td></tr>
            ) : normItems.map((item: any) => (
              <React.Fragment key={item.id}>
                {/* Main row */}
                <tr className={`cursor-pointer transition-colors ${expandedId === item.id ? "bg-accent/30" : "hover:bg-accent/20"}`}
                    onClick={() => toggleExpand(item.id)}>
                  <td className="px-3 py-1.5 w-8" onClick={(e: any) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      aria-label={`Select ${item.canonical_display || item.id}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 w-6">
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === item.id ? "rotate-90" : ""}`} />
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground max-w-[280px] truncate" title={item.canonical_code}>{item.canonical_code}</td>
                  <td className="px-3 py-1.5 font-medium max-w-[360px] truncate" title={item.canonical_display}>{item.canonical_display}</td>
                  <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                    {item.alias_count || 0} aliases
                    {item.unreviewed_count > 0 && (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">
                        {item.unreviewed_count} unreviewed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap w-px" onClick={(e: any) => e.stopPropagation()}>
                    <div className="flex gap-1.5">
                      <button onClick={() => handleViewDocuments(item.id, item.canonical_display || item.name || `#${item.id}`)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-accent flex items-center gap-1"
                        title="Show documents that reference this entry">
                        <FileText className="h-3 w-3" /> Documents
                      </button>
                      <button onClick={() => { setShowMergeFor(showMergeFor === item.id ? null : item.id); }}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-accent flex items-center gap-1"
                        title="Merge into another entry">
                        <GitMerge className="h-3 w-3" /> Merge
                      </button>
                      <button onClick={() => handleDelete(item.id, item.canonical_display || item.name || `#${item.id}`)}
                        className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10 flex items-center gap-1"
                        title="Delete this entry">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Merge row */}
                {showMergeFor === item.id && (
                  <tr className="bg-orange-50 dark:bg-orange-900/10">
                    <td colSpan={6} className="px-6 py-3" onClick={(e: any) => e.stopPropagation()}>
                      <div className="flex flex-col gap-2 text-sm">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-muted-foreground">Merge <strong>{item.canonical_display}</strong> into:</span>
                          <select
                            value={mergeTargetId ?? ""}
                            onChange={(e: any) => {
                              const v = e.target.value;
                              if (v === "") setMergeTargetId(null);
                              else setMergeTargetId(Number(v));
                            }}
                            className="rounded-md border bg-background px-2 py-1 text-sm max-w-xs"
                          >
                            <option value="">Select target...</option>
                            <option value={-1}>+ Create new entry...</option>
                            {normItems.filter((n: any) => n.id !== item.id).map((n: any) => (
                              <option key={n.id} value={n.id}>{n.canonical_display} ({n.canonical_code})</option>
                            ))}
                          </select>
                          <button
                            onClick={() => mergeTargetId && handleMerge(item.id, mergeTargetId)}
                            disabled={!mergeTargetId || (mergeTargetId === -1 && !rowNewDisplay.trim())}
                            className="rounded-md bg-orange-600 px-3 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                          >
                            Merge
                          </button>
                          <button
                            onClick={() => { setShowMergeFor(null); setMergeTargetId(null); setRowNewDisplay(""); setRowNewCode(""); }}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                          >
                            Cancel
                          </button>
                        </div>
                        {mergeTargetId === -1 && (
                          <div className="flex flex-wrap items-center gap-2 pl-1">
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              Name
                              <input
                                type="text"
                                value={rowNewDisplay}
                                onChange={(e: any) => setRowNewDisplay(e.target.value)}
                                placeholder="Display name for the new entry"
                                className="rounded-md border bg-background px-2 py-1 text-sm"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              Code <span className="text-[10px]">(optional)</span>
                              <input
                                type="text"
                                value={rowNewCode}
                                onChange={(e: any) => setRowNewCode(e.target.value)}
                                placeholder="auto"
                                className="rounded-md border bg-background px-2 py-1 text-sm font-mono"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Expanded detail */}
                {expandedId === item.id && detail && (
                  <tr className="bg-muted/20">
                    <td colSpan={6} className="px-6 py-4" onClick={(e: any) => e.stopPropagation()}>
                      <div className="space-y-4 max-w-2xl">
                        {/* Edit canonical entry */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium">Canonical Entry</h4>
                            {!editing && (
                              <button onClick={() => setEditing(true)}
                                className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                                <Edit3 className="h-3 w-3" /> Edit
                              </button>
                            )}
                          </div>
                          {editing ? (
                            <div className="grid gap-2">
                              <div className="grid grid-cols-2 gap-2">
                                <label className="space-y-1">
                                  <span className="text-xs text-muted-foreground">Code</span>
                                  <input type="text" value={editCode} onChange={(e: any) => setEditCode(e.target.value)}
                                    className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm font-mono" />
                                </label>
                                <label className="space-y-1">
                                  <span className="text-xs text-muted-foreground">Display Name</span>
                                  <input type="text" value={editDisplay} onChange={(e: any) => setEditDisplay(e.target.value)}
                                    className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm" />
                                </label>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={handleSaveEdit}
                                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground">
                                  <Save className="h-3 w-3" /> Save
                                </button>
                                <button onClick={() => { setEditing(false); setSaveError(null); setEditCode(detail.canonical_code || ""); setEditDisplay(detail.canonical_display || ""); }}
                                  className="rounded-md border px-3 py-1 text-xs hover:bg-accent">Cancel</button>
                              </div>
                              {saveError && (
                                <p className="text-xs text-destructive">Save failed: {saveError}</p>
                              )}
                            </div>
                          ) : (
                            <div className="flex gap-4 text-sm">
                              <span className="text-muted-foreground">Code: <span className="font-mono text-foreground">{detail.canonical_code}</span></span>
                              <span className="text-muted-foreground">Name: <span className="font-medium text-foreground">{detail.canonical_display}</span></span>
                            </div>
                          )}
                        </div>

                        {/* Aliases list */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-medium">
                              Aliases ({detail.aliases?.length || 0})
                              {item.unreviewed_count > 0 && (
                                <span className="ml-2 rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">
                                  {item.unreviewed_count} unreviewed
                                </span>
                              )}
                            </h4>
                            {item.unreviewed_count > 0 && (
                              <button
                                onClick={() => handleConfirmAll(item.id)}
                                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                                title="Accept every auto-mapped alias listed below as correct"
                              >
                                <Check className="h-3 w-3" /> Confirm all
                              </button>
                            )}
                          </div>
                          {detail.aliases?.length > 0 ? (
                            <div className="rounded-md border divide-y max-h-[300px] overflow-y-auto">
                              {detail.aliases.map((a: any) => (
                                <div key={a.id} className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-accent/20">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="truncate">{a.alias}</span>
                                    {a.language && (
                                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase flex-shrink-0">{a.language}</span>
                                    )}
                                    {a.auto_mapped === 1 && (
                                      <span className="rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-1.5 py-0.5 text-[10px] text-yellow-700 dark:text-yellow-400 flex-shrink-0">auto</span>
                                    )}
                                  </div>
                                  <button onClick={() => handleDeleteAlias(a.id)}
                                    className="rounded p-1 text-muted-foreground hover:text-destructive flex-shrink-0 ml-2">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">No aliases yet.</p>
                          )}

                          {/* Add alias */}
                          <div className="flex gap-2 items-end">
                            <label className="space-y-1 flex-1">
                              <span className="text-xs text-muted-foreground">New alias</span>
                              <input type="text" value={newAlias} onChange={(e: any) => setNewAlias(e.target.value)}
                                placeholder="e.g. Emocromo, CBC, ..."
                                onKeyDown={(e: any) => e.key === "Enter" && handleAddAlias()}
                                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm" />
                            </label>
                            <label className="space-y-1 w-20">
                              <span className="text-xs text-muted-foreground">Lang</span>
                              <input type="text" value={newAliasLang} onChange={(e: any) => setNewAliasLang(e.target.value)}
                                placeholder="en"
                                onKeyDown={(e: any) => e.key === "Enter" && handleAddAlias()}
                                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm" />
                            </label>
                            <button onClick={handleAddAlias} disabled={!newAlias.trim()}
                              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40">
                              <Plus className="h-3 w-3" /> Add
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
