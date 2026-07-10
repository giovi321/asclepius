import { useEffect, useState } from "react";
import { Share2, Wand2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import ReprocessOptionsForm, {
  type Provider,
  type ReprocessMode,
} from "./ReprocessOptionsForm";

export interface MobileBulkBarProps {
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
  /** Optional: "Share with doctor" action; disabled with `shareTooltip`
   * as the reason when the selection can't be shared. */
  onShare?: () => void;
  shareTooltip?: string | null;
}

/**
 * Fixed bottom action bar for phone selection mode (mirrors the desktop
 * BulkActionsBar handlers). Delete is one tap; everything else lives in
 * the "More" sheet.
 */
export default function MobileBulkBar({
  selectedCount,
  bulkBusy,
  llmProviders,
  ocrProviders,
  onDelete,
  onReprocess,
  onRegenerateFilename,
  onShare,
  shareTooltip,
}: MobileBulkBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the sheet whenever the selection count changes (bulk action
  // fired, filter change, manual clear) so stale options never linger.
  useEffect(() => {
    setMoreOpen(false);
  }, [selectedCount]);

  if (selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-0 inset-x-0 z-bar border-t bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate px-1 text-sm text-muted-foreground">
          {selectedCount} selected
        </span>
        <Button
          variant="danger"
          onClick={onDelete}
          disabled={!!bulkBusy}
          loading={bulkBusy === "Delete"}
        >
          Delete
        </Button>
        <Button
          variant="secondary"
          onClick={() => setMoreOpen(true)}
          disabled={!!bulkBusy}
        >
          More
        </Button>
      </div>

      <Sheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title={`Actions (${selectedCount} selected)`}
      >
        <div className="space-y-4">
          <ReprocessOptionsForm
            selectedCount={selectedCount}
            bulkBusy={bulkBusy}
            llmProviders={llmProviders}
            ocrProviders={ocrProviders}
            onSubmit={(mode, llmId, ocrId) => {
              setMoreOpen(false);
              onReprocess(mode, llmId, ocrId);
            }}
          />
          <div className="space-y-2 border-t pt-3">
            <Button
              variant="secondary"
              className="w-full"
              disabled={!!bulkBusy}
              loading={bulkBusy === "Regenerate filename"}
              onClick={() => {
                setMoreOpen(false);
                onRegenerateFilename();
              }}
            >
              <Wand2 className="h-4 w-4" aria-hidden />
              Regenerate filename
            </Button>
            {onShare && (
              <Button
                variant="secondary"
                className="w-full"
                disabled={!!bulkBusy || !!shareTooltip}
                title={shareTooltip || undefined}
                onClick={() => {
                  setMoreOpen(false);
                  onShare();
                }}
              >
                <Share2 className="h-4 w-4" aria-hidden />
                Share with doctor
              </Button>
            )}
            {shareTooltip && (
              <p className="text-xs text-muted-foreground">{shareTooltip}</p>
            )}
          </div>
        </div>
      </Sheet>
    </>
  );
}
