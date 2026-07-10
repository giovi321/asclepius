import { useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";

export type ReprocessMode = "both" | "ocr" | "llm";

export interface Provider {
  id: string;
  name?: string | null;
  enabled: boolean;
}

export interface ReprocessOptionsFormProps {
  selectedCount: number;
  bulkBusy: string | null;
  llmProviders: Provider[];
  ocrProviders: Provider[];
  onSubmit: (
    mode: ReprocessMode,
    llmProviderId: string,
    ocrProviderId: string,
  ) => void;
}

/**
 * Reprocess options: what to re-run (OCR / LLM / both) + optional provider
 * overrides + the submit button. Hosted in a Popover on desktop
 * (BulkActionsBar) and in the "More" Sheet on phones (MobileBulkBar).
 */
export default function ReprocessOptionsForm({
  selectedCount,
  bulkBusy,
  llmProviders,
  ocrProviders,
  onSubmit,
}: ReprocessOptionsFormProps) {
  const [mode, setMode] = useState<ReprocessMode>("both");
  const [llmId, setLlmId] = useState("");
  const [ocrId, setOcrId] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        What to reprocess
      </p>
      <div className="flex gap-1">
        {[
          { value: "both", label: "OCR + LLM" },
          { value: "ocr", label: "OCR only" },
          { value: "llm", label: "LLM only" },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value as ReprocessMode)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors coarse:min-h-11 ${
              mode === opt.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {mode !== "llm" && ocrProviders.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            OCR Provider
          </p>
          <Select value={ocrId} onChange={(e) => setOcrId(e.target.value)}>
            <option value="">Default (highest priority)</option>
            {ocrProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </Select>
        </div>
      )}

      {mode !== "ocr" && llmProviders.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            LLM Provider
          </p>
          <Select value={llmId} onChange={(e) => setLlmId(e.target.value)}>
            <option value="">Default (highest priority)</option>
            {llmProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </Select>
        </div>
      )}

      <Button
        className="w-full"
        disabled={!!bulkBusy}
        onClick={() => onSubmit(mode, llmId, ocrId)}
      >
        Start Reprocessing ({selectedCount})
      </Button>
    </div>
  );
}
