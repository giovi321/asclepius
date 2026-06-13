import { useMemo, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import api from "@/api/client";
import {
  useLlmProviders,
  useOcrProviders,
  useVisionProviders,
} from "@/hooks/data";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";

export interface ReprocessMenuProps {
  docId: number | string;
  /** Optional gate: return false to cancel the reprocess (e.g. after a confirm dialog). */
  onBeforeReprocess?: () => Promise<boolean> | boolean;
  onReprocessed: () => Promise<void> | void;
}

interface Provider {
  id: string;
  name?: string | null;
  enabled: boolean;
}

/**
 * "Reprocess" button + dropdown on the Document Detail header. Owns its
 * own menu-open state so the parent page doesn't have to babysit it.
 */
export default function ReprocessMenu({
  docId,
  onBeforeReprocess,
  onReprocessed,
}: ReprocessMenuProps) {
  const [open, setOpen] = useState(false);
  const { data: llmAll } = useLlmProviders();
  const { data: ocrAll } = useOcrProviders();
  const { data: visionAll } = useVisionProviders();
  const llmProviders: Provider[] = useMemo(
    () =>
      (Array.isArray(llmAll) ? llmAll : []).filter((p: Provider) => p.enabled),
    [llmAll],
  );
  const ocrProviders: Provider[] = useMemo(
    () =>
      (Array.isArray(ocrAll) ? ocrAll : []).filter((p: Provider) => p.enabled),
    [ocrAll],
  );
  const visionProviders: Provider[] = useMemo(
    () =>
      (Array.isArray(visionAll) ? visionAll : []).filter(
        (p: Provider) => p.enabled,
      ),
    [visionAll],
  );
  const [mode, setMode] = useState("both");
  const [llmId, setLlmId] = useState("");
  const [ocrId, setOcrId] = useState("");
  const [visionId, setVisionId] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useOnClickOutside(ref, () => setOpen(false), open);

  const handleStart = async () => {
    if (onBeforeReprocess) {
      const go = await onBeforeReprocess();
      if (!go) return;
    }
    setOpen(false);
    await api.post(`/documents/${docId}/reprocess`, {
      mode,
      ...(llmId ? { llm_provider_id: llmId } : {}),
      ...(ocrId ? { ocr_provider_id: ocrId } : {}),
      ...(visionId ? { vision_provider_id: visionId } : {}),
    });
    await onReprocessed();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
      >
        <RefreshCw className="h-4 w-4" /> Reprocess{" "}
        <ChevronDown className="h-3 w-3 ml-0.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded-lg border bg-background shadow-xl p-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            What to reprocess
          </p>
          <div className="grid grid-cols-2 gap-1">
            {[
              { value: "both", label: "OCR + LLM" },
              { value: "ocr", label: "OCR only" },
              { value: "llm", label: "LLM only" },
              { value: "vision_llm", label: "Vision-LLM" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  mode === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {mode === "vision_llm" ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Vision-LLM Provider
              </p>
              {visionProviders.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No Vision-LLM providers enabled. Add one under Settings →
                  Document Analysis → Vision-LLM Providers.
                </p>
              ) : (
                <select
                  value={visionId}
                  onChange={(e) => setVisionId(e.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Default (highest priority)</option>
                  {visionProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <>
              {mode !== "llm" && ocrProviders.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    OCR Provider
                  </p>
                  <select
                    value={ocrId}
                    onChange={(e) => setOcrId(e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Default (highest priority)</option>
                    {ocrProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {mode !== "ocr" && llmProviders.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    LLM Provider
                  </p>
                  <select
                    value={llmId}
                    onChange={(e) => setLlmId(e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Default (highest priority)</option>
                    {llmProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <button
            onClick={handleStart}
            disabled={mode === "vision_llm" && visionProviders.length === 0}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Start Reprocessing
          </button>
        </div>
      )}
    </div>
  );
}
