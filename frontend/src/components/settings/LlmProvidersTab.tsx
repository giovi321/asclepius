import { useEffect, useState } from "react";
import api from "@/api/client";
import {
  Brain, Plus, Trash2, Save, Check, Power,
  ChevronUp, ChevronDown, X, Zap, Loader2,
} from "lucide-react";
import { TextField, NumberField, SelectField } from "./SettingsFormHelpers";
import type { LlmProvider } from "@/types";
import { useToast } from "@/contexts/ToastContext";

export const LLM_TYPES = [
  { value: "ollama", label: "Ollama", description: "Local LLM via Ollama" },
  { value: "vllm", label: "vLLM", description: "vLLM (OpenAI-compatible API)" },
  { value: "claude", label: "Claude", description: "Anthropic Claude API" },
  { value: "openai", label: "OpenAI", description: "OpenAI API (GPT-4, etc.)" },
];

export default function LlmProvidersTab() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [maxConcurrent, setMaxConcurrent] = useState<number>(2);
  const [maxConcurrentSaved, setMaxConcurrentSaved] = useState<number>(2);
  const [savingGlobal, setSavingGlobal] = useState(false);

  useEffect(() => {
    api.get("/settings/llm-providers").then((res) => {
      const data = Array.isArray(res.data) ? res.data : [];
      setProviders(data);
      if (data.length > 0) setExpandedId(data[0].id);
    });
    api.get("/settings").then((res) => {
      const v = res.data?.llm?.max_concurrent_requests;
      if (typeof v === "number") {
        setMaxConcurrent(v);
        setMaxConcurrentSaved(v);
      }
    });
  }, []);

  const saveGlobal = async () => {
    setSavingGlobal(true);
    try {
      await api.patch("/settings", { llm_max_concurrent_requests: maxConcurrent });
      setMaxConcurrentSaved(maxConcurrent);
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

  const addProvider = (type: string) => {
    const typeInfo = LLM_TYPES.find((t) => t.value === type);
    const newId = `${type}-${Date.now()}`;
    const entry: LlmProvider = {
      id: newId,
      type,
      name: typeInfo?.label || type,
      enabled: true,
      priority: providers.length + 1,
      base_url: type === "ollama" ? "http://ollama:11434" : type === "vllm" ? "http://vllm:8000/v1" : "",
      model: type === "ollama" ? "llama3.1" : type === "claude" ? "claude-sonnet-4-20250514" : type === "openai" ? "gpt-4o" : "",
      api_key: "",
      timeout: 120,
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

      {/* Global LLM concurrency */}
      <div className="rounded-lg border p-3">
        <div className="flex items-end gap-3 max-w-md">
          <div className="flex-1">
            <NumberField
              label="Max concurrent LLM requests"
              value={maxConcurrent}
              onChange={(v) => setMaxConcurrent(Math.max(1, v))}
              min={1} max={16} step={1}
              description="Limits parallel requests across all LLM providers. Lower this if your Ollama/vLLM instance times out under load (1 = fully serialized)."
            />
          </div>
          <button
            onClick={saveGlobal}
            disabled={savingGlobal || maxConcurrent === maxConcurrentSaved}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {maxConcurrent === maxConcurrentSaved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {savingGlobal ? "Saving..." : maxConcurrent === maxConcurrentSaved ? "Saved" : "Save"}
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
          const typeInfo = LLM_TYPES.find((t) => t.value === p.type);
          const isExpanded = expandedId === p.id;
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
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{p.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {typeInfo?.label || p.type}
                    </span>
                    {p.model && <span className="text-xs text-muted-foreground truncate">{p.model}</span>}
                  </div>
                </div>

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
                  <SelectField label="Provider Type" value={p.type}
                    onChange={(v) => updateProvider(p.id, { type: v })}
                    options={LLM_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
                  <TextField label="Model" value={p.model} onChange={(v) => updateProvider(p.id, { model: v })}
                    placeholder={p.type === "ollama" ? "e.g. llama3.1" : p.type === "claude" ? "e.g. claude-sonnet-4-20250514" : "e.g. gpt-4o"} />
                  {(p.type === "ollama" || p.type === "vllm") && (
                    <TextField label="Base URL" value={p.base_url} onChange={(v) => updateProvider(p.id, { base_url: v })}
                      placeholder={p.type === "ollama" ? "http://ollama:11434" : "http://vllm:8000/v1"} />
                  )}
                  {(p.type === "openai" && p.base_url) && (
                    <TextField label="Base URL (optional)" value={p.base_url}
                      onChange={(v) => updateProvider(p.id, { base_url: v })}
                      placeholder="https://api.openai.com/v1" description="Leave empty for default OpenAI endpoint" />
                  )}
                  {(p.type === "claude" || p.type === "openai" || p.type === "vllm") && (
                    <TextField label="API Key" value={p.api_key} onChange={(v) => updateProvider(p.id, { api_key: v })}
                      type="password" placeholder={p.has_api_key ? "configured (leave blank to keep)" : "Enter API key"} />
                  )}
                  <NumberField label="Timeout (seconds)" value={p.timeout}
                    onChange={(v) => updateProvider(p.id, { timeout: v })} min={30} max={1800} step={30} />

                  {/* Test connection button */}
                  <div className="pt-2 border-t">
                    <button
                      onClick={async () => {
                        setTestingId(p.id);
                        setTestResults((r) => { const copy = { ...r }; delete copy[p.id]; return copy; });
                        try {
                          const res = await api.post("/settings/test-llm-provider", { provider_id: p.id });
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

      {/* Add provider dropdown */}
      <div className="flex items-center gap-3">
        <div className="relative group">
          <button className="flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
            <Plus className="h-4 w-4" /> Add Provider
          </button>
          <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-10 rounded-lg border bg-popover p-1.5 shadow-lg min-w-[200px]">
            {LLM_TYPES.map((t) => (
              <button key={t.value} onClick={() => addProvider(t.value)}
                className="flex flex-col w-full rounded-md px-3 py-2 text-left hover:bg-accent transition-colors">
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </button>
            ))}
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 ml-auto">
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? "Saved" : saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
