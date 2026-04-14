import React, { useCallback, useEffect, useRef, useState } from "react";
import api from "@/api/client";
import {
  Users, Database, Brain, Eye, Shield, Workflow, Plus, Trash2, Save, Check,
  FileCode, RotateCcw, Download, ScrollText, Power, ChevronUp,
  ChevronDown, FileSearch, Search, Edit3, GitMerge, X, ChevronRight,
  Zap, AlertTriangle, Loader2, Play,
} from "lucide-react";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("analysis");

  const tabs = [
    { key: "analysis", label: "Document Analysis", icon: FileSearch },
    { key: "pipeline", label: "Pipeline", icon: Workflow },
    { key: "oidc", label: "OIDC / SSO", icon: Shield },
    { key: "users", label: "Users", icon: Users },
    { key: "backup", label: "Backup", icon: Download },
    { key: "logs", label: "Logs", icon: ScrollText },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="flex flex-wrap gap-1.5 rounded-lg border p-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "analysis" && <DocumentAnalysisTab />}
      {activeTab === "pipeline" && <PipelineTab />}
      {activeTab === "oidc" && <OidcTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "logs" && <LogsTab />}
      {activeTab === "backup" && <BackupTab />}
    </div>
  );
}

// ==========================
// Document Analysis — parent tab with sub-tabs
// ==========================

function DocumentAnalysisTab() {
  const [subTab, setSubTab] = useState("llm");

  const subTabs = [
    { key: "llm", label: "LLM Providers", icon: Brain },
    { key: "ocr", label: "OCR Providers", icon: Eye },
    { key: "prompts", label: "Prompts", icon: FileCode },
    { key: "normalization", label: "Normalization", icon: Database },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-md border p-1 bg-muted/30">
        {subTabs.map((st) => {
          const Icon = st.icon;
          return (
            <button
              key={st.key}
              onClick={() => setSubTab(st.key)}
              className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-sm whitespace-nowrap transition-colors ${
                subTab === st.key
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {st.label}
            </button>
          );
        })}
      </div>

      {subTab === "llm" && <LlmProvidersTab />}
      {subTab === "ocr" && <OcrProvidersTab />}
      {subTab === "prompts" && <PromptsTab />}
      {subTab === "normalization" && <NormalizationTab />}
    </div>
  );
}

// ==========================
// Generic form helpers
// ==========================

function SettingsForm({ title, children, onSave, saving, saved }: {
  title: string; children: React.ReactNode;
  onSave: () => void; saving: boolean; saved: boolean;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-4">
      <h3 className="font-medium">{title}</h3>
      <div className="grid gap-4 max-w-lg">{children}</div>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {saved ? "Saved" : saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, type = "text", description }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; description?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
    </label>
  );
}

function NumberField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min} max={max} step={step} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function ToggleField({ label, value, onChange, description }: {
  label: string; value: boolean; onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm font-medium">{label}</span>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? "bg-primary" : "bg-muted"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

function useSettingsSave() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = async (updates: Record<string, any>) => {
    setSaving(true);
    try {
      const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined && v !== ""));
      if (Object.keys(filtered).length > 0) {
        await api.patch("/settings", filtered);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch { alert("Failed to save settings"); }
    setSaving(false);
  };
  return { saving, saved, save };
}

// ==========================
// Provider type definitions
// ==========================

const LLM_TYPES = [
  { value: "ollama", label: "Ollama", description: "Local LLM via Ollama" },
  { value: "vllm", label: "vLLM", description: "vLLM (OpenAI-compatible API)" },
  { value: "claude", label: "Claude", description: "Anthropic Claude API" },
  { value: "openai", label: "OpenAI", description: "OpenAI API (GPT-4, etc.)" },
];

const OCR_TYPES = [
  { value: "tesseract", label: "Tesseract (Local)", description: "Local Tesseract OCR engine" },
  { value: "tesseract_remote", label: "Tesseract (Remote)", description: "Remote Tesseract OCR server" },
  { value: "llm_vision", label: "LLM Vision", description: "Send page images to an LLM for OCR" },
  { value: "google_vision", label: "Google Cloud Vision", description: "Google Cloud Vision API" },
];

const LLM_VISION_PROVIDERS = [
  { value: "ollama", label: "Ollama" },
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
];

// ==========================
// LLM Providers Tab
// ==========================

interface LlmProvider {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  priority: number;
  base_url: string;
  model: string;
  api_key: string;
  timeout: number;
  has_api_key?: boolean;
}

function LlmProvidersTab() {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => {
    api.get("/settings/llm-providers").then((res) => {
      const data = Array.isArray(res.data) ? res.data : [];
      setProviders(data);
      if (data.length > 0) setExpandedId(data[0].id);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/llm-providers", providers);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { alert("Failed to save LLM providers"); }
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
                    onChange={(v) => updateProvider(p.id, { timeout: v })} min={30} max={600} step={10} />

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

// ==========================
// OCR Providers Tab
// ==========================

interface OcrProvider {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  priority: number;
  language: string;
  remote_url: string;
  remote_api_key: string;
  llm_provider: string;
  llm_model: string;
  llm_base_url: string;
  llm_api_key: string;
  google_vision_key: string;
  confidence_threshold: number;
  has_remote_api_key?: boolean;
  has_llm_api_key?: boolean;
  has_google_vision_key?: boolean;
}

function OcrProvidersTab() {
  const [providers, setProviders] = useState<OcrProvider[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => {
    api.get("/settings/ocr-providers").then((res) => {
      const data = Array.isArray(res.data) ? res.data : [];
      setProviders(data);
      if (data.length > 0) setExpandedId(data[0].id);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/ocr-providers", providers);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { alert("Failed to save OCR providers"); }
    setSaving(false);
  };

  const addProvider = (type: string) => {
    const typeInfo = OCR_TYPES.find((t) => t.value === type);
    const newId = `${type}-${Date.now()}`;
    const entry: OcrProvider = {
      id: newId,
      type,
      name: typeInfo?.label || type,
      enabled: true,
      priority: providers.length + 1,
      language: "eng",
      remote_url: "",
      remote_api_key: "",
      llm_provider: "ollama",
      llm_model: "",
      llm_base_url: "",
      llm_api_key: "",
      google_vision_key: "",
      confidence_threshold: 0.7,
    };
    setProviders([...providers, entry]);
    setExpandedId(newId);
  };

  const removeProvider = (id: string) => {
    setProviders(providers.filter((p) => p.id !== id).map((p, i) => ({ ...p, priority: i + 1 })));
  };

  const updateProvider = (id: string, updates: Partial<OcrProvider>) => {
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
        Configure OCR engines for extracting text from scanned documents and images.
        Providers are tried in priority order. The pipeline uses the highest-priority enabled provider.
        You can re-process a document with a different provider from the document detail page.
      </div>

      {providers.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">No OCR providers configured</p>
          <p className="text-sm mt-1">Add a provider below to get started.</p>
        </div>
      )}

      <div className="space-y-2">
        {providers.map((p, idx) => {
          const typeInfo = OCR_TYPES.find((t) => t.value === p.type);
          const isExpanded = expandedId === p.id;
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
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{p.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {typeInfo?.label || p.type}
                    </span>
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

              {isExpanded && (
                <div className="border-t px-4 py-3 grid gap-3 max-w-lg">
                  <TextField label="Display Name" value={p.name} onChange={(v) => updateProvider(p.id, { name: v })} />

                  {/* Common: language for Tesseract-type engines */}
                  {(p.type === "tesseract" || p.type === "tesseract_remote") && (
                    <>
                      <TextField label="OCR Languages" value={p.language}
                        onChange={(v) => updateProvider(p.id, { language: v })}
                        placeholder="e.g. eng+fra+deu" description="Tesseract language codes separated by +" />
                      <NumberField label="Confidence Threshold" value={p.confidence_threshold}
                        onChange={(v) => updateProvider(p.id, { confidence_threshold: v })} min={0} max={1} step={0.05} />
                    </>
                  )}

                  {/* Remote Tesseract */}
                  {p.type === "tesseract_remote" && (
                    <>
                      <TextField label="Remote Server URL" value={p.remote_url}
                        onChange={(v) => updateProvider(p.id, { remote_url: v })} placeholder="http://ocr-server:8080/ocr" />
                      <TextField label="API Key" value={p.remote_api_key}
                        onChange={(v) => updateProvider(p.id, { remote_api_key: v })} type="password"
                        placeholder={p.has_remote_api_key ? "configured" : "Not set"} />
                    </>
                  )}

                  {/* LLM Vision */}
                  {p.type === "llm_vision" && (
                    <>
                      <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-3 text-xs text-blue-700 dark:text-blue-300">
                        Vision OCR sends page images to an LLM for text extraction. This can use a
                        different provider/model than your extraction LLM (e.g. Chandra for OCR + llama3.1 for extraction).
                      </div>
                      <SelectField label="Vision LLM Provider" value={p.llm_provider}
                        onChange={(v) => updateProvider(p.id, { llm_provider: v })}
                        options={LLM_VISION_PROVIDERS} />
                      <TextField label="Vision Model" value={p.llm_model}
                        onChange={(v) => updateProvider(p.id, { llm_model: v })}
                        placeholder={p.llm_provider === "ollama" ? "e.g. llava" : p.llm_provider === "claude" ? "e.g. claude-sonnet-4-20250514" : "e.g. gpt-4o"} />
                      {(p.llm_provider === "ollama") && (
                        <TextField label="Ollama URL" value={p.llm_base_url}
                          onChange={(v) => updateProvider(p.id, { llm_base_url: v })}
                          placeholder="http://ollama:11434" description="Leave empty to use the same URL as the extraction LLM" />
                      )}
                      {(p.llm_provider === "claude" || p.llm_provider === "openai") && (
                        <TextField label="API Key" value={p.llm_api_key}
                          onChange={(v) => updateProvider(p.id, { llm_api_key: v })} type="password"
                          placeholder={p.has_llm_api_key ? "configured" : "Enter API key"} />
                      )}
                    </>
                  )}

                  {/* Google Vision */}
                  {p.type === "google_vision" && (
                    <TextField label="Google Vision API Key" value={p.google_vision_key}
                      onChange={(v) => updateProvider(p.id, { google_vision_key: v })} type="password"
                      placeholder={p.has_google_vision_key ? "configured" : "Enter API key"} />
                  )}

                  {/* Test connection button */}
                  <div className="pt-2 border-t">
                    <button
                      onClick={async () => {
                        setTestingId(p.id);
                        setTestResults((r) => { const copy = { ...r }; delete copy[p.id]; return copy; });
                        try {
                          const res = await api.post("/settings/test-ocr-provider", { provider_id: p.id });
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
        <div className="relative group">
          <button className="flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
            <Plus className="h-4 w-4" /> Add Provider
          </button>
          <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-10 rounded-lg border bg-popover p-1.5 shadow-lg min-w-[220px]">
            {OCR_TYPES.map((t) => (
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

// ==========================
// Pipeline Tab
// ==========================

function PipelineTab() {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { saving, saved, save } = useSettingsSave();
  const [failedDocs, setFailedDocs] = useState<any[]>([]);
  const [retryingAll, setRetryingAll] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<any>(null);
  const [startingPipeline, setStartingPipeline] = useState(false);

  const loadStatus = () => {
    api.get("/pipeline/status").then((res) => setPipelineStatus(res.data)).catch(() => {});
  };

  useEffect(() => {
    api.get("/settings").then((res) => {
      setS(res.data);
      setF({
        pipeline_watch_enabled: res.data.pipeline.watch_enabled,
        pipeline_poll_interval: res.data.pipeline.poll_interval_seconds,
        pipeline_retry_interval: res.data.pipeline.retry_interval_seconds,
        pipeline_max_retries: res.data.pipeline.max_retries,
        session_ttl_hours: res.data.auth.session_ttl_hours,
      });
    });
    loadFailed();
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadFailed = () => {
    api.get("/documents/failed").then((res) => setFailedDocs(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  };

  const retryDoc = async (docId: number) => {
    await api.post(`/documents/${docId}/reprocess`);
    loadFailed();
  };

  const retryAllFailed = async () => {
    setRetryingAll(true);
    try {
      await api.post("/documents/retry-all-failed");
      setTimeout(loadFailed, 2000);
    } catch { alert("Failed to retry"); }
    setRetryingAll(false);
  };

  const deleteDoc = async (docId: number) => {
    if (!confirm("Delete this document permanently?")) return;
    await api.delete(`/documents/${docId}`);
    loadFailed();
  };

  if (!s) return <div className="text-muted-foreground">Loading...</div>;

  const restartPipeline = async () => {
    setStartingPipeline(true);
    try {
      await api.post("/pipeline/start");
      setTimeout(loadStatus, 1000);
    } catch { alert("Failed to start pipeline"); }
    setStartingPipeline(false);
  };

  return (
    <div className="space-y-6">
      {/* Auto-stop warning banner */}
      {pipelineStatus?.auto_stopped && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-300">Pipeline automatically paused</p>
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
              {pipelineStatus.auto_stop_reason || "All providers appear unreachable after consecutive failures."}
              {" "}Check your provider settings and restart when ready.
            </p>
          </div>
          <button onClick={restartPipeline} disabled={startingPipeline}
            className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 flex-shrink-0">
            {startingPipeline ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Restart
          </button>
        </div>
      )}

      {/* Pipeline status indicator */}
      {pipelineStatus && (
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                pipelineStatus.watcher_active ? "bg-green-500 animate-pulse" : "bg-gray-400"
              }`} />
              <span className="text-sm font-medium">
                {pipelineStatus.watcher_active ? "Pipeline active" : "Pipeline stopped"}
              </span>
              {pipelineStatus.processing && (
                <span className="text-xs text-muted-foreground">
                  Processing: {pipelineStatus.processing} ({pipelineStatus.processing_step})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Processed: {pipelineStatus.total_processed}</span>
              {pipelineStatus.total_errors > 0 && (
                <span className="text-red-500">Errors: {pipelineStatus.total_errors}</span>
              )}
            </div>
          </div>
        </div>
      )}

      <SettingsForm title="Automatic Document Processing" saving={saving} saved={saved}
        onSave={() => save({
          pipeline_watch_enabled: f.pipeline_watch_enabled !== s.pipeline.watch_enabled ? f.pipeline_watch_enabled : undefined,
          pipeline_poll_interval: f.pipeline_poll_interval !== s.pipeline.poll_interval_seconds ? f.pipeline_poll_interval : undefined,
          pipeline_retry_interval: f.pipeline_retry_interval !== s.pipeline.retry_interval_seconds ? f.pipeline_retry_interval : undefined,
          pipeline_max_retries: f.pipeline_max_retries !== s.pipeline.max_retries ? f.pipeline_max_retries : undefined,
          session_ttl_hours: f.session_ttl_hours !== s.auth.session_ttl_hours ? f.session_ttl_hours : undefined,
        })}>
        <ToggleField label="Automatic Document Processing" value={f.pipeline_watch_enabled}
          onChange={(v) => setF({ ...f, pipeline_watch_enabled: v })}
          description="Automatically process new files dropped into the inbox folder" />
        <NumberField label="Poll Interval (seconds)" value={f.pipeline_poll_interval}
          onChange={(v) => setF({ ...f, pipeline_poll_interval: v })} min={1} max={60} step={1} />
        <NumberField label="Retry Interval (seconds)" value={f.pipeline_retry_interval}
          onChange={(v) => setF({ ...f, pipeline_retry_interval: v })} min={60} max={3600} step={60} />
        <NumberField label="Max Retries" value={f.pipeline_max_retries}
          onChange={(v) => setF({ ...f, pipeline_max_retries: v })} min={0} max={10} step={1} />
        <NumberField label="Session TTL (hours)" value={f.session_ttl_hours}
          onChange={(v) => setF({ ...f, session_ttl_hours: v })} min={1} max={8760} step={1} />
      </SettingsForm>

      {/* Failed Documents Queue */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            Failed Documents
            {failedDocs.length > 0 && (
              <span className="ml-2 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                {failedDocs.length}
              </span>
            )}
          </h3>
          <div className="flex gap-2">
            <button onClick={loadFailed} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              Refresh
            </button>
            {failedDocs.length > 0 && (
              <button onClick={retryAllFailed} disabled={retryingAll}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                <RotateCcw className="h-3 w-3" /> {retryingAll ? "Retrying..." : "Retry All"}
              </button>
            )}
          </div>
        </div>

        {failedDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No failed documents. All good!</p>
        ) : (
          <div className="rounded-lg border divide-y max-h-[400px] overflow-y-auto">
            {failedDocs.map((doc) => (
              <div key={doc.id} className="p-3 space-y-1.5 hover:bg-accent/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">{doc.original_filename}</span>
                    {doc.patient_name && (
                      <span className="text-xs text-muted-foreground">({doc.patient_name})</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      doc.status === "failed"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    }`}>
                      {doc.status}
                    </span>
                    {doc.retry_count > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {doc.retry_count} retries
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => retryDoc(doc.id)}
                      className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                      <RotateCcw className="h-3 w-3" /> Retry
                    </button>
                    <button onClick={() => deleteDoc(doc.id)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {doc.error_message && (
                  <div className="rounded-md bg-red-50 dark:bg-red-900/10 px-3 py-2 text-xs text-red-700 dark:text-red-400 font-mono break-all">
                    {doc.error_message}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  Last attempt: {doc.updated_at?.replace("T", " ").slice(0, 19)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================
// OIDC Tab
// ==========================

function OidcTab() {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { saving, saved, save } = useSettingsSave();

  useEffect(() => {
    api.get("/settings").then((res) => {
      setS(res.data);
      setF({
        oidc_enabled: res.data.oidc.enabled,
        oidc_provider_url: res.data.oidc.provider_url || "",
        oidc_client_id: res.data.oidc.client_id || "",
        oidc_client_secret: "",
        oidc_scopes: res.data.oidc.scopes || "openid profile email",
        oidc_auto_create_user: res.data.oidc.auto_create_user,
        oidc_username_claim: res.data.oidc.username_claim || "preferred_username",
        oidc_display_name_claim: res.data.oidc.display_name_claim || "name",
      });
    });
  }, []);

  if (!s) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <SettingsForm title="OIDC / SSO (Authentik, Keycloak, etc.)" saving={saving} saved={saved}
      onSave={() => save({
        oidc_enabled: f.oidc_enabled !== s.oidc.enabled ? f.oidc_enabled : undefined,
        oidc_provider_url: f.oidc_provider_url !== (s.oidc.provider_url || "") ? f.oidc_provider_url : undefined,
        oidc_client_id: f.oidc_client_id !== (s.oidc.client_id || "") ? f.oidc_client_id : undefined,
        oidc_client_secret: f.oidc_client_secret || undefined,
        oidc_scopes: f.oidc_scopes !== (s.oidc.scopes || "") ? f.oidc_scopes : undefined,
        oidc_auto_create_user: f.oidc_auto_create_user !== s.oidc.auto_create_user ? f.oidc_auto_create_user : undefined,
        oidc_username_claim: f.oidc_username_claim !== (s.oidc.username_claim || "") ? f.oidc_username_claim : undefined,
        oidc_display_name_claim: f.oidc_display_name_claim !== (s.oidc.display_name_claim || "") ? f.oidc_display_name_claim : undefined,
      })}>
      <ToggleField label="Enable OIDC" value={f.oidc_enabled} onChange={(v) => setF({ ...f, oidc_enabled: v })}
        description="Show 'Sign in with SSO' on the login page" />
      <TextField label="Provider URL" value={f.oidc_provider_url} onChange={(v) => setF({ ...f, oidc_provider_url: v })}
        placeholder="https://auth.example.com/application/o/asclepius/" />
      <TextField label="Client ID" value={f.oidc_client_id} onChange={(v) => setF({ ...f, oidc_client_id: v })} />
      <TextField label="Client Secret" value={f.oidc_client_secret} onChange={(v) => setF({ ...f, oidc_client_secret: v })}
        type="password" placeholder={s.oidc.has_client_secret ? "configured" : "Not set"} />
      <TextField label="Scopes" value={f.oidc_scopes} onChange={(v) => setF({ ...f, oidc_scopes: v })} />
      <ToggleField label="Auto-create Users" value={f.oidc_auto_create_user}
        onChange={(v) => setF({ ...f, oidc_auto_create_user: v })}
        description="Create a local user on first OIDC login" />
      <TextField label="Username Claim" value={f.oidc_username_claim}
        onChange={(v) => setF({ ...f, oidc_username_claim: v })} placeholder="preferred_username" />
      <TextField label="Display Name Claim" value={f.oidc_display_name_claim}
        onChange={(v) => setF({ ...f, oidc_display_name_claim: v })} placeholder="name" />
    </SettingsForm>
  );
}

// ==========================
// Users Tab
// ==========================

function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", display_name: "", role: "editor" });
  const [patients, setPatients] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [auditTotal, setAuditTotal] = useState(0);

  useEffect(() => {
    api.get("/settings/users").then((res) => setUsers(res.data)).catch(() => {});
    api.get("/patients").then((res) => setPatients(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  }, []);

  const loadAuditLog = async () => {
    try {
      const res = await api.get("/settings/audit-log", { params: { limit: 100 } });
      setAuditLog(res.data.items || []);
      setAuditTotal(res.data.total || 0);
    } catch { setAuditLog([]); }
  };

  const createUser = async () => {
    await api.post("/settings/users", newUser);
    setNewUser({ username: "", password: "", display_name: "", role: "editor" });
    setShowCreate(false);
    const res = await api.get("/settings/users");
    setUsers(res.data);
  };

  const deleteUser = async (id: number) => {
    if (!confirm("Delete this user?")) return;
    await api.delete(`/settings/users/${id}`);
    setUsers(users.filter((u) => u.id !== id));
  };

  const updateRole = async (userId: number, role: string) => {
    await api.patch(`/settings/users/${userId}`, { role });
    setUsers(users.map((u) => u.id === userId ? { ...u, role } : u));
  };

  const grantAccess = async (userId: number, patientId: number) => {
    await api.post(`/settings/users/${userId}/access`, { patient_id: patientId, role: "viewer" });
  };

  const roleColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      case "editor": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "viewer": return "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">User Management</h3>
        <div className="flex gap-2">
          <button onClick={() => { setShowAudit(!showAudit); if (!showAudit) loadAuditLog(); }}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            <ScrollText className="h-4 w-4" /> {showAudit ? "Hide Audit Log" : "Audit Log"}
          </button>
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add User
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="rounded-lg border p-4 space-y-3 max-w-md">
          <input type="text" placeholder="Username" value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input type="password" placeholder="Password" value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input type="text" placeholder="Display Name" value={newUser.display_name}
            onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm">
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button onClick={createUser} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Create</button>
        </div>
      )}

      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
        <p><strong>Admin:</strong> Full access — settings, user management, all patients.</p>
        <p><strong>Editor:</strong> Can view/edit documents and patients they have access to.</p>
        <p><strong>Viewer:</strong> Read-only access to assigned patients.</p>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Username</th>
              <th className="px-4 py-2 text-left font-medium">Display Name</th>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-left font-medium">Created</th>
              <th className="px-4 py-2 text-left font-medium">Grant Access</th>
              <th className="px-4 py-2 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium">{u.username}</td>
                <td className="px-4 py-2">{u.display_name}</td>
                <td className="px-4 py-2">
                  <select value={u.role || "editor"}
                    onChange={(e) => updateRole(u.id, e.target.value)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium border-0 cursor-pointer ${roleColor(u.role || "editor")}`}>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{u.created_at?.split("T")[0]}</td>
                <td className="px-4 py-2">
                  <select className="rounded border bg-background px-2 py-1 text-xs" defaultValue=""
                    onChange={(e) => { if (e.target.value) grantAccess(u.id, Number(e.target.value)); e.target.value = ""; }}>
                    <option value="">Grant patient...</option>
                    {patients.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <button onClick={() => deleteUser(u.id)} className="rounded p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Audit Log */}
      {showAudit && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Audit Log</h3>
            <span className="text-xs text-muted-foreground">{auditTotal} total entries</span>
          </div>
          <div className="rounded-lg border max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Time</th>
                  <th className="px-3 py-2 text-left font-medium">User</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                  <th className="px-3 py-2 text-left font-medium">Resource</th>
                  <th className="px-3 py-2 text-left font-medium">Details</th>
                  <th className="px-3 py-2 text-left font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {auditLog.length === 0 ? (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No audit log entries</td></tr>
                ) : auditLog.map((entry) => (
                  <tr key={entry.id} className="hover:bg-accent/20">
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{entry.created_at?.replace("T", " ").slice(0, 19)}</td>
                    <td className="px-3 py-1.5 font-medium">{entry.username || `#${entry.user_id}`}</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{entry.action}</span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {entry.resource_type && `${entry.resource_type}`}
                      {entry.resource_id && ` #${entry.resource_id}`}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground max-w-[200px] truncate">{entry.details}</td>
                    <td className="px-3 py-1.5 text-muted-foreground font-mono">{entry.ip_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================
// Prompts Tab
// ==========================

function PromptsTab() {
  const [prompts, setPrompts] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get("/settings/prompts").then((res) => setPrompts(res.data || []));
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      await api.put(`/settings/prompts/${key}`, { text: editText });
      setEditing(null);
      load();
    } catch { alert("Failed to save prompt"); }
    setSaving(false);
  };

  const handleReset = async (key: string) => {
    if (!confirm("Reset this prompt to the default? Your customization will be lost.")) return;
    try {
      await api.delete(`/settings/prompts/${key}`);
      setEditing(null);
      load();
    } catch { alert("Failed to reset"); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        Customize the LLM prompts used for document classification, extraction, chat, and more.
        Prompts use Python format strings with placeholders like {"{ocr_text}"}, {"{patient_list}"}, etc.
        Click a prompt to edit it. Reset to revert to the default.
      </div>
      {prompts.map((p) => (
        <div key={p.key} className="rounded-lg border">
          <div
            className="flex items-center justify-between p-3 cursor-pointer hover:bg-accent/30"
            onClick={() => {
              if (editing === p.key) { setEditing(null); }
              else { setEditing(p.key); setEditText(p.text); }
            }}
          >
            <div>
              <span className="text-sm font-medium">{p.key.replace(/_/g, " ")}</span>
              {p.is_custom && (
                <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">customized</span>
              )}
              <p className="text-xs text-muted-foreground">{p.description}</p>
            </div>
            <span className="text-xs text-muted-foreground">{p.text?.length || 0} chars</span>
          </div>
          {editing === p.key && (
            <div className="border-t p-3 space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono min-h-[200px]"
                disabled={saving}
              />
              <div className="flex gap-2">
                <button onClick={() => handleSave(p.key)} disabled={saving}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
                  <Save className="h-3 w-3" /> {saving ? "Saving..." : "Save"}
                </button>
                {p.is_custom && (
                  <button onClick={() => handleReset(p.key)}
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
                    <RotateCcw className="h-3 w-3" /> Reset to default
                  </button>
                )}
                <button onClick={() => setEditing(null)} className="rounded-md border px-3 py-1.5 text-xs">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ==========================
// Logs Tab
// ==========================

function LogsTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [total, setTotal] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(() => {
    const params: Record<string, any> = { limit: 500 };
    if (levelFilter) params.level = levelFilter;
    if (moduleFilter) params.module = moduleFilter;
    api.get("/settings/logs", { params })
      .then((res) => { setLogs(res.data.logs || []); setTotal(res.data.total || 0); })
      .catch(() => {});
  }, [levelFilter, moduleFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const levelColor = (level: string) => {
    switch (level) {
      case "ERROR": return "text-red-500";
      case "WARNING": return "text-yellow-500";
      case "DEBUG": return "text-muted-foreground/60";
      default: return "text-foreground";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-xs">
          <option value="">All levels</option>
          <option value="ERROR">Errors only</option>
          <option value="WARNING,ERROR">Warnings + Errors</option>
          <option value="INFO">Info only</option>
          <option value="DEBUG">Debug</option>
        </select>
        <input type="text" placeholder="Filter by module..." value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-xs w-48" />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh (3s)
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
        <button onClick={fetchLogs} className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent">
          Refresh
        </button>
        <span className="text-xs text-muted-foreground ml-auto">{total} total log entries</span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div ref={scrollRef} className="max-h-[600px] overflow-y-auto font-mono text-[11px] leading-5 bg-black/5 dark:bg-white/5">
          {logs.length === 0 ? (
            <p className="p-4 text-muted-foreground text-center">No logs found</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`flex gap-2 px-3 py-0.5 border-b border-border/30 hover:bg-accent/30 ${levelColor(log.level)}`}>
                <span className="text-muted-foreground/70 flex-shrink-0 w-[140px]">{log.ts}</span>
                <span className={`flex-shrink-0 w-[55px] font-bold ${levelColor(log.level)}`}>{log.level}</span>
                <span className="text-muted-foreground/70 flex-shrink-0 w-[200px] truncate">{log.module}</span>
                <span className="flex-1 break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================
// Backup Tab
// ==========================

function BackupTab() {
  const [downloading, setDownloading] = useState(false);

  const handleBackup = async () => {
    setDownloading(true);
    try {
      const response = await api.get("/settings/backup", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const filename = response.headers["content-disposition"]
        ?.split("filename=")[1]?.replace(/"/g, "")
        || `asclepius_backup_${new Date().toISOString().slice(0, 10)}.sqlite`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("Backup failed");
    }
    setDownloading(false);
  };

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <h3 className="font-medium">Database Backup</h3>
      <p className="text-sm text-muted-foreground">
        Download a consistent snapshot of the SQLite database. This includes all documents metadata,
        patients, events, normalization mappings, and settings — everything except the actual files
        in the vault.
      </p>
      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
        <p>The backup uses SQLite's built-in backup API, so it's safe to download while the server is running.</p>
        <p>To do a full backup, also copy the <code>vault/</code> directory (contains the actual PDF/DICOM files).</p>
      </div>
      <button
        onClick={handleBackup}
        disabled={downloading}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {downloading ? "Downloading..." : "Download Database Backup"}
      </button>
    </div>
  );
}

// ==========================
// Normalization Tab
// ==========================

function NormalizationTab() {
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
    api.get(`/normalization/${normType}`, { params }).then((res) => {
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
        <select value={normType} onChange={(e) => { setNormType(e.target.value); setExpandedId(null); setDetail(null); }}
          className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="lab_tests">Lab Tests</option>
          <option value="specialties">Specialties</option>
          <option value="diagnoses">Diagnoses</option>
          <option value="medications">Medications</option>
        </select>
        <select value={normFilter || ""} onChange={(e) => setNormFilter(e.target.value || null)}
          className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">All</option>
          <option value="unreviewed">Unreviewed only</option>
        </select>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" value={searchInput} onChange={(e) => handleSearchInput(e.target.value)}
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
            ) : normItems.map((item) => (
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
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
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
                    <td colSpan={5} className="px-6 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">Merge <strong>{item.canonical_display}</strong> into:</span>
                        <select value={mergeTargetId ?? ""} onChange={(e) => setMergeTargetId(Number(e.target.value) || null)}
                          className="rounded-md border bg-background px-2 py-1 text-sm max-w-xs">
                          <option value="">Select target...</option>
                          {normItems.filter((n) => n.id !== item.id).map((n) => (
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
                    <td colSpan={5} className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
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
                                  <input type="text" value={editCode} onChange={(e) => setEditCode(e.target.value)}
                                    className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm font-mono" />
                                </label>
                                <label className="space-y-1">
                                  <span className="text-xs text-muted-foreground">Display Name</span>
                                  <input type="text" value={editDisplay} onChange={(e) => setEditDisplay(e.target.value)}
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
                              <input type="text" value={newAlias} onChange={(e) => setNewAlias(e.target.value)}
                                placeholder="e.g. Emocromo, CBC, ..."
                                onKeyDown={(e) => e.key === "Enter" && handleAddAlias()}
                                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm" />
                            </label>
                            <label className="space-y-1 w-20">
                              <span className="text-xs text-muted-foreground">Lang</span>
                              <input type="text" value={newAliasLang} onChange={(e) => setNewAliasLang(e.target.value)}
                                placeholder="en"
                                onKeyDown={(e) => e.key === "Enter" && handleAddAlias()}
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
