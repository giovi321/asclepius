import { useEffect, useState } from "react";
import { ChevronDown, Share2 } from "lucide-react";
import Button from "@/components/ui/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import ReprocessOptionsForm, {
  type Provider,
  type ReprocessMode,
} from "./ReprocessOptionsForm";

export type { ReprocessMode };

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
 * Desktop bulk-actions bar shown when the user ticks one or more rows on
 * the Documents page (phones get MobileBulkBar instead). Includes an
 * inline reprocess-options popover so the user can pick OCR-only /
 * LLM-only / both + override providers without leaving the page.
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

  // Collapse the dropdown whenever the selection count changes, so a
  // filter change or manual clear doesn't leave stale state visible.
  useEffect(() => {
    setOpen(false);
  }, [selectedCount]);

  if (selectedCount === 0) return null;

  return (
    <div className="hidden md:flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
      <span>{selectedCount} selected</span>
      <span className="text-muted-foreground/40">|</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={!!bulkBusy}
        className="text-xs text-muted-foreground hover:text-destructive"
      >
        {bulkBusy === "Delete" ? "Deleting..." : "Delete"}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={!!bulkBusy}
            className="gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {bulkBusy?.startsWith("Reprocess") ? bulkBusy + "..." : "Reprocess"}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3">
          <ReprocessOptionsForm
            selectedCount={selectedCount}
            bulkBusy={bulkBusy}
            llmProviders={llmProviders}
            ocrProviders={ocrProviders}
            onSubmit={(mode, llmId, ocrId) => {
              onReprocess(mode, llmId, ocrId);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRegenerateFilename}
        disabled={!!bulkBusy}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        {bulkBusy === "Regenerate filename"
          ? "Renaming..."
          : "Regenerate filename"}
      </Button>
      {onShare && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onShare}
          disabled={!!bulkBusy || !!shareTooltip}
          title={
            shareTooltip ||
            "Create one share link covering all selected documents"
          }
          className="gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Share2 className="h-3 w-3" /> Share with doctor
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        disabled={!!bulkBusy}
        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
      >
        Clear
      </Button>
    </div>
  );
}
