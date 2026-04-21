import { useEffect, useState } from "react";
import api from "@/api/client";
import {
  Eye, Plus, Trash2, Save, Check, Power,
  ChevronUp, ChevronDown, X, Zap, Loader2, Info,
} from "lucide-react";
import { TextField, NumberField } from "./SettingsFormHelpers";
import CredentialPicker from "./CredentialPicker";
import type { VisionLlmProvider, Credential } from "@/types";
import { useToast } from "@/contexts/ToastContext";

export const VISION_TYPES = [
  { value: "claude", label: "Claude", description: "Anthropic Claude with vision" },
  { value: "openai", label: "OpenAI", description: "GPT-4o / GPT-4 vision" },
  { value: "ollama", label: "Ollama", description: "Local vision model (e.g. llama3.2-vision)" },
];

const VISION_ALLOWED_CRED_TYPES = ["claude", "openai", "ollama"];

const DEFAULT_MODELS: Record<string, string> = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  ollama: "llama3.2-vision",
};

export default function VisionLlmProvidersTab() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<VisionLlmProvider[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [maxRetries, setMaxRetries] = useState<number>(3);
  const [retryBackoff, setRetryBackoff] = useState<string>("30,60,120");
  const [extractionTimeout, setExtractionTimeout] = useState<number>(600);
  const [globalSaved, setGlobalSaved] = useState<{ retries: number; backoff: string; timeout: number }>({ retries: 3, backoff: "30,60,120", timeout: 600 });
  const [savingGlobal, setSavingGlobal] = useState(false);

  useEffect(() => {
    api.get("/settings/vision-providers").then((res) => {
      const data = Array.isArray(res.data) ? res.data : [];
      setProviders(data);
      if (data.length > 0) setExpandedId(data[0].id);
    });
    api.get("/settings/credentials").then((res) => {
      setCredentials(Array.isArray(res.data) ? res.data : []);
    });
    api.get("/settings").then((res) => {
      const v = res.data?.vision || {};
      const r = typeof v.max_retries === "number" ? v.max_retries : 3;
      const b = Array.isArray(v.retry_backoff_seconds) && v.retry_backoff_seconds.length
        ? v.retry_backoff_seconds.join(",")
        : "30,60,120";
      const t = typeof v.extraction_timeout === "number" ? v.extraction_timeout : 600;
      setMaxRetries(r);
      setRetryBackoff(b);
      setExtractionTimeout(t);
      setGlobalSaved({ retries: r, backoff: b, timeout: t });
    });
  }, []);

  const parseBackoff = (s: string): number[] =>
    s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);

  const globalDirty =
    maxRetries !== globalSaved.retries ||
    retryBackoff !== globalSaved.backoff ||
    extractionTimeout !== globalSaved.timeout;

  const saveGlobal = async () => {
    const backoffArr = parseBackoff(retryBackoff);
    if (backoffArr.length === 0) {
      toast({ title: "Retry backoff must be a comma-separated list of non-negative integers", variant: "error" });
      return;
    }
    setSavingGlobal(true);
    try {
      await api.patch("/settings", {
        vision_max_retries: maxRetries,
        vision_retry_backoff_seconds: backoffArr,
        vision_extraction_timeout: extractionTimeout,
      });
      const normalizedBackoff = backoffArr.join(",");
      setRetryBackoff(normalizedBackoff);
      setGlobalSaved({ retries: maxRetries, backoff: normalizedBackoff, timeout: extractionTimeout });
    } catch { toast({ title: "Failed to save global Vision-LLM settings", variant: "error" }); }
    setSavingGlobal(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/vision-providers", providers);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { toast({ title: "Failed to save Vision-LLM providers", variant: "error" }); }
    setSaving(false);
  };

  const addProvider = () => {
    const newId = `vision-${Date.now()}`;
    const entry: VisionLlmProvider = {
      id: newId,
      type: "claude",
      name: "New vision model",
      enabled: true,
      priority: providers.length + 1,
      credential_id: "",
      base_url: "",
      model: "",
      api_key: "",
      timeout: 600,
      max_concurrent: 2,
    };
    setProviders([...providers, entry]);
    setExpandedId(newId);
  };

  const removeProvider = (id: string) => {
    setProviders(providers.filter((p) => p.id !== id).map((p, i) => ({ ...p, priority: i + 1 })));
  };

  const updateProvider = (id: string, updates: Partial<VisionLlmProvider>) => {
    setProviders(providers.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const moveProvider = (id: string, direction: "up" | "down") => {
    const idx = providers.findIndex((p) => p.id === id);
    if (direction === "up" && idx > 0) {
      const copy = [...providers];
      [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
      setProviders(copy.map((p, i) => ({ ...p, priority: i + 1 })));
    } else if (direction === "down" && idx < providers.length - 1) {
      const copy = [...providers];
      [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
      setProviders(copy.map((p, i) => ({ ...p, priority: i + 1 })));
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        Vision-LLM providers are an alternative to the OCR + text-LLM flow. Each page image is sent
        directly to a vision model, which returns both the transcribed text and the structured
        extraction in a single call. Providers are tried in priority order — if the top provider
        fails, the next one runs. Select <span className="font-medium">Vision-LLM</span> as the
        default flow on the Pipeline tab or override it per-document from the reprocess menu.
      </div>

      {/* Global Vision settings (retries + timeout; concurrency is per-model) */}
      <div className="rounded-lg border p-3 space-y-3">
        <div className="text-sm font-medium">Global Vision-LLM Behavior</div>
        <div className="text-xs text-muted-foreground">
          Concurrency is now per-model — set it on each entry below.
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <NumberField
            label="Max retries"
            value={maxRetries}
            onChange={(v) => setMaxRetries(Math.max(0, v))}
            min={0} max={10} step={1}
            description="Retries per page on transient failures (timeouts, rate limits)."
          />
          <label className="space-y-1 block">
            <span className="flex items-center gap-1 text-sm font-medium">
              Retry backoff (seconds)
              <span
                className="text-muted-foreground hover:text-foreground cursor-help"
                title={
                  "Wait between retries after a transient vision-call failure.\n\n" +
                  "Format: comma-separated non-negative integers. " +
                  "The first value is the wait before retry 1, etc. " +
                  "If the list is shorter than 'Max retries', the last value is reused."
                }
              >
                <Info className="h-3.5 w-3.5" />
              </span>
            </span>
            <input
              type="text"
              value={retryBackoff}
              onChange={(e) => setRetryBackoff(e.target.value)}
              placeholder="30,60,120"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
          <NumberField
            label="Extraction timeout (seconds)"
            value={extractionTimeout}
            onChange={(v) => setExtractionTimeout(Math.max(30, v))}
            min={30} max={3600} step={30}
            description="Per-page timeout for vision calls."
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={saveGlobal}
            disabled={savingGlobal || !globalDirty}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {!globalDirty ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {savingGlobal ? "Saving..." : !globalDirty ? "Saved" : "Save global settings"}
          </button>
        </div>
      </div>

      {providers.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">No Vision-LLM providers configured</p>
          <p className="text-sm mt-1">Add a provider below to enable the Vision-LLM flow.</p>
        </div>
      )}

      <div className="space-y-2">
        {providers.map((p, idx) => {
          const isExpanded = expandedId === p.id;
          const cred = credentials.find((c) => c.id === p.credential_id);
          const effectiveType = cred?.type || p.type;
          return (
            <div key={p.id} className={`rounded-lg border transition-colors ${p.enabled ? "bg-card" : "bg-muted/30 opacity-75"}`}>
              <div className="flex items-center gap-2 px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveProvider(p.id, "up")} disabled={idx === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => moveProvider(p.id, "down")} disabled={idx === providers.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <span className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold">
                  {idx + 1}
                </span>

                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : p.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{p.name || p.model || "Untitled"}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {effectiveType}
                    </span>
                    {p.model && <span className="text-xs text-muted-foreground truncate">{p.model}</span>}
                    {cred && <span className="text-xs text-muted-foreground">via {cred.name}</span>}
                    {!cred && <span className="text-xs text-amber-600">no credential</span>}
                  </div>
                </div>

                <span className="text-xs text-muted-foreground" title="Max concurrent requests for this (credential, model) tuple">
                  cap {p.max_concurrent || 2}
                </span>

                <button onClick={() => updateProvider(p.id, { enabled: !p.enabled })}
                  className={`rounded-md p-1.5 transition-colors ${p.enabled ? "text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" : "text-muted-foreground hover:bg-accent"}`}
                  title={p.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}>
                  <Power className="h-4 w-4" />
                </button>

                <button onClick={() => removeProvider(p.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {isExpanded && (
                <div className="border-t px-4 py-3 grid gap-3 max-w-lg">
                  <TextField label="Display Name" value={p.name} onChange={(v) => updateProvider(p.id, { name: v })} />
                  <CredentialPicker
                    value={p.credential_id || ""}
                    onChange={(id) => {
                      const chosen = credentials.find((c) => c.id === id);
                      updateProvider(p.id, {
                        credential_id: id,
                        type: chosen?.type || p.type,
                      });
                    }}
                    credentials={credentials}
                    allowedTypes={VISION_ALLOWED_CRED_TYPES}
                  />
                  <TextField label="Model" value={p.model} onChange={(v) => updateProvider(p.id, { model: v })}
                    placeholder={`e.g. ${DEFAULT_MODELS[effectiveType] || ""}`} />
                  <NumberField label="Max concurrent" value={p.max_concurrent || 2}
                    onChange={(v) => updateProvider(p.id, { max_concurrent: Math.max(1, v) })}
                    min={1} max={32} step={1}
                    description="Parallel vision calls for this (credential, model) tuple."
                  />
                  <NumberField label="Timeout (seconds)" value={p.timeout}
                    onChange={(v) => updateProvider(p.id, { timeout: v })} min={30} max={1800} step={30} />

                  <div className="pt-2 border-t">
                    <button
                      onClick={async () => {
                        setTestingId(p.id);
                        setTestResults((r) => { const copy = { ...r }; delete copy[p.id]; return copy; });
                        try {
                          const res = await api.post("/settings/test-vision-provider", { provider: p });
                          setTestResults((r) => ({
                            ...r,
                            [p.id]: res.data.ok
                              ? { ok: true, message: res.data.detail || "OK" }
                              : { ok: false, message: res.data.error || "Failed" },
                          }));
                        } catch (e: any) {
                          setTestResults((r) => ({
                            ...r,
                            [p.id]: { ok: false, message: e.response?.data?.detail || e.message || "Request failed" },
                          }));
                        }
                        setTestingId(null);
                      }}
                      disabled={testingId === p.id}
                      className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                    >
                      {testingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      {testingId === p.id ? "Testing..." : "Test Connection"}
                    </button>
                    {testResults[p.id] && (
                      <div className={`mt-2 rounded-md px-3 py-2 text-xs font-mono break-all ${
                        testResults[p.id].ok
                          ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                          : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                      }`}>
                        {testResults[p.id].ok ? <Check className="h-3 w-3 inline mr-1" /> : <X className="h-3 w-3 inline mr-1" />}
                        {testResults[p.id].message}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={addProvider}
          className="flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Model
        </button>

        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 ml-auto">
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? "Saved" : saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
