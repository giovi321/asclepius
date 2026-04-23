import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "@/api/client";
import { useConfirm } from "@/contexts/ConfirmContext";
import { buildBulkConfirm, shouldConfirmBulk } from "@/lib/confirmBulk";
import { useToast } from "@/contexts/ToastContext";
import {
  DEFAULT_NORM, isNormType, type NormItem, type NormType,
} from "./normalization/types";
import NormalizationToolbar from "./normalization/NormalizationToolbar";
import AutoMergePanel, { type AutoMergeProposal } from "./normalization/AutoMergePanel";
import LinkedDocumentsModal from "./normalization/LinkedDocumentsModal";
import BatchMergeBar from "./normalization/BatchMergeBar";
import NormalizationRow from "./normalization/NormalizationRow";

export default function NormalizationTab() {
  const confirm = useConfirm();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  // Pathname shape: /settings/analysis/normalization/<normType>
  const segments = location.pathname.split("/").filter(Boolean);
  const normType: NormType = isNormType(segments[3]) ? (segments[3] as NormType) : DEFAULT_NORM;
  const setNormType = (v: string) => {
    navigate(`/settings/analysis/normalization/${v}`, { replace: false });
  };

  const [normItems, setNormItems] = useState<NormItem[]>([]);
  const [normFilter, setNormFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [editCode, setEditCode] = useState("");
  const [editDisplay, setEditDisplay] = useState("");
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [newAlias, setNewAlias] = useState("");
  const [newAliasLang, setNewAliasLang] = useState("");

  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [showMergeFor, setShowMergeFor] = useState<number | null>(null);
  const [rowNewDisplay, setRowNewDisplay] = useState("");
  const [rowNewCode, setRowNewCode] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchTargetId, setBatchTargetId] = useState<number | null>(null);
  const [batchNewDisplay, setBatchNewDisplay] = useState("");
  const [batchNewCode, setBatchNewCode] = useState("");

  const [linkedDocs, setLinkedDocs] = useState<any[] | null>(null);
  const [linkedDocsFor, setLinkedDocsFor] = useState<{ id: number; name: string } | null>(null);
  const [linkedLoading, setLinkedLoading] = useState(false);

  const [autoMergeLoading, setAutoMergeLoading] = useState(false);
  const [autoMergeProposals, setAutoMergeProposals] = useState<AutoMergeProposal[] | null>(null);
  const [autoMergeEntries, setAutoMergeEntries] = useState<any[]>([]);

  const loadList = useCallback(() => {
    const params: Record<string, any> = {};
    if (normFilter) params.filter = normFilter;
    if (searchQuery) params.search = searchQuery;
    api.get(`/normalization/${normType}`, { params }).then((res: any) => {
      setNormItems(Array.isArray(res.data) ? res.data : []);
    });
  }, [normType, normFilter, searchQuery]);

  useEffect(() => { loadList(); }, [loadList]);

  // Clear selection and any open detail when switching entity type or filters.
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
      setSelectedIds(new Set(normItems.map((i) => i.id)));
    }
  };

  const handleBatchMerge = async () => {
    if (selectedIds.size === 0) return;
    let payload: any;
    let sources: number[];
    let label: string;
    if (batchTargetId === -1) {
      if (!batchNewDisplay.trim()) {
        toast({ title: "Display name is required for a new target.", variant: "warning" });
        return;
      }
      sources = Array.from(selectedIds);
      label = `new "${batchNewDisplay.trim()}"`;
      payload = {
        source_ids: sources,
        new_target: { canonical_code: batchNewCode.trim(), canonical_display: batchNewDisplay.trim() },
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
      const res = await api.get(`/normalization/${normType}/${expandedId}`);
      setDetail(res.data);
      loadList();
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Save failed";
      setSaveError(typeof d === "string" ? d : JSON.stringify(d));
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
      const d = err?.response?.data?.detail || err?.message || "Auto-merge request failed";
      toast({ title: "Auto-merge failed", description: typeof d === "string" ? d : JSON.stringify(d), variant: "error" });
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

  const applyProposal = async (proposal: AutoMergeProposal) => {
    const sources = proposal.source_ids.filter((id) => id !== proposal.target_id);
    if (sources.length === 0) return;
    if (shouldConfirmBulk(sources.length)) {
      const targetEntry = autoMergeEntries.find((e: any) => e.id === proposal.target_id);
      const targetLabel = targetEntry?.canonical_display || `#${proposal.target_id}`;
      const ok = await confirm(buildBulkConfirm({
        count: sources.length,
        verb: "Merge",
        noun: "entry",
        targetLabel,
        description: "Aliases and references will be moved into the target and the source rows will be deleted.",
        confirmText: "Merge",
        variant: "destructive",
      }));
      if (!ok) return;
    }
    await api.post(`/normalization/${normType}/merge-batch`, {
      source_ids: sources,
      target_id: proposal.target_id,
    });
    setAutoMergeProposals((prev) => prev?.filter((p) => p !== proposal) ?? null);
    loadList();
  };

  const updateProposalTarget = (idx: number, newTargetId: number) => {
    setAutoMergeProposals((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const cur = next[idx];
      next[idx] = {
        ...cur,
        target_id: newTargetId,
        source_ids: cur.source_ids
          .filter((s) => s !== newTargetId)
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
          ? cur.source_ids.filter((s) => s !== sourceId)
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
    const ok = await confirm({ title: "Delete this alias?", variant: "destructive" });
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
        new_target: { canonical_code: rowNewCode.trim(), canonical_display: rowNewDisplay.trim() },
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
      <div className="text-sm text-muted-foreground">
        Normalization maps different names for the same medical concept (e.g. "CBC", "Complete Blood Count", "Emocromo")
        to a single canonical entry. Click a row to view and manage its aliases, edit the canonical name, or merge duplicates.
      </div>

      <NormalizationToolbar
        normType={normType}
        onNormTypeChange={setNormType}
        normFilter={normFilter}
        onNormFilterChange={setNormFilter}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        onSearchCommit={setSearchQuery}
        onAutoMerge={handleAutoMerge}
        autoMergeLoading={autoMergeLoading}
        canAutoMerge={normItems.length >= 2}
        itemCount={normItems.length}
      />

      {autoMergeProposals !== null && (
        <AutoMergePanel
          proposals={autoMergeProposals}
          entries={autoMergeEntries}
          onClose={() => setAutoMergeProposals(null)}
          onApply={applyProposal}
          onSkip={(idx) => setAutoMergeProposals((prev) => prev?.filter((_, i) => i !== idx) ?? null)}
          onUpdateTarget={updateProposalTarget}
          onToggleSource={toggleProposalSource}
        />
      )}

      {linkedDocsFor && (
        <LinkedDocumentsModal
          subjectName={linkedDocsFor.name}
          loading={linkedLoading}
          documents={linkedDocs}
          onClose={closeLinkedDocs}
          onDelete={() => linkedDocsFor && handleDelete(linkedDocsFor.id, linkedDocsFor.name)}
        />
      )}

      <BatchMergeBar
        selectedCount={selectedIds.size}
        normItems={normItems}
        selectedIds={selectedIds}
        batchTargetId={batchTargetId}
        onBatchTargetChange={setBatchTargetId}
        batchNewDisplay={batchNewDisplay}
        onBatchNewDisplayChange={setBatchNewDisplay}
        batchNewCode={batchNewCode}
        onBatchNewCodeChange={setBatchNewCode}
        onMerge={handleBatchMerge}
        onClear={() => {
          setSelectedIds(new Set());
          setBatchTargetId(null);
          setBatchNewDisplay("");
          setBatchNewCode("");
        }}
      />

      <div className="rounded-lg border overflow-x-auto">
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
            ) : normItems.map((item) => (
              <NormalizationRow
                key={item.id}
                item={item}
                normItems={normItems}
                detail={detail}
                expanded={expandedId === item.id}
                editing={editing}
                editCode={editCode}
                editDisplay={editDisplay}
                saveError={saveError}
                newAlias={newAlias}
                newAliasLang={newAliasLang}
                showMerge={showMergeFor === item.id}
                mergeTargetId={mergeTargetId}
                rowNewDisplay={rowNewDisplay}
                rowNewCode={rowNewCode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => toggleSelect(item.id)}
                onToggleExpand={() => toggleExpand(item.id)}
                onViewDocuments={() => handleViewDocuments(item.id, item.canonical_display || item.name || `#${item.id}`)}
                onToggleMerge={() => setShowMergeFor(showMergeFor === item.id ? null : item.id)}
                onCancelMerge={() => { setShowMergeFor(null); setMergeTargetId(null); setRowNewDisplay(""); setRowNewCode(""); }}
                onDelete={() => handleDelete(item.id, item.canonical_display || item.name || `#${item.id}`)}
                onStartEdit={() => setEditing(true)}
                onCancelEdit={() => { setEditing(false); setSaveError(null); setEditCode(detail?.canonical_code || ""); setEditDisplay(detail?.canonical_display || ""); }}
                onEditCodeChange={setEditCode}
                onEditDisplayChange={setEditDisplay}
                onSaveEdit={handleSaveEdit}
                onNewAliasChange={setNewAlias}
                onNewAliasLangChange={setNewAliasLang}
                onAddAlias={handleAddAlias}
                onDeleteAlias={handleDeleteAlias}
                onConfirmAll={() => handleConfirmAll(item.id)}
                onMergeTargetChange={setMergeTargetId}
                onRowNewDisplayChange={setRowNewDisplay}
                onRowNewCodeChange={setRowNewCode}
                onMerge={() => mergeTargetId && handleMerge(item.id, mergeTargetId)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
