import { GitMerge, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";
import IconButton from "@/components/ui/IconButton";
import Input from "@/components/ui/Input";
import type { NormItem } from "./types";

export interface BatchMergeBarProps {
  selectedCount: number;
  normItems: NormItem[];
  selectedIds: Set<number>;
  batchTargetId: number | null;
  onBatchTargetChange: (id: number | null) => void;
  batchNewDisplay: string;
  onBatchNewDisplayChange: (v: string) => void;
  batchNewCode: string;
  onBatchNewCodeChange: (v: string) => void;
  onMerge: () => void;
  onClear: () => void;
}

export default function BatchMergeBar({
  selectedCount,
  normItems,
  selectedIds,
  batchTargetId,
  onBatchTargetChange,
  batchNewDisplay,
  onBatchNewDisplayChange,
  batchNewCode,
  onBatchNewCodeChange,
  onMerge,
  onClear,
}: BatchMergeBarProps) {
  if (selectedCount === 0) return null;

  const targetPicker = (
    <Combobox
      value={batchTargetId === null ? null : String(batchTargetId)}
      onChange={(v) => onBatchTargetChange(v === null ? null : Number(v))}
      placeholder="Merge into..."
      title="Merge into..."
      pinnedOptions={[{ value: "-1", label: "+ Create new entry..." }]}
      options={normItems
        .filter((n) => !selectedIds.has(n.id))
        .map((n) => ({
          value: String(n.id),
          label: n.canonical_display,
          hint: n.canonical_code || undefined,
        }))}
    />
  );

  const mergeDisabled =
    !batchTargetId || (batchTargetId === -1 && !batchNewDisplay.trim());

  return (
    <>
      {/* Inline bar, md and up */}
      <div className="hidden flex-col gap-2 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-sm md:flex">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">{selectedCount} selected</span>
          <span className="text-muted-foreground">Merge into:</span>
          <div className="min-w-[240px] max-w-xs">{targetPicker}</div>
          <Button size="sm" onClick={onMerge} disabled={mergeDisabled}>
            <GitMerge className="h-3 w-3" /> Merge
          </Button>
          <Button size="sm" variant="secondary" onClick={onClear}>
            Clear
          </Button>
        </div>
        {batchTargetId === -1 && (
          <div className="flex flex-wrap items-center gap-2 pl-1">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Name
              <Input
                value={batchNewDisplay}
                onChange={(e) => onBatchNewDisplayChange(e.target.value)}
                placeholder="e.g. Humanitas Medical Care"
                className="w-64"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Code{" "}
              <span className="text-[10px]">
                (optional - defaults to slug of name)
              </span>
              <Input
                value={batchNewCode}
                onChange={(e) => onBatchNewCodeChange(e.target.value)}
                placeholder="auto"
                className="w-40 font-mono"
              />
            </label>
          </div>
        )}
      </div>

      {/* Sticky bottom bar, below md */}
      <div className="fixed bottom-0 inset-x-0 z-bar border-t bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm font-medium">
            {selectedCount} selected
          </span>
          <div className="min-w-0 flex-1">{targetPicker}</div>
          <Button size="sm" onClick={onMerge} disabled={mergeDisabled}>
            <GitMerge className="h-3 w-3" /> Merge
          </Button>
          <IconButton size="sm" label="Clear selection" onClick={onClear}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        {batchTargetId === -1 && (
          <div className="mt-2 grid gap-2">
            <Input
              value={batchNewDisplay}
              onChange={(e) => onBatchNewDisplayChange(e.target.value)}
              placeholder="Display name for the new entry"
              aria-label="Display name for the new entry"
            />
            <Input
              value={batchNewCode}
              onChange={(e) => onBatchNewCodeChange(e.target.value)}
              placeholder="Code (optional, defaults to slug of name)"
              aria-label="Code (optional)"
              className="font-mono"
            />
          </div>
        )}
      </div>
    </>
  );
}
