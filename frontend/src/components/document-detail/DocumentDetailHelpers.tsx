import React, { useEffect, useState } from "react";
import api from "@/api/client";
import { Eye, EyeOff, Pill, Syringe, RefreshCw, X, ChevronRight } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

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

export function EditableField({ label, value, field, docId, onSave, type = "text", multiline = false }: {
  label: string; value: any; field: string; docId: number; onSave: (updated?: any) => void;
  type?: string; multiline?: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, { [field]: val || null });
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
          className="text-muted-foreground text-xs font-normal hover:text-foreground" title="Edit filename">
          &#x270E;
        </button>
        <button onClick={handleGenerate} disabled={generating}
          className="text-muted-foreground text-xs font-normal hover:text-primary disabled:opacity-50"
          title="Generate filename from document data">
          {generating ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
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
