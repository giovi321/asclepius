import { GitMerge } from "lucide-react";
import Combobox from "@/components/ui/Combobox";
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
  return (
    <div className="flex flex-col gap-2 rounded-md border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{selectedCount} selected</span>
        <span className="text-muted-foreground">Merge into:</span>
        <div className="min-w-[240px] max-w-xs">
          <Combobox
            value={batchTargetId === null ? null : String(batchTargetId)}
            onChange={(v) => onBatchTargetChange(v === null ? null : Number(v))}
            placeholder="Select target..."
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
        </div>
        <button
          onClick={onMerge}
          disabled={
            !batchTargetId || (batchTargetId === -1 && !batchNewDisplay.trim())
          }
          className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
        >
          <GitMerge className="h-3 w-3" /> Merge
        </button>
        <button
          onClick={onClear}
          className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
        >
          Clear
        </button>
      </div>
      {batchTargetId === -1 && (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Name
            <input
              type="text"
              value={batchNewDisplay}
              onChange={(e) => onBatchNewDisplayChange(e.target.value)}
              placeholder="e.g. Humanitas Medical Care"
              className="rounded-md border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Code{" "}
            <span className="text-[10px]">
              (optional - defaults to slug of name)
            </span>
            <input
              type="text"
              value={batchNewCode}
              onChange={(e) => onBatchNewCodeChange(e.target.value)}
              placeholder="auto"
              className="rounded-md border bg-background px-2 py-1 text-sm font-mono"
            />
          </label>
        </div>
      )}
    </div>
  );
}
