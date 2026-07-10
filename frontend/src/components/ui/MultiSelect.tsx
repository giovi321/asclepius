import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import PickerShell, { PickerOption } from "@/components/ui/PickerShell";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** If true, show a search box inside the panel. */
  searchable?: boolean;
}

/**
 * Multi-select filter chip + checkbox list. API-compatible replacement for
 * the old MultiSelectFilter (import swap); presentation via PickerShell:
 * bottom Sheet on phones, anchored Popover on larger screens.
 */
export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = true,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAll = () => onChange(options.map((o) => o.value));
  const clearAll = () => onChange([]);
  const addSearchResults = () => {
    const toAdd = filtered
      .map((o) => o.value)
      .filter((v) => !selected.includes(v));
    onChange([...selected, ...toAdd]);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  const hasActive = selected.length > 0;

  return (
    <PickerShell
      open={open}
      onOpenChange={handleOpenChange}
      title={`Filter by ${label.toLowerCase()}`}
      searchable={searchable}
      search={search}
      onSearchChange={setSearch}
      panelClassName="w-72 max-w-[300px]"
      trigger={
        <button
          type="button"
          className={cn(
            "flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm transition-colors coarse:min-h-11",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            hasActive
              ? "border-primary bg-primary/5 text-foreground"
              : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
          {hasActive && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {selected.length}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-fast",
              open && "rotate-180",
            )}
          />
          {hasActive && (
            <span
              role="button"
              aria-label="Clear filter"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
              className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      }
      header={
        <div className="flex items-center gap-1 border-b px-2 py-1.5 text-[11px]">
          <button
            type="button"
            onClick={selectAll}
            className="rounded px-1.5 py-0.5 text-primary hover:bg-accent coarse:py-1.5"
          >
            Select all
          </button>
          <span className="text-muted-foreground">|</span>
          <button
            type="button"
            onClick={clearAll}
            className="rounded px-1.5 py-0.5 text-primary hover:bg-accent coarse:py-1.5"
          >
            Clear
          </button>
          {search && filtered.length > 0 && (
            <>
              <span className="text-muted-foreground">|</span>
              <button
                type="button"
                onClick={addSearchResults}
                className="rounded px-1.5 py-0.5 text-primary hover:bg-accent coarse:py-1.5"
              >
                Add results to selection
              </button>
            </>
          )}
        </div>
      }
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No matches
        </div>
      ) : (
        filtered.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <PickerOption
              key={option.value}
              selected={false}
              className={cn(isSelected && "font-medium")}
              onClick={() => toggle(option.value)}
            >
              <span
                className={cn(
                  "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </span>
              <span className="truncate">{option.label}</span>
            </PickerOption>
          );
        })
      )}
    </PickerShell>
  );
}
