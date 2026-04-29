import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Languages } from "lucide-react";
import api from "@/api/client";
import { useLlmProviders } from "@/hooks/data";

export interface TranslateMenuProps {
  docId: number | string;
  hasOcrText: boolean;
  onTranslated: () => Promise<void> | void;
}

interface Provider {
  id: string;
  name?: string | null;
  enabled: boolean;
}

/**
 * On-demand "Translate to English" button. Opens a small popover that
 * lets the user pick a text-LLM credential, then queues a translate job.
 * Disabled when the document has no OCR text yet (nothing to translate).
 */
export default function TranslateMenu({
  docId,
  hasOcrText,
  onTranslated,
}: TranslateMenuProps) {
  const [open, setOpen] = useState(false);
  const { data: llmAll } = useLlmProviders();
  const llmProviders: Provider[] = useMemo(
    () =>
      (Array.isArray(llmAll) ? llmAll : []).filter((p: Provider) => p.enabled),
    [llmAll],
  );
  const [llmId, setLlmId] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleStart = async () => {
    setOpen(false);
    await api.post(`/documents/${docId}/translate`, {
      ...(llmId ? { llm_provider_id: llmId } : {}),
    });
    await onTranslated();
  };

  const disabled = !hasOcrText;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        title={
          disabled
            ? "Run OCR first to populate the document body."
            : "Translate body to English"
        }
        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Languages className="h-4 w-4" /> Translate{" "}
        <ChevronDown className="h-3 w-3 ml-0.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded-lg border bg-background shadow-xl p-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            Translate the document body to English. Only prose is translated;
            names, dates, codes, and values stay as-is.
          </p>
          {llmProviders.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No text LLM providers enabled. Add one under Settings.
            </p>
          ) : (
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
          <button
            onClick={handleStart}
            disabled={llmProviders.length === 0}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Start Translation
          </button>
        </div>
      )}
    </div>
  );
}
