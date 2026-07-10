import { GitMerge, Sparkles } from "lucide-react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";

export interface AutoMergeProposal {
  target_id: number;
  source_ids: number[];
  reason?: string;
}

export interface AutoMergePanelProps {
  proposals: AutoMergeProposal[];
  entries: any[];
  onClose: () => void;
  onApply: (proposal: AutoMergeProposal) => void | Promise<void>;
  onSkip: (idx: number) => void;
  onUpdateTarget: (idx: number, newTargetId: number) => void;
  onToggleSource: (idx: number, sourceId: number) => void;
}

export default function AutoMergePanel({
  proposals,
  entries,
  onClose,
  onApply,
  onSkip,
  onUpdateTarget,
  onToggleSource,
}: AutoMergePanelProps) {
  const entryById: Record<number, any> = Object.fromEntries(
    entries.map((e: any) => [e.id, e]),
  );

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          AI merge proposals ({proposals.length})
        </div>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      {proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No merge candidates found. All entries look distinct.
        </p>
      ) : (
        <div className="space-y-3">
          {proposals.map((p, idx) => {
            const groupIds: number[] = [p.target_id, ...p.source_ids];
            return (
              <div
                key={idx}
                className="rounded-md border bg-background p-3 space-y-2"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Target:</span>
                  <Select
                    value={p.target_id}
                    onChange={(e) =>
                      onUpdateTarget(idx, Number(e.target.value))
                    }
                    aria-label="Merge target"
                    className="w-auto min-w-0 flex-1 md:flex-none"
                  >
                    {groupIds.map((id) => (
                      <option key={id} value={id}>
                        {entryById[id]?.canonical_display || `#${id}`}
                      </option>
                    ))}
                  </Select>
                </div>
                {p.reason && (
                  <p className="text-xs italic text-muted-foreground">
                    "{p.reason}"
                  </p>
                )}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    Merge these into target:
                  </div>
                  {p.source_ids.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No sources selected.
                    </p>
                  ) : (
                    p.source_ids.map((sid: number) => (
                      <label
                        key={sid}
                        className="flex items-center gap-2 text-sm coarse:min-h-11"
                      >
                        <input
                          type="checkbox"
                          checked
                          onChange={() => onToggleSource(idx, sid)}
                        />
                        <span>
                          {entryById[sid]?.canonical_display || `#${sid}`}
                        </span>
                        {entryById[sid]?.canonical_code && (
                          <span className="text-xs text-muted-foreground font-mono">
                            ({entryById[sid].canonical_code})
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => onApply(p)}
                    disabled={p.source_ids.length === 0}
                  >
                    <GitMerge className="h-3 w-3" /> Apply merge
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onSkip(idx)}>
                    Skip
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
