import { useEffect, useState } from "react";
import api from "@/api/client";
import {
  Brain, Plus, Trash2, Save, Check, Power,
  ChevronUp, ChevronDown, X, Zap, Loader2,
} from "lucide-react";
import { TextField, NumberField } from "./SettingsFormHelpers";
import CredentialPicker from "./CredentialPicker";
import type { LlmProvider, Credential } from "@/types";
import { useToast } from "@/contexts/ToastContext";

export const LLM_TYPES = [
  { value: "ollama", label: "Ollama", description: "Local LLM via Ollama" },
  { value: "vllm", label: "vLLM", description: "vLLM (OpenAI-compatible API)" },
  { value: "claude", label: "Claude", description: "Anthropic Claude API" },
  { value: "openai", label: "OpenAI", description: "OpenAI API (GPT-4, etc.)" },
];

const LLM_ALLOWED_CRED_TYPES = ["ollama", "vllm", "claude", "openai"];

export default function LlmProvidersTab() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [maxRetries, setMaxRetries] = useState<number>(3);
  const [retryBackoff, setRetryBackoff] = useState<string>("30,60,120");
  const [globalSaved, setGlobalSaved] = useState<{ retries: number; backoff: string }>({ retries: 3, backoff: "30,60,120" });
  const [savingGlobal, setSavingGlobal] = useState(false);

  useEffect(() => {
    api.get("/settings/llm-providers").then((res) => {
      const data = Array.isArray(res.data) ? res.data : [];
      setProviders(data);
      if (data.length > 0) setExpandedId(data[0].id);
    });
    api.get("/settings/credentials").then((res) => {
      setCredentials(Array.isArray(res.data) ? res.data : []);
    });
    api.get("/settings").then((res) => {
      const llm = res.data?.llm || {};
      const r = typeof llm.max_retries === "number" ? llm.max_retries : 3;
      const b = Array.isArray(llm.retry_backoff_seconds) && llm.retry_backoff_seconds.length
        ? llm.retry_backoff_seconds.join(",")
        : "30,60,120";
      setMaxRetries(r);
      setRetryBackoff(b);
      setGlobalSaved({ retries: r, backoff: b });
    });
  }, []);

  const parseBackoff = (s: string): number[] =>
    s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);

  const globalDirty =
    maxRetries !== globalSaved.retries ||
    retryBackoff !== globalSaved.backoff;

  const saveGlobal = async () => {
    const backoffArr = parseBackoff(retryBackoff);
    if (backoffArr.length === 0) {
      toast({ title: "Retry backoff must be a comma-separated list of non-negative integers", variant: "error" });
      return;
    }
    setSavingGlobal(true);
    try {
      await api.patch("/settings", {
        llm_max_retries: maxRetries,
        llm_retry_backoff_seconds: backoffArr,
      });
      const normalizedBackoff = backoffArr.join(",");
      setRetryBackoff(normalizedBackoff);
      setGlobalSaved({ retries: maxRetries, backoff: normalizedBackoff });
    } catch { toast({ title: "Failed to save global LLM settings", variant: "error" }); }
    setSavingGlobal(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/llm-providers", providers);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { toast({ title: "Failed to save LLM providers", variant: "error" }); }
    setSaving(false);
  };

  const addProvider = () => {
    const newId = `llm-${Date.now()}`;
    const entry: LlmProvider = {
      id: newId,
      type: "ollama",
      name: "New LLM model",
      enabled: true,
      priority: providers.length + 1,
      credential_id: "",
      base_url: "",
      model: "",
      api_key: "",
      timeout: 120,
      max_concurrent: 2,
    };
    setProviders([...providers, entry]);
    setExpandedId(newId);
  };

  const removeProvider = (id: string) => {
    setProviders(providers.filter((p) => p.id !== id).map((p, i) => ({ ...p, priority: i + 1 })));
  };

  const updateProvider = (id: string, updates: Partial<LlmProvider>) => {
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
        Configure LLM providers for document classification, data extraction, chat, and search.
        Providers are tried in priority order (top = highest priority). If you're not satisfied with a result,
        you can re-process a document with the next provider from the document detail page.
      </div>

      {/* Global LLM settings: retries (concurrency is per-model now) */}
      <div className="rounded-lg border p-3 space-y-3">
        <div className="text-sm font-medium">Global LLM Retry Behavior</div>
        <div className="text-xs text-muted-foreground">
          Concurrency is now per-model — set it on each entry below. These retries apply
          to transient ReadTimeout / ConnectError failures inside a single call.
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <NumberField
            label="Max retries"
            value={maxRetries}
            onChange={(v) => setMaxRetries(Math.max(0, v))}
            min={0} max={10} step={1}
            description="How many times to retry a failed call. Total attempts = 1 + retries. Set to 0 to fail fast."
          />
          <label className="space-y-1 block">
            <span className="text-sm font-medium">Retry backoff (seconds)</span>
            <input
              type="text"
              value={retryBackoff}
              onChange={(e) => setRetryBackoff(e.target.value)}
              placeholder="30,60,120"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <span className="block text-xs text-muted-foreground">
              Comma-separated wait between attempts. Last value reused.
            </span>
          </label>
        </div>
        <div className="flex justify-end">
          <button
            onClick={saveGlobal}
            disabled={savingGlobal || !globalDirty}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {!globalDirty ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {savingGlobal ? "Saving..." : !globalDirty ? "Saved" : "Save retry settings"}
          </button>
        </div>
      </div>

      {providers.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">No LLM providers configured</p>
          <p className="text-sm mt-1">Add a provider below to get started.</p>
        </div>
      )}

      <div className="space-y-2">
        {providers.map((p, idx) => {
          const isExpanded = expandedId === p.id;
          const cred = credentials.find((c) => c.id === p.credential_id);
          const effectiveType = cred?.type || p.type;
          return (
            <div key={p.id} className={`rounded-lg border transition-colors ${p.enabled ? "bg-card" : "bg-muted/30 opacity-75"}`}>
              {/* Header row */}
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

              {/* Expanded settings */}
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
                    allowedTypes={LLM_ALLOWED_CRED_TYPES}
                    description="Sets the base URL + API key for this entry. Edit credentials in the Credentials tab."
                  />
                  <TextField label="Model" value={p.model} onChange={(v) => updateProvider(p.id, { model: v })}
                    placeholder={effectiveType === "ollama" ? "e.g. llama3.1" : effectiveType === "claude" ? "e.g. claude-sonnet-4-20250514" : "e.g. gpt-4o"} />
                  <NumberField label="Max concurrent" value={p.max_concurrent || 2}
                    onChange={(v) => updateProvider(p.id, { max_concurrent: Math.max(1, v) })}
                    min={1} max={32} step={1}
                    description="Parallel requests to this (credential, model) tuple. Shared with any other entry pointing at the same physical model."
                  />
                  <NumberField label="Timeout (seconds)" value={p.timeout}
                    onChange={(v) => updateProvider(p.id, { timeout: v })} min={30} max={1800} step={30} />

                  {/* Test connection button */}
                  <div className="pt-2 border-t">
                    <button
                      onClick={async () => {
                        setTestingId(p.id);
                        setTestResults((r) => { const copy = { ...r }; delete copy[p.id]; return copy; });
                        try {
                          const res = await api.post("/settings/test-llm-provider", { provider: p });
                          setTestResults((r) => ({
                            ...r,
                            [p.id]: res.data.ok
                              ? { ok: true, message: res.data.response || "OK" }
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

      {/* Add + save */}
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
