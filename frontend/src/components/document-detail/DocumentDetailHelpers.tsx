import React, { useEffect, useRef, useState } from "react";
import api from "@/api/client";
import { Eye, EyeOff, Pencil, Pill, Syringe, RefreshCw, X, ChevronRight, Plus, Search } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useDoctors, useFacilities, useSpecialties } from "@/hooks/data";

// ─── Section wrapper ───────────────────────────────────────────

export function Section({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 flex items-center gap-2 font-medium">
        {Icon && <Icon className="h-4 w-4" />}
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ─── InfoRow (read-only) ───────────────────────────────────────

export function InfoRow({ label, value }: { label: string; value: any }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// ─── EditableField ─────────────────────────────────────────────

export function EditableField({ label, value, field, docId, onSave, type = "text", multiline = false, apiPath, formatDisplay }: {
  label: string; value: any; field: string; docId: number; onSave: (updated?: any) => void;
  type?: string; multiline?: boolean;
  /** Override the PATCH endpoint. Defaults to ``/documents/{docId}`` so
   * regular document fields keep their behaviour. The imaging detail
   * page passes ``/imaging/{studyId}/metadata`` so modality, body_part,
   * etc. save against ``imaging_studies`` instead. */
  apiPath?: string;
  /** Optional read-only formatter for the displayed value. The raw
   * value is still used for editing and saving — the formatter only
   * affects how it appears in the row. Used to title-case DICOM-source
   * strings like body_part="ABDOMEN" without rewriting the DB. */
  formatDisplay?: (v: any) => string;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const path = apiPath || `/documents/${docId}`;
      const res = await api.patch(path, { [field]: val || null });
      setEditing(false);
      // Pass updated doc back so parent can update state without full reload
      onSave(res.data);
    } catch { toast({ title: "Failed to save", variant: "error" }); }
    setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) handleSave();
    if (e.key === "Escape") { setEditing(false); setVal(value || ""); }
  };

  if (editing) {
    return (
      <div className="flex items-start gap-2 text-sm py-0.5">
        <span className="text-muted-foreground w-28 flex-shrink-0 pt-1">{label}</span>
        <div className="flex-1 flex gap-1">
          {multiline ? (
            <textarea value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={handleKeyDown}
              className="flex-1 rounded border bg-background px-2 py-1 text-sm" rows={2} autoFocus disabled={saving} />
          ) : (
            <input type={type} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={handleKeyDown}
              className="flex-1 rounded border bg-background px-2 py-1 text-sm" autoFocus disabled={saving} />
          )}
          <button onClick={handleSave} disabled={saving}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">
            {saving ? "..." : "OK"}
          </button>
          <button onClick={() => { setEditing(false); setVal(value || ""); }}
            className="rounded border px-2 py-1 text-xs">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-between text-sm py-0.5 group cursor-pointer hover:bg-accent/30 rounded px-1 -mx-1"
      onClick={() => { setVal(value || ""); setEditing(true); }}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value
          ? (formatDisplay ? formatDisplay(value) : value)
          : <span className="text-muted-foreground/50 italic group-hover:text-primary text-xs">click to edit</span>}
      </span>
    </div>
  );
}

// ─── EditableSelect ───────────────────────────────────────────

export function EditableSelect({ label, value, field, docId, onSave, options, formatLabel, apiPath }: {
  label: string; value: any; field: string; docId: number; onSave: (updated?: any) => void;
  options: string[]; formatLabel?: (v: string) => string;
  /** Override the PATCH endpoint. See EditableField for details. */
  apiPath?: string;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const fmt = formatLabel || ((v: string) => v.replace(/_/g, " "));

  const handleSave = async (newVal: string) => {
    setSaving(true);
    try {
      const path = apiPath || `/documents/${docId}`;
      const res = await api.patch(path, { [field]: newVal || null });
      setEditing(false);
      setVal(newVal);
      onSave(res.data);
    } catch { toast({ title: "Failed to save", variant: "error" }); }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <span className="text-muted-foreground w-28 flex-shrink-0">{label}</span>
        <select value={val} onChange={(e) => handleSave(e.target.value)} disabled={saving}
          className="flex-1 rounded border bg-background px-2 py-1 text-sm" autoFocus>
          <option value="">— none —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{fmt(opt)}</option>
          ))}
        </select>
        <button onClick={() => setEditing(false)}
          className="rounded border px-2 py-1 text-xs">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-between text-sm py-0.5 group cursor-pointer hover:bg-accent/30 rounded px-1 -mx-1"
      onClick={() => { setVal(value || ""); setEditing(true); }}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value ? fmt(value) : <span className="text-muted-foreground/50 italic group-hover:text-primary text-xs">click to edit</span>}
      </span>
    </div>
  );
}

// ─── EditableCombobox ─────────────────────────────────────────
// Searchable dropdown backed by a normalization endpoint (doctors, facilities,
// specialties). Shows existing entries filtered by the typed query, plus a
// "+ Create new" row when the query has no exact match. Selecting an existing
// entry sends the chosen display name to the backend; the PATCH handler on
// documents will resolve it to an id via the alias-aware _upsert_* helpers.

export function EditableCombobox({
  label, value, field, docId, onSave, normType, currentEntityId,
}: {
  label: string;
  value: any;
  field: string;
  docId: number;
  onSave: (updated?: any) => void;
  normType: "doctors" | "facilities" | "specialties";
  /** Required for the scope confirm to fire. When the field already
   * carries an entity id and the user picks/types a new value, the
   * combobox always asks whether the change should apply to this
   * document only or to every document linked to the current entity.
   * Without it, only the doc-only path is offered. */
  currentEntityId?: number | null;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  // Pending change pending the scope choice. `entityId` is the resolved
  // existing entry's id when the user picked from the dropdown; null
  // when they typed a new value (which would be auto-created on commit).
  const [pendingChange, setPendingChange] = useState<{
    display: string;
    entityId: number | null;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const doctors = useDoctors();
  const facilities = useFacilities();
  const specialties = useSpecialties();
  const source = normType === "doctors" ? doctors
    : normType === "facilities" ? facilities
    : specialties;
  const options = Array.isArray(source.data) ? source.data : [];
  const loadingOptions = source.loading;

  // Close on outside click
  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setEditing(false);
        setQuery("");
        setPendingChange(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  const displayOf = (opt: any) =>
    opt.canonical_display || opt.name || opt.display || "";

  /** Apply the change to THIS document only — repoint its FK, leave the
   * canonical row untouched. The backend's _upsert_* helpers resolve the
   * display name to an existing entry by alias/slug, or auto-create one
   * if there's no match. */
  const commitDocOnly = async (chosen: string | null) => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, { [field]: chosen });
      onSave(res.data);
      setEditing(false);
      setQuery("");
      setPendingChange(null);
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Failed to save";
      toast({ title: typeof d === "string" ? d : "Failed to save", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  /** Apply the change to EVERY document currently linked to the
   * ``currentEntityId``. The strategy depends on whether the user picked
   * an existing entry or typed a new one:
   *
   * - Picked existing entry (``targetEntityId`` known) → merge the
   *   current entity into the picked one. Every document that pointed
   *   at the old entity now points at the picked entity, and the old
   *   entity row is deleted (its name copied as an alias on the target).
   * - Typed a new name → rename the current entity's
   *   ``canonical_display``. The FK stays put; every linked document
   *   simply renders the new name through the join.
   */
  const applyToAllDocuments = async (
    newDisplay: string,
    targetEntityId: number | null,
  ) => {
    if (!currentEntityId) {
      // No existing entity to mutate — fall back to doc-only.
      await commitDocOnly(newDisplay);
      return;
    }
    setSaving(true);
    try {
      if (targetEntityId && targetEntityId !== currentEntityId) {
        // Merge: every doc pointing at currentEntityId becomes a doc
        // pointing at targetEntityId. The merge endpoint also copies
        // the source's display name as an alias on the target so the
        // few-shot retriever picks it up next time.
        await api.post(`/normalization/${normType}/merge`, {
          source_id: currentEntityId,
          target_id: targetEntityId,
        });
      } else {
        // Rename: change the canonical row's display name in place.
        await api.patch(`/normalization/${normType}/${currentEntityId}`, {
          canonical_display: newDisplay,
        });
      }
      onSave();
      setEditing(false);
      setQuery("");
      setPendingChange(null);
    } catch (err: any) {
      const d = err?.response?.data?.detail || err?.message || "Failed to apply";
      toast({ title: typeof d === "string" ? d : "Failed to apply", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  /** Decide whether to commit straight through (no scope ambiguity) or
   * raise the two-button picker. The picker fires when:
   *   - the field already has a current entity (something to mutate), AND
   *   - the new value differs from the current display, AND
   *   - the new value is non-empty (clear has its own button).
   * Without a current entity we can't "apply to all" — there's nothing
   * to rename or merge from — so we go straight to doc-only. */
  const handleCommit = (newDisplay: string, targetEntityId: number | null) => {
    const trimmed = (newDisplay || "").trim();
    if (!trimmed) {
      // Clearing — handled separately by the Clear button.
      commitDocOnly(null);
      return;
    }
    if (trimmed.toLowerCase() === String(value || "").toLowerCase()
        && targetEntityId === currentEntityId) {
      // No-op — same name and same entity.
      setEditing(false);
      setQuery("");
      return;
    }
    if (!currentEntityId) {
      // Nothing to "apply to all" against — go straight to doc-only.
      commitDocOnly(trimmed);
      return;
    }
    setPendingChange({ display: trimmed, entityId: targetEntityId });
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o: any) => {
        const d = (displayOf(o) || "").toLowerCase();
        const c = (o.canonical_code || "").toLowerCase();
        return d.includes(q) || c.includes(q);
      })
    : options;
  const exactMatch = filtered.some((o: any) => displayOf(o).toLowerCase() === q);
  const canCreate = q.length > 0 && !exactMatch;

  if (editing) {
    return (
      <div className="flex items-start gap-2 text-sm py-0.5">
        <span className="text-muted-foreground w-28 flex-shrink-0 pt-1">{label}</span>
        <div ref={rootRef} className="relative flex-1">
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setEditing(false); setQuery(""); setPendingChange(null); }
                  if (e.key === "Enter") {
                    if (filtered.length === 1) {
                      handleCommit(displayOf(filtered[0]), filtered[0].id);
                    } else if (canCreate) {
                      handleCommit(query, null);
                    }
                  }
                }}
                placeholder={`Search ${normType}...`}
                className="w-full rounded border bg-background pl-7 pr-2 py-1 text-sm"
                autoFocus
                disabled={saving}
              />
            </div>
            <button onClick={() => commitDocOnly(null)} disabled={saving}
              className="rounded border px-2 py-1 text-xs hover:bg-accent"
              title="Clear this field">
              Clear
            </button>
            <button onClick={() => { setEditing(false); setQuery(""); setPendingChange(null); }}
              className="rounded border px-2 py-1 text-xs">
              <X className="h-3 w-3" />
            </button>
          </div>
          {/* Dropdown panel */}
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-background shadow-lg">
            {loadingOptions ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
            ) : (
              <>
                {filtered.length === 0 && !canCreate && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No {normType} yet. Type a name to create one.
                  </div>
                )}
                {!pendingChange && filtered.slice(0, 50).map((opt: any) => {
                  const d = displayOf(opt);
                  const isCurrent = value && d.toLowerCase() === String(value).toLowerCase();
                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleCommit(d, opt.id)}
                      disabled={saving}
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
                {canCreate && !pendingChange && (
                  <button
                    onClick={() => handleCommit(query, null)}
                    disabled={saving}
                    className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-primary hover:bg-primary/10"
                  >
                    <Plus className="h-3 w-3" />
                    {currentEntityId
                      ? <>Use <span className="font-medium">"{query.trim()}"</span></>
                      : <>Create new: <span className="font-medium">"{query.trim()}"</span></>}
                  </button>
                )}
                {pendingChange && (
                  // Two-button scope confirm. Fires for every change to a
                  // populated field — picking a sibling entry, typing a
                  // new name, anything that's not a no-op or a clear.
                  // The "all documents" path adapts: merge when the user
                  // picked an existing entry, rename when they typed a
                  // brand-new name. Both cascade through joins so every
                  // doc linked to the old entity follows automatically.
                  <div className="border-t bg-muted/30 p-2 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      Apply <span className="font-medium">"{pendingChange.display}"</span> to:
                    </p>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => commitDocOnly(pendingChange.display)}
                        disabled={saving}
                        className="rounded border bg-background px-2 py-1 text-left text-xs hover:bg-accent disabled:opacity-50"
                      >
                        <span className="font-medium">This document only</span>
                        <span className="block text-[10px] text-muted-foreground">
                          Repoint just this document. Other documents linked to the current {normType.slice(0, -1)} keep their existing value.
                        </span>
                      </button>
                      <button
                        onClick={() => applyToAllDocuments(pendingChange.display, pendingChange.entityId)}
                        disabled={saving}
                        className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-left text-xs hover:bg-primary/10 disabled:opacity-50"
                      >
                        <span className="font-medium">All documents</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {pendingChange.entityId && pendingChange.entityId !== currentEntityId
                            ? <>Merge the current {normType.slice(0, -1)} into the picked one. Every linked document follows.</>
                            : <>Rename the current {normType.slice(0, -1)} record. Every linked document follows.</>}
                        </span>
                      </button>
                      <button
                        onClick={() => setPendingChange(null)}
                        disabled={saving}
                        className="rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-between text-sm py-0.5 group cursor-pointer hover:bg-accent/30 rounded px-1 -mx-1"
      onClick={() => { setQuery(""); setEditing(true); }}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value || <span className="text-muted-foreground/50 italic group-hover:text-primary text-xs">click to edit</span>}
      </span>
    </div>
  );
}

// ─── EditableSummary ───────────────────────────────────────────

export function EditableSummary({ value, docId, onSave }: { value: string | null; docId: number; onSave: (updated?: any) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setVal(value || ""); }, [value]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, { summary_en: val || null });
      setEditing(false);
      onSave(res.data);
    } catch { toast({ title: "Failed to save", variant: "error" }); }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
        <h3 className="mb-2 text-sm font-medium text-primary">Summary</h3>
        <textarea value={val} onChange={(e) => setVal(e.target.value)}
          className="w-full rounded border bg-background px-3 py-2 text-sm" rows={3} autoFocus disabled={saving} />
        <div className="flex gap-2 mt-2">
          <button onClick={handleSave} disabled={saving}
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={() => { setEditing(false); setVal(value || ""); }}
            className="rounded border px-3 py-1.5 text-xs hover:bg-accent">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 cursor-pointer hover:bg-primary/10 transition-colors group"
      onClick={() => setEditing(true)}>
      <h3 className="mb-1 text-sm font-medium text-primary flex items-center justify-between">
        Summary
        <span className="text-[10px] text-primary/50 opacity-0 group-hover:opacity-100">click to edit</span>
      </h3>
      <p className="text-sm">{value || <span className="text-muted-foreground italic">No summary — click to add</span>}</p>
    </div>
  );
}

// ─── EditableFilename ──────────────────────────────────────────

export function EditableFilename({ value, docId, onSave }: { value: string; docId: number; onSave: (updated?: any) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { setVal(value || ""); }, [value]);

  const handleSave = async () => {
    if (!val.trim() || val === value) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await api.post(`/documents/${docId}/rename`, { filename: val });
      setEditing(false);
      onSave(res.data);
    } catch (e: any) {
      toast({ title: "Rename failed", description: e.response?.data?.detail || e.message, variant: "error" });
    }
    setSaving(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/documents/${docId}/generate-filename`);
      const suggested = res.data.suggested_filename;
      if (suggested) {
        setVal(suggested);
        setEditing(true);
      }
    } catch (e: any) {
      toast({ title: "Failed to generate filename", description: e.response?.data?.detail || e.message, variant: "error" });
    }
    setGenerating(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditing(false); setVal(value); } }}
          className="text-xl font-semibold bg-background border rounded px-2 py-1 flex-1"
          autoFocus disabled={saving} />
        <button onClick={handleSave} disabled={saving}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
          {saving ? "..." : "Save"}
        </button>
        <button onClick={() => { setEditing(false); setVal(value); }}
          className="rounded border px-2 py-1.5 text-xs hover:bg-accent">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <h1 className="text-xl font-semibold group cursor-pointer flex items-center gap-2">
      <span onClick={() => setEditing(true)}>{value}</span>
      <span className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
        <button onClick={() => setEditing(true)}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Edit filename">
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={handleGenerate} disabled={generating}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-50"
          title="Generate filename from document data">
          <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
        </button>
      </span>
    </h1>
  );
}

// ─── TechnicalDetails (collapsible) ───────────────────────────

export function TechnicalDetails({ ocrEngine, ocrConfidence, llmProvider }: {
  ocrEngine: string | null; ocrConfidence: number | null; llmProvider: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        Processing details
      </button>
      {open && (
        <div className="mt-1.5 ml-4 space-y-1 text-xs text-muted-foreground">
          {ocrEngine && (
            <div className="flex justify-between">
              <span>OCR Engine</span>
              <span className="font-medium text-foreground/70">{ocrEngine}</span>
            </div>
          )}
          {ocrConfidence != null && (
            <div className="flex justify-between">
              <span>OCR Confidence</span>
              <span className="font-medium text-foreground/70">{ocrConfidence.toFixed(2)}</span>
            </div>
          )}
          {llmProvider && (
            <div className="flex justify-between">
              <span>LLM Provider</span>
              <span className="font-medium text-foreground/70">{llmProvider}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── OcrSection (collapsible) ──────────────────────────────────

export function OcrSection({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 hover:bg-accent/50"
      >
        <h3 className="flex items-center gap-2 font-medium">
          {open ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          OCR Text
        </h3>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Show"} ({text.length} chars)
        </span>
      </button>
      {open && (
        <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap border-t bg-muted/30 p-4 text-xs">
          {text}
        </pre>
      )}
    </div>
  );
}

// ─── getSectionTypeStyle ───────────────────────────────────────

export function getSectionTypeStyle(type: string): string {
  const styles: Record<string, string> = {
    lab_results_page: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    clinical_notes: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    nursing_notes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
    vital_signs: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    consent_form: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    cover_page: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
    medication_chart: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    operative_notes: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    discharge_summary: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    imaging_report: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
    correspondence: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
    invoice_page: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  };
  return styles[type] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

// ─── MedFormBadge ──────────────────────────────────────────────

export function MedFormBadge({ form }: { form?: string }) {
  if (!form) return <span className="text-muted-foreground">{"\u2014"}</span>;
  const lower = form.toLowerCase();
  let color = "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  let Icon: any = Pill;

  if (lower.includes("tablet") || lower.includes("pill") || lower.includes("capsule")) {
    color = "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    Icon = Pill;
  } else if (lower.includes("inject") || lower.includes("iv") || lower.includes("syringe")) {
    color = "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    Icon = Syringe;
  } else if (lower.includes("cream") || lower.includes("ointment") || lower.includes("topical")) {
    color = "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
  } else if (lower.includes("liquid") || lower.includes("syrup") || lower.includes("solution")) {
    color = "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
  } else if (lower.includes("inhaler") || lower.includes("spray") || lower.includes("nasal")) {
    color = "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300";
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {form}
    </span>
  );
}
