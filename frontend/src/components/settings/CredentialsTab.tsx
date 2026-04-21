import { useEffect, useState } from "react";
import api from "@/api/client";
import {
  KeyRound, Plus, Trash2, Save, Check, Pencil, X,
  Cloud, Zap, Search as SearchIcon,
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import type { Credential } from "@/types";

const CREDENTIAL_TYPES = [
  { value: "ollama", label: "Ollama", description: "Local LLM via Ollama", icon: Zap, needs_url: true, needs_key: false },
  { value: "vllm", label: "vLLM", description: "vLLM (OpenAI-compatible)", icon: Zap, needs_url: true, needs_key: true },
  { value: "claude", label: "Anthropic (Claude)", description: "Claude API", icon: Cloud, needs_url: false, needs_key: true },
  { value: "openai", label: "OpenAI", description: "OpenAI-compatible API", icon: Cloud, needs_url: false, needs_key: true },
  { value: "google_vision", label: "Google Vision", description: "Google Cloud Vision OCR", icon: SearchIcon, needs_url: false, needs_key: true },
  { value: "tesseract_remote", label: "Tesseract (Remote)", description: "Remote Tesseract OCR server", icon: SearchIcon, needs_url: true, needs_key: false },
];

function iconForType(t: string) {
  const found = CREDENTIAL_TYPES.find((x) => x.value === t);
  return found ? found.icon : KeyRound;
}

interface EditDialogProps {
  initial: Partial<Credential>;
  onSave: (c: Credential) => Promise<void> | void;
  onClose: () => void;
}

function EditDialog({ initial, onSave, onClose }: EditDialogProps) {
  const [name, setName] = useState(initial.name || "");
  const [type, setType] = useState(initial.type || "ollama");
  const [baseUrl, setBaseUrl] = useState(initial.base_url || "");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const typeInfo = CREDENTIAL_TYPES.find((t) => t.value === type);
  const hasSavedKey = !!initial.has_api_key;

  const handleSave = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Name is required"); return; }
    if (typeInfo?.needs_url && !baseUrl.trim()) { setErr("Base URL is required for this type"); return; }
    setSaving(true);
    try {
      await onSave({
        id: initial.id || "",
        name: name.trim(),
        type,
        base_url: baseUrl.trim(),
        // Empty api_key means "keep existing" to the backend.
        api_key: apiKey,
      });
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {initial.id ? "Edit credential" : "New credential"}
          </h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <label className="space-y-1 block">
          <span className="text-sm font-medium">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home Ollama"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-1 block">
          <span className="text-sm font-medium">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {CREDENTIAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {typeInfo && (
            <span className="block text-xs text-muted-foreground">{typeInfo.description}</span>
          )}
        </label>

        {typeInfo?.needs_url && (
          <label className="space-y-1 block">
            <span className="text-sm font-medium">Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                type === "ollama" ? "http://ollama:11434"
                : type === "vllm" ? "http://vllm:8000/v1"
                : type === "tesseract_remote" ? "http://tesseract:8080"
                : "https://…"
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {(typeInfo?.needs_key || type === "openai") && (
          <label className="space-y-1 block">
            <span className="text-sm font-medium">API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasSavedKey ? "configured (leave blank to keep)" : "Enter API key"}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {err && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-3 py-2 text-sm">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CredentialsTab() {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [editing, setEditing] = useState<Partial<Credential> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const reload = async () => {
    try {
      const res = await api.get("/settings/credentials");
      setCredentials(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast({ title: "Failed to load credentials", variant: "error" });
    }
  };

  useEffect(() => { reload(); }, []);

  const persist = async (next: Credential[]) => {
    setSaving(true);
    try {
      await api.put("/settings/credentials", next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await reload();
    } catch (e: any) {
      toast({
        title: "Failed to save credentials",
        description: e?.response?.data?.detail || e?.message || "",
        variant: "error",
      });
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOne = async (c: Credential) => {
    const exists = credentials.some((x) => x.id === c.id);
    const next = exists
      ? credentials.map((x) => (x.id === c.id ? { ...x, ...c } : x))
      : [...credentials, c];
    await persist(next);
  };

  const handleDelete = async (id: string) => {
    const cred = credentials.find((c) => c.id === id);
    if (!cred) return;
    if ((cred.references?.total || 0) > 0) {
      toast({ title: `"${cred.name}" is in use; remove references first`, variant: "error" });
      return;
    }
    const next = credentials.filter((c) => c.id !== id);
    await persist(next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        Shared connections used by LLM, Vision-LLM, and OCR entries. Edit a
        credential here once and every entry that references it picks up the
        change. New entries then pick a credential instead of re-entering keys
        and URLs.
      </div>

      {credentials.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <KeyRound className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">No credentials configured</p>
          <p className="text-sm mt-1">Add a credential to get started.</p>
        </div>
      )}

      <div className="space-y-2">
        {credentials.map((c) => {
          const Icon = iconForType(c.type);
          const refs = c.references || { llm: 0, vision: 0, ocr: 0, general: 0, total: 0 };
          const inUse = refs.total > 0;
          return (
            <div key={c.id} className="rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {c.type}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground truncate">
                    {c.base_url || <span className="italic opacity-60">no base URL</span>}
                    {" · "}
                    {c.has_api_key ? "API key: ••••••••" : "API key: —"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Used by: {refs.llm} LLM · {refs.vision} Vision · {refs.ocr} OCR
                    {refs.general > 0 && " · General"}
                  </div>
                </div>
                <button
                  onClick={() => setEditing(c)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  disabled={inUse}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
                  title={inUse ? `Cannot delete — ${refs.total} reference${refs.total === 1 ? "" : "s"}` : "Delete"}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => setEditing({})}
          className="flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Credential
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {saving && !saved && (
          <span className="text-xs text-muted-foreground">Saving…</span>
        )}
      </div>

      {editing && (
        <EditDialog
          initial={editing}
          onSave={handleSaveOne}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
