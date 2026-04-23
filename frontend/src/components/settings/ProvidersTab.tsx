import { useEffect, useMemo, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";
import type { Credential, LlmProvider, OcrProvider, VisionLlmProvider } from "@/types";
import CredentialDialog from "./providers/CredentialDialog";
import CredentialCard, { modelKey } from "./providers/CredentialCard";
import type { AttachedModel, ModelKind } from "./providers/types";

export default function ProvidersTab() {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [llm, setLlm] = useState<LlmProvider[]>([]);
  const [vision, setVision] = useState<VisionLlmProvider[]>([]);
  const [ocr, setOcr] = useState<OcrProvider[]>([]);
  const [editingCred, setEditingCred] = useState<Partial<Credential> | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [editingModelKey, setEditingModelKey] = useState<string | null>(null);
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

  useEffect(() => {
    reloadAll();
  }, []);

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
      // Prefer the user-chosen display name over the raw model string so
      // renaming "fredrezones55/chandra-ocr-2" to "Chandra" actually sticks.
      const label =
        p.type === "llm_vision" ? (p.name || p.llm_model || "LLM vision OCR")
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
    } finally {
      setBusy(false);
    }
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
    } finally {
      setBusy(false);
    }
  };

  // ── Attached model CRUD ──────────────────────────────────────
  const addModel = async (cred: Credential, kind: ModelKind, name: string, model: string, timeout: number) => {
    const displayName = name || model || cred.name;
    if (kind === "llm") {
      const entry: LlmProvider = {
        id: `llm-${Date.now()}`, type: cred.type, name: displayName,
        enabled: true, priority: llm.length + 1, credential_id: cred.id,
        base_url: "", model, api_key: "", timeout,
      };
      await api.put("/settings/llm-providers", [...llm, entry]);
    } else if (kind === "vision") {
      const entry: VisionLlmProvider = {
        id: `vision-${Date.now()}`, type: cred.type, name: displayName,
        enabled: true, priority: vision.length + 1, credential_id: cred.id,
        base_url: "", model, api_key: "", timeout,
      };
      await api.put("/settings/vision-providers", [...vision, entry]);
    } else {
      const ocrType =
        cred.type === "google_vision" ? "google_vision"
        : cred.type === "tesseract_remote" ? "tesseract_remote"
        : "llm_vision";
      const entry: OcrProvider = {
        id: `ocr-${Date.now()}`, type: ocrType, name: displayName,
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

  const editModel = async (m: AttachedModel, name: string, model: string, timeout: number) => {
    const displayName = name || model || "Model";
    if (m.kind === "llm") {
      const next = llm.map((p) =>
        p.id === m.entry_id ? { ...p, name: displayName, model, timeout } : p,
      );
      await api.put("/settings/llm-providers", next);
    } else if (m.kind === "vision") {
      const next = vision.map((p) =>
        p.id === m.entry_id ? { ...p, name: displayName, model, timeout } : p,
      );
      await api.put("/settings/vision-providers", next);
    } else {
      const next = ocr.map((p) => {
        if (p.id !== m.entry_id) return p;
        return {
          ...p,
          name: displayName,
          llm_model: p.type === "llm_vision" ? model : p.llm_model,
        };
      });
      await api.put("/settings/ocr-providers", next);
    }
    await reloadAll();
    setEditingModelKey(null);
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

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        A <strong>provider</strong> is a connection (credentials + concurrency +
        retry policy). Under each provider, list the models it exposes -
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
        {credentials.map((c) => (
          <CredentialCard
            key={c.id}
            credential={c}
            models={attachedByCred.get(c.id) || []}
            isAddingModel={addingTo === c.id}
            editingModelKey={editingModelKey}
            busy={busy}
            onEditCredential={() => setEditingCred(c)}
            onDeleteCredential={() => handleDeleteCredential(c.id)}
            onStartAddModel={() => { setAddingTo(c.id); setEditingModelKey(null); }}
            onCancelAddModel={() => setAddingTo(null)}
            onAddModel={(kind, name, model, timeout) => addModel(c, kind, name, model, timeout)}
            onStartEditModel={(key) => { setEditingModelKey(key); setAddingTo(null); }}
            onCancelEditModel={() => setEditingModelKey(null)}
            onSaveEditModel={editModel}
            onToggleModel={toggleModel}
            onRemoveModel={removeModel}
          />
        ))}
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

// Keep the modelKey helper exposed for any callers that imported it.
export { modelKey };
