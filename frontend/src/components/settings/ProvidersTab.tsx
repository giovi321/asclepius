import { useEffect, useMemo, useState } from "react";
import api from "@/api/client";
import {
  KeyRound, Plus, Trash2, Save, Check, Pencil, X,
  Cloud, Zap, Search as SearchIcon, Brain, Eye, ScanText,
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import type { Credential, LlmProvider, OcrProvider, VisionLlmProvider } from "@/types";

// ─── Credential type metadata ─────────────────────────────────────

const CREDENTIAL_TYPES = [
  { value: "ollama", label: "Ollama", description: "Local LLM via Ollama", icon: Zap, needs_url: true, needs_key: false },
  { value: "vllm", label: "vLLM", description: "vLLM (OpenAI-compatible)", icon: Zap, needs_url: true, needs_key: true },
  { value: "claude", label: "Anthropic (Claude)", description: "Claude API", icon: Cloud, needs_url: false, needs_key: true },
  { value: "openai", label: "OpenAI", description: "OpenAI-compatible API", icon: Cloud, needs_url: false, needs_key: true },
  { value: "google_vision", label: "Google Vision", description: "Google Cloud Vision OCR", icon: SearchIcon, needs_url: false, needs_key: true },
  { value: "tesseract_remote", label: "Tesseract (Remote)", description: "Remote Tesseract OCR server", icon: SearchIcon, needs_url: true, needs_key: false },
];

function iconForType(t: string) {
  return (CREDENTIAL_TYPES.find((x) => x.value === t)?.icon) ?? KeyRound;
}

// Which model kinds (LLM / Vision / OCR) can be attached to a credential of
// a given type.
function allowedKindsFor(credType: string): Array<"llm" | "vision" | "ocr"> {
  if (credType === "google_vision" || credType === "tesseract_remote") return ["ocr"];
  // Everything else (ollama/vllm/claude/openai) can serve LLM, Vision, or
  // LLM-vision-OCR.
  return ["llm", "vision", "ocr"];
}

// ─── Types for attached-model rows ────────────────────────────────

type ModelKind = "llm" | "vision" | "ocr";
interface AttachedModel {
  kind: ModelKind;
  // The underlying entry id (LLM/Vision/OCR provider id) so we can edit/remove.
  entry_id: string;
  name: string;   // display name for the entry
  model: string;  // actual model string
  enabled: boolean;
  priority: number;
  timeout: number;
}

// ─── Credential dialog ────────────────────────────────────────────

interface CredDialogProps {
  initial: Partial<Credential>;
  onSave: (c: Credential) => Promise<void> | void;
  onClose: () => void;
}

function CredentialDialog({ initial, onSave, onClose }: CredDialogProps) {
  const [name, setName] = useState(initial.name || "");
  const [type, setType] = useState(initial.type || "ollama");
  const [baseUrl, setBaseUrl] = useState(initial.base_url || "");
  const [apiKey, setApiKey] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState(
    typeof initial.max_concurrent === "number" ? initial.max_concurrent : 2,
  );
  const [maxRetries, setMaxRetries] = useState(
    typeof initial.max_retries === "number" ? initial.max_retries : 3,
  );
  const [retryBackoff, setRetryBackoff] = useState(
    (initial.retry_backoff_seconds && initial.retry_backoff_seconds.length
      ? initial.retry_backoff_seconds
      : [30, 60, 120]).join(","),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const typeInfo = CREDENTIAL_TYPES.find((t) => t.value === type);
  const hasSavedKey = !!initial.has_api_key;

  const parseBackoff = (s: string): number[] =>
    s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);

  const handleSave = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Name is required"); return; }
    if (typeInfo?.needs_url && !baseUrl.trim()) { setErr("Base URL is required for this type"); return; }
    const backoff = parseBackoff(retryBackoff);
    if (backoff.length === 0) { setErr("Retry backoff must be a comma-separated list of non-negative integers"); return; }
    setSaving(true);
    try {
      await onSave({
        id: initial.id || "",
        name: name.trim(),
        type,
        base_url: baseUrl.trim(),
        api_key: apiKey, // empty = preserve existing
        max_concurrent: Math.max(1, maxConcurrent),
        max_retries: Math.max(0, maxRetries),
        retry_backoff_seconds: backoff,
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
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {initial.id ? "Edit provider" : "New provider"}
          </h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <label className="space-y-1 block">
          <span className="text-sm font-medium">Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home Ollama"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        </label>

        <label className="space-y-1 block">
          <span className="text-sm font-medium">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm">
            {CREDENTIAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {typeInfo && <span className="block text-xs text-muted-foreground">{typeInfo.description}</span>}
        </label>

        {typeInfo?.needs_url && (
          <label className="space-y-1 block">
            <span className="text-sm font-medium">Base URL</span>
            <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                type === "ollama" ? "http://ollama:11434"
                : type === "vllm" ? "http://vllm:8000/v1"
                : type === "tesseract_remote" ? "http://tesseract:8080"
                : "https://…"
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
        )}

        {(typeInfo?.needs_key || type === "openai") && (
          <label className="space-y-1 block">
            <span className="text-sm font-medium">API Key</span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasSavedKey ? "configured (leave blank to keep)" : "Enter API key"}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
        )}

        <label className="space-y-1 block">
          <span className="text-sm font-medium">Max concurrent requests</span>
          <input type="number" min={1} max={64} step={1}
            value={maxConcurrent} onChange={(e) => setMaxConcurrent(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <span className="block text-xs text-muted-foreground">
            Shared across every model that uses this provider.
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 block">
            <span className="text-sm font-medium">Max retries</span>
            <input type="number" min={0} max={10} step={1}
              value={maxRetries} onChange={(e) => setMaxRetries(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1 block">
            <span className="text-sm font-medium">Retry backoff (s)</span>
            <input type="text" value={retryBackoff} onChange={(e) => setRetryBackoff(e.target.value)}
              placeholder="30,60,120"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
        </div>
        <span className="block text-xs text-muted-foreground -mt-1">
          Transient-failure policy for this connection. Claude / OpenAI rate limits and Ollama timeouts can differ; tune per provider.
        </span>

        {err && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-3 py-2 text-sm">{err}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Attach-model inline form ────────────────────────────────────

interface AddModelFormProps {
  cred: Credential;
  onSubmit: (kind: ModelKind, model: string, timeout: number) => Promise<void>;
  onCancel: () => void;
}

function AddModelForm({ cred, onSubmit, onCancel }: AddModelFormProps) {
  const kinds = allowedKindsFor(cred.type);
  const [kind, setKind] = useState<ModelKind>(kinds[0]);
  const [model, setModel] = useState("");
  const [timeout, setTimeout] = useState(kind === "vision" ? 600 : 120);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsModelField = !(cred.type === "google_vision" || cred.type === "tesseract_remote");

  const submit = async () => {
    setErr(null);
    if (needsModelField && !model.trim()) { setErr("Model name is required"); return; }
    setSaving(true);
    try {
      await onSubmit(kind, model.trim(), timeout);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Failed to add model");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2 flex-wrap">
        {kinds.length > 1 ? (
          <select value={kind} onChange={(e) => setKind(e.target.value as ModelKind)}
            className="rounded-md border bg-background px-2 py-1 text-sm">
            {kinds.includes("llm") && <option value="llm">LLM</option>}
            {kinds.includes("vision") && <option value="vision">Vision</option>}
            {kinds.includes("ocr") && <option value="ocr">OCR</option>}
          </select>
        ) : (
          <span className="rounded-md bg-muted px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            {kinds[0]}
          </span>
        )}
        {needsModelField && (
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)}
            placeholder={kind === "vision" ? "e.g. qwen2.5-vl" : kind === "ocr" ? "e.g. llava-vision" : "e.g. llama3.1"}
            className="flex-1 min-w-[160px] rounded-md border bg-background px-2 py-1 text-sm" />
        )}
        <input type="number" min={10} max={1800} step={30}
          value={timeout} onChange={(e) => setTimeout(Math.max(10, parseInt(e.target.value, 10) || 10))}
          title="Timeout (s)"
          className="w-20 rounded-md border bg-background px-2 py-1 text-sm" />
        <button onClick={submit} disabled={saving}
          className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? "Adding…" : "Add"}
        </button>
        <button onClick={onCancel}
          className="rounded-md border px-3 py-1 text-xs hover:bg-accent">
          Cancel
        </button>
      </div>
      {err && (
        <div className="text-xs text-red-600 dark:text-red-400">{err}</div>
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────

export default function ProvidersTab() {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [llm, setLlm] = useState<LlmProvider[]>([]);
  const [vision, setVision] = useState<VisionLlmProvider[]>([]);
  const [ocr, setOcr] = useState<OcrProvider[]>([]);
  const [editingCred, setEditingCred] = useState<Partial<Credential> | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null); // credential id
  const [busy, setBusy] = useState(false);

  const reloadAll = async () => {
    try {
      const [c, l, v, o] = await Promise.all([
        api.get("/settings/credentials"),
        api.get("/settings/llm-providers"),
        api.get("/settings/vision-providers"),
        api.get("/settings/ocr-providers"),
      ]);
      setCredentials(Array.isArray(c.data) ? c.data : []);
      setLlm(Array.isArray(l.data) ? l.data : []);
      setVision(Array.isArray(v.data) ? v.data : []);
      setOcr(Array.isArray(o.data) ? o.data : []);
    } catch {
      toast({ title: "Failed to load providers", variant: "error" });
    }
  };

  useEffect(() => { reloadAll(); }, []);

  // Group attached models by credential_id.
  const attachedByCred = useMemo(() => {
    const map = new Map<string, AttachedModel[]>();
    for (const p of llm) {
      if (!p.credential_id) continue;
      const arr = map.get(p.credential_id) || [];
      arr.push({ kind: "llm", entry_id: p.id, name: p.name || p.model, model: p.model, enabled: p.enabled, priority: p.priority, timeout: p.timeout });
      map.set(p.credential_id, arr);
    }
    for (const p of vision) {
      if (!p.credential_id) continue;
      const arr = map.get(p.credential_id) || [];
      arr.push({ kind: "vision", entry_id: p.id, name: p.name || p.model, model: p.model, enabled: p.enabled, priority: p.priority, timeout: p.timeout });
      map.set(p.credential_id, arr);
    }
    for (const p of ocr) {
      if (!p.credential_id) continue;
      const arr = map.get(p.credential_id) || [];
      const label =
        p.type === "llm_vision" ? (p.llm_model || p.name || "LLM vision OCR")
        : p.type === "google_vision" ? (p.name || "Google Vision OCR")
        : p.type === "tesseract_remote" ? (p.name || "Tesseract remote")
        : (p.name || p.type);
      arr.push({ kind: "ocr", entry_id: p.id, name: label, model: p.llm_model || "", enabled: p.enabled, priority: p.priority, timeout: 0 });
      map.set(p.credential_id, arr);
    }
    return map;
  }, [llm, vision, ocr]);

  // ── Credential CRUD ──────────────────────────────────────────
  const handleSaveCredential = async (c: Credential) => {
    const exists = credentials.some((x) => x.id === c.id);
    const next = exists
      ? credentials.map((x) => (x.id === c.id ? { ...x, ...c } : x))
      : [...credentials, c];
    setBusy(true);
    try {
      await api.put("/settings/credentials", next);
      await reloadAll();
    } finally { setBusy(false); }
  };

  const handleDeleteCredential = async (id: string) => {
    const cred = credentials.find((c) => c.id === id);
    if (!cred) return;
    if ((cred.references?.total || 0) > 0) {
      toast({ title: `"${cred.name}" has attached models; remove them first`, variant: "error" });
      return;
    }
    const next = credentials.filter((c) => c.id !== id);
    setBusy(true);
    try {
      await api.put("/settings/credentials", next);
      await reloadAll();
    } catch (e: any) {
      toast({
        title: "Failed to delete provider",
        description: e?.response?.data?.detail || e?.message || "",
        variant: "error",
      });
    } finally { setBusy(false); }
  };

  // ── Attached model CRUD (updates the right *-providers list) ─
  const addModel = async (cred: Credential, kind: ModelKind, model: string, timeout: number) => {
    if (kind === "llm") {
      const entry: LlmProvider = {
        id: `llm-${Date.now()}`, type: cred.type, name: model || cred.name,
        enabled: true, priority: llm.length + 1, credential_id: cred.id,
        base_url: "", model, api_key: "", timeout,
      };
      await api.put("/settings/llm-providers", [...llm, entry]);
    } else if (kind === "vision") {
      const entry: VisionLlmProvider = {
        id: `vision-${Date.now()}`, type: cred.type, name: model || cred.name,
        enabled: true, priority: vision.length + 1, credential_id: cred.id,
        base_url: "", model, api_key: "", timeout,
      };
      await api.put("/settings/vision-providers", [...vision, entry]);
    } else { // ocr
      const ocrType =
        cred.type === "google_vision" ? "google_vision"
        : cred.type === "tesseract_remote" ? "tesseract_remote"
        : "llm_vision";
      const entry: OcrProvider = {
        id: `ocr-${Date.now()}`, type: ocrType, name: model || cred.name,
        enabled: true, priority: ocr.length + 1, credential_id: cred.id,
        language: "eng", remote_url: "", remote_api_key: "",
        llm_provider: (cred.type === "ollama" || cred.type === "vllm" || cred.type === "claude" || cred.type === "openai") ? cred.type : "ollama",
        llm_model: ocrType === "llm_vision" ? model : "",
        llm_base_url: "", llm_api_key: "", google_vision_key: "",
        confidence_threshold: 0.7,
      };
      await api.put("/settings/ocr-providers", [...ocr, entry]);
    }
    await reloadAll();
    setAddingTo(null);
  };

  const removeModel = async (m: AttachedModel) => {
    if (m.kind === "llm") {
      await api.put("/settings/llm-providers", llm.filter((p) => p.id !== m.entry_id));
    } else if (m.kind === "vision") {
      await api.put("/settings/vision-providers", vision.filter((p) => p.id !== m.entry_id));
    } else {
      await api.put("/settings/ocr-providers", ocr.filter((p) => p.id !== m.entry_id));
    }
    await reloadAll();
  };

  const toggleModel = async (m: AttachedModel) => {
    if (m.kind === "llm") {
      await api.put("/settings/llm-providers", llm.map((p) => p.id === m.entry_id ? { ...p, enabled: !p.enabled } : p));
    } else if (m.kind === "vision") {
      await api.put("/settings/vision-providers", vision.map((p) => p.id === m.entry_id ? { ...p, enabled: !p.enabled } : p));
    } else {
      await api.put("/settings/ocr-providers", ocr.map((p) => p.id === m.entry_id ? { ...p, enabled: !p.enabled } : p));
    }
    await reloadAll();
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        A <strong>provider</strong> is a connection (credentials + concurrency +
        retry policy). Under each provider, list the models it exposes —
        LLM, Vision, or OCR. Ranking and task assignment happens on the
        <strong> Priority</strong> tab.
      </div>

      {credentials.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <KeyRound className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">No providers configured</p>
          <p className="text-sm mt-1">Add a provider to get started.</p>
        </div>
      )}

      <div className="space-y-3">
        {credentials.map((c) => {
          const Icon = iconForType(c.type);
          const models = attachedByCred.get(c.id) || [];
          const refs = c.references || { llm: 0, vision: 0, ocr: 0, general: 0, total: 0 };
          return (
            <div key={c.id} className="rounded-lg border overflow-hidden">
              {/* Credential header */}
              <div className="flex items-center gap-3 p-3 bg-card">
                <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {c.type}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      max {c.max_concurrent} concurrent · {c.max_retries} retries
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground truncate">
                    {c.base_url || <span className="italic opacity-60">no base URL</span>}
                    {" · "}
                    {c.has_api_key ? "API key ••••••••" : "no API key"}
                  </div>
                </div>
                <button onClick={() => setEditingCred(c)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="Edit provider">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDeleteCredential(c.id)}
                  disabled={refs.total > 0 || busy}
                  title={refs.total > 0 ? `${refs.total} model(s) attached — remove them first` : "Delete provider"}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:bg-transparent">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Attached models */}
              <div className="border-t bg-background p-3 space-y-2">
                {models.length === 0 && addingTo !== c.id && (
                  <div className="text-xs text-muted-foreground italic py-1">
                    No models attached yet.
                  </div>
                )}
                {models.map((m) => {
                  const KindIcon = m.kind === "vision" ? Eye : m.kind === "ocr" ? ScanText : Brain;
                  const kindClass =
                    m.kind === "vision" ? "text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-300"
                    : m.kind === "ocr" ? "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300"
                    : "text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-300";
                  return (
                    <div key={`${m.kind}-${m.entry_id}`}
                      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${m.enabled ? "" : "opacity-60"}`}>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${kindClass}`}>
                        <KindIcon className="h-3 w-3" />
                        {m.kind}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-sm">{m.name}</span>
                      {m.model && m.model !== m.name && (
                        <span className="text-xs text-muted-foreground truncate">{m.model}</span>
                      )}
                      <button onClick={() => toggleModel(m)}
                        title={m.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
                        className={`rounded-md p-1 ${m.enabled ? "text-green-600" : "text-muted-foreground"} hover:bg-accent`}>
                        {m.enabled ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => removeModel(m)}
                        className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}

                {addingTo === c.id ? (
                  <AddModelForm cred={c}
                    onSubmit={(kind, model, timeout) => addModel(c, kind, model, timeout)}
                    onCancel={() => setAddingTo(null)} />
                ) : (
                  <button onClick={() => setAddingTo(c.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                    <Plus className="h-3.5 w-3.5" /> Add model
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={() => setEditingCred({})}
        className="flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
        <Plus className="h-4 w-4" /> Add Provider
      </button>

      {editingCred && (
        <CredentialDialog initial={editingCred} onSave={handleSaveCredential}
          onClose={() => setEditingCred(null)} />
      )}
    </div>
  );
}
