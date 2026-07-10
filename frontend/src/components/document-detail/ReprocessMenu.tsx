import { useMemo, useState } from "react";
import api from "@/api/client";
import {
  useLlmProviders,
  useOcrProviders,
  useVisionProviders,
} from "@/hooks/data";
import ProviderSelect, { type Provider } from "@/components/ui/ProviderSelect";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";

export interface ReprocessOptionsPanelProps {
  docId: number | string;
  /** Optional gate: return false to cancel the reprocess (e.g. after a confirm dialog). */
  onBeforeReprocess?: () => Promise<boolean> | boolean;
  onReprocessed: () => Promise<void> | void;
  /** Close the hosting Sheet/Popover once the job has been kicked off. */
  onClose: () => void;
}

/**
 * Reprocess form body: mode toggle + provider selects. Presentation-free —
 * host it in a Sheet (this file's default export) or any other container.
 */
export function ReprocessOptionsPanel({
  docId,
  onBeforeReprocess,
  onReprocessed,
  onClose,
}: ReprocessOptionsPanelProps) {
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

  const handleStart = async () => {
    if (onBeforeReprocess) {
      const go = await onBeforeReprocess();
      if (!go) return;
    }
    onClose();
    await api.post(`/documents/${docId}/reprocess`, {
      mode,
      ...(llmId ? { llm_provider_id: llmId } : {}),
      ...(ocrId ? { ocr_provider_id: ocrId } : {}),
      ...(visionId ? { vision_provider_id: visionId } : {}),
    });
    await onReprocessed();
  };

  return (
    <div className="space-y-3">
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
            type="button"
            onClick={() => setMode(opt.value)}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors coarse:min-h-11 ${
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
            <p className="text-xs text-warning">
              No Vision-LLM providers enabled. Add one under Settings →
              Document Analysis → Vision-LLM Providers.
            </p>
          ) : (
            <ProviderSelect
              kind="vision"
              value={visionId}
              onChange={setVisionId}
              options={visionProviders}
            />
          )}
        </div>
      ) : (
        <>
          {mode !== "llm" && ocrProviders.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                OCR Provider
              </p>
              <ProviderSelect
                kind="ocr"
                value={ocrId}
                onChange={setOcrId}
                options={ocrProviders}
              />
            </div>
          )}
          {mode !== "ocr" && llmProviders.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                LLM Provider
              </p>
              <ProviderSelect
                kind="llm"
                value={llmId}
                onChange={setLlmId}
                options={llmProviders}
              />
            </div>
          )}
        </>
      )}

      <Button
        onClick={handleStart}
        disabled={mode === "vision_llm" && visionProviders.length === 0}
        className="w-full"
      >
        Start Reprocessing
      </Button>
    </div>
  );
}

export interface ReprocessSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: number | string;
  onBeforeReprocess?: () => Promise<boolean> | boolean;
  onReprocessed: () => Promise<void> | void;
}

/**
 * Sheet-hosted reprocess flow: bottom sheet on phones, centered dialog on
 * larger screens. Opened from the header's DetailActionsMenu.
 */
export default function ReprocessSheet({
  open,
  onOpenChange,
  docId,
  onBeforeReprocess,
  onReprocessed,
}: ReprocessSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reprocess document"
      contentClassName="sm:max-w-md"
    >
      <ReprocessOptionsPanel
        docId={docId}
        onBeforeReprocess={onBeforeReprocess}
        onReprocessed={onReprocessed}
        onClose={() => onOpenChange(false)}
      />
    </Sheet>
  );
}
