import { useEffect, useRef, useState } from "react";
import { ChevronDown, Share2 } from "lucide-react";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";

export type ReprocessMode = "both" | "ocr" | "llm";

interface Provider {
  id: string;
  name?: string | null;
  enabled: boolean;
}

export interface BulkActionsBarProps {
  selectedCount: number;
  bulkBusy: string | null;
  llmProviders: Provider[];
  ocrProviders: Provider[];
  onDelete: () => void;
  onReprocess: (
    mode: ReprocessMode,
    llmProviderId: string,
    ocrProviderId: string,
  ) => void;
  onRegenerateFilename: () => void;
  onClear: () => void;
  /** Optional: render a "Share with doctor" action when defined. Hidden
   * when the current selection spans multiple patients (parent passes
   * undefined ``shareTooltip``). */
  onShare?: () => void;
  shareTooltip?: string | null;
}

/**
 * Floating bulk-actions bar shown when the user ticks one or more rows
 * on the Documents page. Includes an inline reprocess-mode dropdown so
 * the user can pick OCR-only / LLM-only / both + override providers
 * without leaving the page.
 */
export default function BulkActionsBar({
  selectedCount,
  bulkBusy,
  llmProviders,
  ocrProviders,
  onDelete,
  onReprocess,
  onRegenerateFilename,
  onClear,
  onShare,
  shareTooltip,
}: BulkActionsBarProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReprocessMode>("both");
  const [llmId, setLlmId] = useState("");
  const [ocrId, setOcrId] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useOnClickOutside(ref, () => setOpen(false), open);

  // Collapse the dropdown whenever the selection count changes, so a
  // filter change or manual clear doesn't leave stale state visible.
  useEffect(() => {
    setOpen(false);
  }, [selectedCount]);

  if (selectedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
      <span>{selectedCount} selected</span>
      <span className="text-muted-foreground/40">|</span>
      <button
        onClick={onDelete}
        disabled={!!bulkBusy}
        className="hover:text-destructive disabled:opacity-50"
      >
        {bulkBusy === "Delete" ? "Deleting..." : "Delete"}
      </button>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={!!bulkBusy}
          className="inline-flex items-center gap-0.5 hover:text-foreground disabled:opacity-50"
        >
          {bulkBusy?.startsWith("Reprocess") ? bulkBusy + "..." : "Reprocess"}
          <ChevronDown className="h-3 w-3" />
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-30 w-72 rounded-lg border bg-background shadow-xl p-3 space-y-3 text-foreground">
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
                  onClick={() => setMode(opt.value as ReprocessMode)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
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

            <button
              onClick={() => {
                onReprocess(mode, llmId, ocrId);
                setOpen(false);
              }}
              disabled={!!bulkBusy}
              className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Start Reprocessing ({selectedCount})
            </button>
          </div>
        )}
      </div>
      <button
        onClick={onRegenerateFilename}
        disabled={!!bulkBusy}
        className="hover:text-foreground disabled:opacity-50"
      >
        {bulkBusy === "Regenerate filename"
          ? "Renaming..."
          : "Regenerate filename"}
      </button>
      {onShare && (
        <button
          onClick={onShare}
          disabled={!!bulkBusy || !!shareTooltip}
          title={
            shareTooltip ||
            "Create one share link covering all selected documents"
          }
          className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
        >
          <Share2 className="h-3 w-3" /> Share with doctor
        </button>
      )}
      <button
        onClick={onClear}
        disabled={!!bulkBusy}
        className="ml-auto hover:text-foreground disabled:opacity-50"
      >
        Clear
      </button>
    </div>
  );
}
