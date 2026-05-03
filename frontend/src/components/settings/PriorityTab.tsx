import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import {
  Brain,
  Eye,
  ScanText,
  ChevronUp,
  ChevronDown,
  Save,
  Check,
  Sparkles,
  Power,
  AlertTriangle,
  Languages,
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import type {
  Credential,
  LlmProvider,
  OcrProvider,
  VisionLlmProvider,
  GeneralLlmSettings,
} from "@/types";
import {
  useCredentials,
  useLlmProviders,
  useVisionProviders,
  useOcrProviders,
} from "@/hooks/data";

// ─── Generic priority section ─────────────────────────────────────

type AnyEntry = {
  id: string;
  name?: string;
  model?: string;
  enabled: boolean;
  priority: number;
  credential_id?: string;
  type?: string;
};

interface SectionProps<T extends AnyEntry> {
  title: string;
  icon: any;
  items: T[];
  credentials: Credential[];
  describe: (item: T) => string; // secondary line (e.g. model name)
  onReorder: (next: T[]) => Promise<void>;
  onToggle: (id: string) => Promise<void>;
  emptyMessage: string;
}

function PrioritySection<T extends AnyEntry>({
  title,
  icon: Icon,
  items,
  credentials,
  describe,
  onReorder,
  onToggle,
  emptyMessage,
}: SectionProps<T>) {
  const move = async (idx: number, dir: "up" | "down") => {
    const copy = [...items];
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= copy.length) return;
    [copy[idx], copy[swap]] = [copy[swap], copy[idx]];
    const rePriority = copy.map((p, i) => ({ ...p, priority: i + 1 }));
    await onReorder(rePriority);
  };

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">
          ({items.filter((i) => i.enabled).length}/{items.length} enabled)
        </span>
      </div>
      <div className="p-2 space-y-1">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground italic px-2 py-3 text-center">
            {emptyMessage}
          </div>
        )}
        {items.map((p, idx) => {
          const cred = credentials.find((c) => c.id === p.credential_id);
          return (
            <div
              key={p.id}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${p.enabled ? "" : "opacity-60"}`}
            >
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => move(idx, "up")}
                  disabled={idx === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(idx, "down")}
                  disabled={idx === items.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex-shrink-0">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate font-medium">
                    {p.name || p.model || "Untitled"}
                  </span>
                  {cred && (
                    <span className="text-xs text-muted-foreground truncate">
                      via {cred.name}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {describe(p)}
                </div>
              </div>
              <button
                onClick={() => onToggle(p.id)}
                title={
                  p.enabled
                    ? "Enabled — click to disable"
                    : "Disabled — click to enable"
                }
                className={`rounded-md p-1.5 transition-colors ${p.enabled ? "text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" : "text-muted-foreground hover:bg-accent"}`}
              >
                <Power className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── General LLM card ─────────────────────────────────────────────

const GENERAL_ALLOWED_CRED_TYPES = ["ollama", "vllm", "claude", "openai"];

function GeneralLlmCard({
  credentials,
  llm,
}: {
  credentials: Credential[];
  llm: LlmProvider[];
}) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<GeneralLlmSettings>({
    credential_id: "",
    type: "ollama",
    model: "",
    timeout: 120,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get("/settings/general-llm")
      .then((res) => {
        if (res.data) setSettings((s) => ({ ...s, ...res.data }));
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/general-llm", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      toast({
        title: "Failed to save General LLM",
        description: e?.response?.data?.detail || e?.message || "",
        variant: "error",
      });
    }
    setSaving(false);
  };

  const filteredCreds = credentials.filter((c) =>
    GENERAL_ALLOWED_CRED_TYPES.includes(c.type),
  );
  const chosen = credentials.find((c) => c.id === settings.credential_id);
  const isConfigured = !!settings.credential_id && !!settings.model;

  // Models available on the chosen credential (LLM kind only — General
  // runs chat / auto-merge / auto-rename which are text, not vision).
  const modelsForChosen = settings.credential_id
    ? llm.filter((p) => p.credential_id === settings.credential_id)
    : [];

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">General LLM</span>
        <span className="text-xs text-muted-foreground">
          — used for chat, auto-merge, auto-rename, link suggestions, event
          extraction, document-edit AI
        </span>
      </div>

      {!isConfigured && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Not configured — those features will return 503 until you pick a
            provider and model.
          </span>
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] items-end">
        <label className="space-y-1 block">
          <span className="text-xs font-medium">Provider</span>
          <select
            value={settings.credential_id}
            onChange={(e) => {
              const chosen = credentials.find((c) => c.id === e.target.value);
              setSettings((s) => ({
                ...s,
                credential_id: e.target.value,
                type: chosen?.type || s.type,
              }));
            }}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">— pick a provider —</option>
            {filteredCreds.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 block">
          <span className="text-xs font-medium">Model</span>
          <select
            value={settings.model}
            onChange={(e) =>
              setSettings((s) => ({ ...s, model: e.target.value }))
            }
            disabled={!settings.credential_id || modelsForChosen.length === 0}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="">
              {!settings.credential_id
                ? "— pick a provider first —"
                : modelsForChosen.length === 0
                  ? "— no LLM models on this provider —"
                  : "— pick a model —"}
            </option>
            {modelsForChosen.map((p) => (
              <option key={p.id} value={p.model}>
                {p.name && p.name !== p.model
                  ? `${p.name} (${p.model})`
                  : p.model}
              </option>
            ))}
          </select>
          {settings.credential_id && modelsForChosen.length === 0 && (
            <span className="block text-[11px] text-amber-600 dark:text-amber-500">
              Add an LLM model to this provider under{" "}
              <Link to="/settings/analysis/providers" className="underline">
                Providers
              </Link>
              .
            </span>
          )}
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
        >
          {saved ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saved ? "Saved" : saving ? "Saving…" : "Save"}
        </button>
      </div>

      {chosen && (
        <div className="text-xs text-muted-foreground">
          Inherits <strong>{chosen.max_concurrent}</strong> concurrent requests
          / <strong>{chosen.max_retries}</strong> retries from provider{" "}
          <Link to="/settings/analysis/providers" className="underline">
            {chosen.name}
          </Link>
          .
        </div>
      )}
    </div>
  );
}

// ─── Translation defaults card ────────────────────────────────────

function TranslationDefaultsCard({
  llm,
  ocr,
}: {
  llm: LlmProvider[];
  ocr: OcrProvider[];
}) {
  const { toast } = useToast();
  const [ocrId, setOcrId] = useState("");
  const [llmId, setLlmId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get("/settings/translation-defaults")
      .then((res) => {
        if (res.data) {
          setOcrId(res.data.ocr_provider_id || "");
          setLlmId(res.data.llm_provider_id || "");
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/translation-defaults", {
        ocr_provider_id: ocrId,
        llm_provider_id: llmId,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      toast({
        title: "Failed to save translation defaults",
        description: e?.response?.data?.detail || e?.message || "",
        variant: "error",
      });
    }
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Languages className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Translation defaults</span>
        <span className="text-xs text-muted-foreground">
          — used when admins or doctors translate a document or region
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] items-end">
        <label className="space-y-1 block">
          <span className="text-xs font-medium">OCR provider</span>
          <select
            value={ocrId}
            onChange={(e) => setOcrId(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">— first enabled —</option>
            {ocr.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 block">
          <span className="text-xs font-medium">LLM provider</span>
          <select
            value={llmId}
            onChange={(e) => setLlmId(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">— first enabled —</option>
            {llm.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
        >
          {saved ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saved ? "Saved" : saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          These providers are used for every translate action <em>unless</em>
          something more specific is set. From most-specific to least:
        </p>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>
            A one-off pick from the admin Translate dropdown on a document.
          </li>
          <li>The per-share preference saved when creating a doctor share.</li>
          <li>
            <strong>These settings</strong> — used whenever neither of the above
            applies.
          </li>
          <li>
            The first enabled entry in the priority list, as a final fallback.
          </li>
        </ol>
        <p>
          Set these to pin a specific OCR / LLM for translation across the
          board, without remembering to pick it every time.
        </p>
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────

export default function PriorityTab() {
  const { toast } = useToast();
  const {
    data: credData,
    error: credErr,
    refetch: refetchCred,
  } = useCredentials();
  const { data: llmData, refetch: refetchLlm } = useLlmProviders();
  const { data: visionData, refetch: refetchVision } = useVisionProviders();
  const { data: ocrData, refetch: refetchOcr } = useOcrProviders();
  const credentials: Credential[] = Array.isArray(credData) ? credData : [];
  const llm = useMemo(() => asSorted(llmData), [llmData]) as LlmProvider[];
  const vision = useMemo(
    () => asSorted(visionData),
    [visionData],
  ) as VisionLlmProvider[];
  const ocr = useMemo(() => asSorted(ocrData), [ocrData]) as OcrProvider[];

  useEffect(() => {
    if (credErr) toast({ title: "Failed to load routing", variant: "error" });
  }, [credErr, toast]);

  const reloadAll = async () => {
    await Promise.all([
      refetchCred(),
      refetchLlm(),
      refetchVision(),
      refetchOcr(),
    ]);
  };

  const persistLlm = async (next: LlmProvider[]) => {
    await api.put("/settings/llm-providers", next);
    await reloadAll();
  };
  const persistVision = async (next: VisionLlmProvider[]) => {
    await api.put("/settings/vision-providers", next);
    await reloadAll();
  };
  const persistOcr = async (next: OcrProvider[]) => {
    await api.put("/settings/ocr-providers", next);
    await reloadAll();
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        <strong>Priority</strong> controls which model is tried first for each
        task. Providers are defined under{" "}
        <Link to="/settings/analysis/providers" className="underline">
          Providers
        </Link>
        .
      </div>

      <GeneralLlmCard credentials={credentials} llm={llm} />

      <TranslationDefaultsCard llm={llm} ocr={ocr} />

      <PrioritySection
        title="LLM priority (document extraction, classification)"
        icon={Brain}
        items={llm}
        credentials={credentials}
        describe={(p) => p.model || ""}
        onReorder={persistLlm}
        onToggle={async (id) =>
          persistLlm(
            llm.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
          )
        }
        emptyMessage="No LLM models — add one under Providers."
      />

      <PrioritySection
        title="Vision-LLM priority (single-pass page extraction)"
        icon={Eye}
        items={vision}
        credentials={credentials}
        describe={(p) => p.model || ""}
        onReorder={persistVision}
        onToggle={async (id) =>
          persistVision(
            vision.map((p) =>
              p.id === id ? { ...p, enabled: !p.enabled } : p,
            ),
          )
        }
        emptyMessage="No Vision-LLM models configured."
      />

      <PrioritySection
        title="OCR priority"
        icon={ScanText}
        items={ocr}
        credentials={credentials}
        describe={(p) =>
          p.type === "llm_vision" ? `llm_vision · ${p.llm_model || ""}` : p.type
        }
        onReorder={persistOcr}
        onToggle={async (id) =>
          persistOcr(
            ocr.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
          )
        }
        emptyMessage="No OCR engines configured."
      />
    </div>
  );
}

function asSorted<T extends AnyEntry>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return ([...data] as T[]).sort(
    (a, b) => (a.priority || 0) - (b.priority || 0),
  );
}
