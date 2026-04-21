import { useEffect, useState } from "react";
import api from "@/api/client";
import {
  Eye, Plus, Trash2, Save, Check, Power,
  ChevronUp, ChevronDown, X, Zap, Loader2,
} from "lucide-react";
import { TextField, NumberField, SelectField } from "./SettingsFormHelpers";
import type { OcrProvider } from "@/types";
import { useToast } from "@/contexts/ToastContext";

export const OCR_TYPES = [
  { value: "tesseract", label: "Tesseract (Local)", description: "Local Tesseract OCR engine" },
  { value: "tesseract_remote", label: "Tesseract (Remote)", description: "Remote Tesseract OCR server" },
  { value: "llm_vision", label: "LLM Vision", description: "Send page images to an LLM for OCR" },
  { value: "vision_extraction", label: "Vision Extraction", description: "Single-step: vision LLM reads and extracts in one pass" },
  { value: "google_vision", label: "Google Cloud Vision", description: "Google Cloud Vision API" },
];

const LLM_VISION_PROVIDERS = [
  { value: "ollama", label: "Ollama" },
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
];

export default function OcrProvidersTab() {
  const { toast } = useToast();
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
    } catch { toast({ title: "Failed to save OCR providers", variant: "error" }); }
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
                  {(p.type === "llm_vision" || p.type === "vision_extraction") && (
                    <>
                      <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-3 text-xs text-blue-700 dark:text-blue-300">
                        {p.type === "vision_extraction"
                          ? "Vision Extraction sends page images directly to a vision LLM which reads the document AND extracts structured data in one step. No separate OCR or extraction LLM needed."
                          : "Vision OCR sends page images to an LLM for text extraction. This can use a different provider/model than your extraction LLM (e.g. Chandra for OCR + llama3.1 for extraction)."}
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
                          const res = await api.post("/settings/test-ocr-provider", { provider: p });
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
