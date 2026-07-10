import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import PickerShell, { PickerOption } from "@/components/ui/PickerShell";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Small secondary text on the same row. */
  hint?: string;
}

export interface ComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ComboboxOption[];
  /** Options that always render at the top of the list, unfiltered by search
   *  (e.g. "+ Create new entry..."). */
  pinnedOptions?: ComboboxOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Sheet title on phones. */
  title?: string;
}

// Subsequence fuzzy match: every char of the query must appear in order in
// the candidate, case-insensitively. Preserved from SearchableSelect.
function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi += 1;
  }
  return qi === q.length;
}

/**
 * Single-select search picker. API-compatible replacement for the old
 * SearchableSelect (import swap); presentation via PickerShell: bottom
 * Sheet on phones, anchored Popover on larger screens.
 */
export default function Combobox({
  value,
  onChange,
  options,
  pinnedOptions = [],
  placeholder = "Select...",
  className = "",
  disabled = false,
  title = "Select an option",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedOption = useMemo(() => {
    const all = [...pinnedOptions, ...options];
    return all.find((o) => o.value === value) || null;
  }, [value, options, pinnedOptions]);

  const filteredOptions = useMemo(() => {
    const q = search.trim();
    if (!q) return options;
    return options.filter(
      (o) => fuzzyMatch(q, o.label) || (o.hint ? fuzzyMatch(q, o.hint) : false),
    );
  }, [options, search]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  const select = (v: string) => {
    onChange(v);
    handleOpenChange(false);
  };

  const renderOption = (option: ComboboxOption, pinned: boolean) => {
    const isSelected = option.value === value;
    return (
      <PickerOption
        key={pinned ? `pinned-${option.value}` : option.value}
        selected={isSelected}
        onClick={() => select(option.value)}
      >
        {isSelected ? (
          <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        <span className="truncate">{option.label}</span>
        {option.hint && (
          <span className="ml-auto truncate text-xs text-muted-foreground">
            {option.hint}
          </span>
        )}
      </PickerOption>
    );
  };

  return (
    <div className={cn("relative", className)}>
      <PickerShell
        open={open}
        onOpenChange={handleOpenChange}
        title={title}
        search={search}
        onSearchChange={setSearch}
        trigger={
          <button
            type="button"
            disabled={disabled}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-base sm:text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 coarse:h-11"
          >
            <span
              className={cn(
                "truncate text-left",
                !selectedOption && "text-muted-foreground",
              )}
            >
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <span className="flex flex-shrink-0 items-center gap-1">
              {selectedOption && (
                <span
                  role="button"
                  aria-label="Clear selection"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(null);
                  }}
                  className="rounded-full p-0.5 hover:bg-muted"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </span>
              )}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-fast",
                  open && "rotate-180",
                )}
              />
            </span>
          </button>
        }
      >
        {pinnedOptions.map((o) => renderOption(o, true))}
        {pinnedOptions.length > 0 && filteredOptions.length > 0 && (
          <div className="my-1 border-t" />
        )}
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {search ? `No matches for "${search}"` : "No options"}
          </div>
        ) : (
          filteredOptions.map((o) => renderOption(o, false))
        )}
      </PickerShell>
    </div>
  );
}
