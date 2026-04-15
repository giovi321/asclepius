import React, { useCallback, useEffect, useRef, useState } from "react";
import api from "@/api/client";
import {
  Plus, Trash2, Save, Check, Search, Edit3, GitMerge, X, ChevronRight,
} from "lucide-react";

export default function NormalizationTab() {
  const [normType, setNormType] = useState("lab_tests");
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
    await api.patch(`/normalization/${normType}/${expandedId}`, {
      canonical_code: editCode,
      canonical_display: editDisplay,
    });
    setEditing(false);
    // Reload detail and list
    const res = await api.get(`/normalization/${normType}/${expandedId}`);
    setDetail(res.data);
    loadList();
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
    if (!confirm("Delete this alias?")) return;
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
    if (!confirm(`Merge into target? All aliases and references from the source will be moved. The source entry will be deleted.`)) return;
    await api.post(`/normalization/${normType}/merge`, { source_id: sourceId, target_id: targetId });
    setExpandedId(null);
    setDetail(null);
    setShowMergeFor(null);
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
        <select value={normType} onChange={(e: any) => { setNormType(e.target.value); setExpandedId(null); setDetail(null); }}
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
        <span className="text-xs text-muted-foreground ml-auto">{normItems.length} entries</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium w-8"></th>
              <th className="px-4 py-2.5 text-left font-medium">Code</th>
              <th className="px-4 py-2.5 text-left font-medium">Display Name</th>
              <th className="px-4 py-2.5 text-left font-medium">Aliases</th>
              <th className="px-4 py-2.5 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {normItems.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">
                {searchQuery ? "No matches found" : "No entries"}
              </td></tr>
            ) : normItems.map((item: any) => (
              <React.Fragment key={item.id}>
                {/* Main row */}
                <tr className={`cursor-pointer transition-colors ${expandedId === item.id ? "bg-accent/30" : "hover:bg-accent/20"}`}
                    onClick={() => toggleExpand(item.id)}>
                  <td className="px-4 py-2.5">
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === item.id ? "rotate-90" : ""}`} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{item.canonical_code}</td>
                  <td className="px-4 py-2.5 font-medium">{item.canonical_display}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {item.alias_count || 0} aliases
                    {item.unreviewed_count > 0 && (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">
                        {item.unreviewed_count} unreviewed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5" onClick={(e: any) => e.stopPropagation()}>
                    <div className="flex gap-1.5">
                      {item.unreviewed_count > 0 && (
                        <button onClick={() => handleConfirmAll(item.id)}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-accent flex items-center gap-1">
                          <Check className="h-3 w-3" /> Confirm
                        </button>
                      )}
                      <button onClick={() => { setShowMergeFor(showMergeFor === item.id ? null : item.id); }}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-accent flex items-center gap-1"
                        title="Merge into another entry">
                        <GitMerge className="h-3 w-3" /> Merge
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Merge row */}
                {showMergeFor === item.id && (
                  <tr className="bg-orange-50 dark:bg-orange-900/10">
                    <td colSpan={5} className="px-6 py-3" onClick={(e: any) => e.stopPropagation()}>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">Merge <strong>{item.canonical_display}</strong> into:</span>
                        <select value={mergeTargetId ?? ""} onChange={(e: any) => setMergeTargetId(Number(e.target.value) || null)}
                          className="rounded-md border bg-background px-2 py-1 text-sm max-w-xs">
                          <option value="">Select target...</option>
                          {normItems.filter((n: any) => n.id !== item.id).map((n: any) => (
                            <option key={n.id} value={n.id}>{n.canonical_display} ({n.canonical_code})</option>
                          ))}
                        </select>
                        <button onClick={() => mergeTargetId && handleMerge(item.id, mergeTargetId)}
                          disabled={!mergeTargetId}
                          className="rounded-md bg-orange-600 px-3 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40">
                          Merge
                        </button>
                        <button onClick={() => { setShowMergeFor(null); setMergeTargetId(null); }}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Expanded detail */}
                {expandedId === item.id && detail && (
                  <tr className="bg-muted/20">
                    <td colSpan={5} className="px-6 py-4" onClick={(e: any) => e.stopPropagation()}>
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
                                <button onClick={() => { setEditing(false); setEditCode(detail.canonical_code || ""); setEditDisplay(detail.canonical_display || ""); }}
                                  className="rounded-md border px-3 py-1 text-xs hover:bg-accent">Cancel</button>
                              </div>
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
                          <h4 className="text-sm font-medium">Aliases ({detail.aliases?.length || 0})</h4>
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
