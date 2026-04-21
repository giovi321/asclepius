import { useEffect, useState } from "react";
import api from "@/api/client";
import { Save, Check, AlertTriangle } from "lucide-react";
import { TextField, NumberField } from "./SettingsFormHelpers";
import CredentialPicker from "./CredentialPicker";
import type { Credential, GeneralLlmSettings } from "@/types";
import { useToast } from "@/contexts/ToastContext";

const GENERAL_ALLOWED_CRED_TYPES = ["ollama", "vllm", "claude", "openai"];

export default function GeneralLlmTab() {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [settings, setSettings] = useState<GeneralLlmSettings>({
    credential_id: "",
    type: "ollama",
    model: "",
    timeout: 120,
    max_concurrent: 2,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/settings/credentials").then((res) => {
      setCredentials(Array.isArray(res.data) ? res.data : []);
    });
    api.get("/settings/general-llm").then((res) => {
      if (res.data) setSettings((s) => ({ ...s, ...res.data }));
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/general-llm", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      toast({
        title: "Failed to save General LLM settings",
        description: e?.response?.data?.detail || e?.message || "",
        variant: "error",
      });
    }
    setSaving(false);
  };

  const chosenCred = credentials.find((c) => c.id === settings.credential_id);
  const isConfigured = !!settings.credential_id && !!settings.model;

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        The <strong>General LLM</strong> is used for everything that is
        <em> not</em> the main document-analysis pipeline: chat, auto-rename,
        auto-merge, link suggestions, event extraction, and document-edit AI.
        One model, no priority list — pick whichever model handles short,
        interactive tasks best.
      </div>

      {!isConfigured && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            General LLM is not configured. Chat, auto-merge, auto-rename and
            other AI actions outside the main pipeline will return 503 until
            you pick a credential and model below.
          </span>
        </div>
      )}

      <div className="rounded-lg border p-4 space-y-4 max-w-lg">
        <CredentialPicker
          label="Credential"
          value={settings.credential_id}
          onChange={(id) => {
            const chosen = credentials.find((c) => c.id === id);
            setSettings((s) => ({
              ...s,
              credential_id: id,
              type: chosen?.type || s.type,
            }));
          }}
          credentials={credentials}
          allowedTypes={GENERAL_ALLOWED_CRED_TYPES}
          description="The connection used for general-purpose calls. Edit credentials in the Credentials tab."
        />

        <TextField
          label="Model"
          value={settings.model}
          onChange={(v) => setSettings((s) => ({ ...s, model: v }))}
          placeholder={
            chosenCred?.type === "ollama" ? "e.g. llama3.1" :
            chosenCred?.type === "claude" ? "e.g. claude-sonnet-4-20250514" :
            chosenCred?.type === "openai" ? "e.g. gpt-4o" :
            "Model name"
          }
        />

        <NumberField
          label="Max parallel requests"
          value={settings.max_concurrent}
          onChange={(v) => setSettings((s) => ({ ...s, max_concurrent: Math.max(1, v) }))}
          min={1} max={32} step={1}
          description="How many general-LLM requests may run at once. Requests beyond this queue and show up in the top bar."
        />

        <NumberField
          label="Timeout (seconds)"
          value={settings.timeout}
          onChange={(v) => setSettings((s) => ({ ...s, timeout: Math.max(10, v) }))}
          min={10} max={1800} step={30}
          description="Per-call timeout."
        />

        <div className="flex items-center justify-end pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? "Saved" : saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
