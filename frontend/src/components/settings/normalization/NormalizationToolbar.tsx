import { useEffect, useRef } from "react";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import type { NormType } from "./types";

export interface NormalizationToolbarProps {
  normType: NormType;
  onNormTypeChange: (v: string) => void;
  normFilter: string | null;
  onNormFilterChange: (v: string | null) => void;
  searchInput: string;
  onSearchInputChange: (v: string) => void;
  onSearchCommit: (v: string) => void;
  onAutoMerge: () => void;
  autoMergeLoading: boolean;
  canAutoMerge: boolean;
  itemCount: number;
}

export default function NormalizationToolbar({
  normType,
  onNormTypeChange,
  normFilter,
  onNormFilterChange,
  searchInput,
  onSearchInputChange,
  onSearchCommit,
  onAutoMerge,
  autoMergeLoading,
  canAutoMerge,
  itemCount,
}: NormalizationToolbarProps) {
  // Debounce search changes so we don't re-fire the list query on every keystroke.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearchCommit(searchInput), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [searchInput, onSearchCommit]);

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <select
        value={normType}
        onChange={(e) => onNormTypeChange(e.target.value)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="lab_tests">Lab Tests</option>
        <option value="specialties">Specialties</option>
        <option value="diagnoses">Diagnoses</option>
        <option value="medications">Medications</option>
        <option value="doctors">Doctors</option>
        <option value="facilities">Facilities</option>
      </select>
      <select
        value={normFilter || ""}
        onChange={(e) => onNormFilterChange(e.target.value || null)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">All</option>
        <option value="unreviewed">Unreviewed only</option>
      </select>
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          placeholder="Search by name, code, or alias..."
          className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm"
        />
        {searchInput && (
          <button
            onClick={() => {
              onSearchInputChange("");
              onSearchCommit("");
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button
        onClick={onAutoMerge}
        disabled={autoMergeLoading || !canAutoMerge}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
        title="Ask the AI to propose merges - you review and approve each one"
      >
        {autoMergeLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        Auto-merge with AI
      </button>
      <span className="text-xs text-muted-foreground">{itemCount} entries</span>
    </div>
  );
}
