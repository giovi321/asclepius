import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;
  hint?: string; // small secondary text to show on the same row
}

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
  options: SearchableOption[];
  /** Options that always render at the top of the list, unfiltered by search
   *  (e.g. "+ Create new entry..."). */
  pinnedOptions?: SearchableOption[];
  placeholder?: string;
  className?: string;
  /** Optional disabled state for the trigger button. */
  disabled?: boolean;
}

// Subsequence fuzzy match: every char of the query must appear in order in
// the candidate, case-insensitively. Same logic as the trend-chart picker.
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

export default function SearchableSelect({
  value,
  onChange,
  options,
  pinnedOptions = [],
  placeholder = "Select...",
  className = "",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus the search field on open; flip alignment if the dropdown would
  // overflow the viewport's right edge.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const panelMaxWidth = 360;
      setAlignRight(rect.left + panelMaxWidth > window.innerWidth - 8);
    }
  }, [open]);

  const selectedOption = useMemo(() => {
    const all = [...pinnedOptions, ...options];
    return all.find((o) => o.value === value) || null;
  }, [value, options, pinnedOptions]);

  const filteredOptions = useMemo(() => {
    const q = search.trim();
    if (!q) return options;
    return options.filter((o) => fuzzyMatch(q, o.label) || (o.hint ? fuzzyMatch(q, o.hint) : false));
  }, [options, search]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-accent/40"
      >
        <span className={`truncate text-left ${selectedOption ? "" : "text-muted-foreground"}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {selectedOption && (
            <span
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              className="rounded-full p-0.5 hover:bg-muted"
              title="Clear"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <div className={`absolute top-full mt-1 z-30 rounded-lg border bg-background shadow-xl w-80 max-w-[360px] ${alignRight ? "right-0" : "left-0"}`}>
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full rounded-md border bg-background pl-8 pr-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="max-h-[280px] overflow-y-auto py-1">
            {pinnedOptions.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={`pinned-${option.value}`}
                  onClick={() => select(option.value)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors ${isSelected ? "bg-accent/60" : ""}`}
                >
                  {isSelected ? <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" /> : <span className="w-3.5" />}
                  <span className="truncate">{option.label}</span>
                  {option.hint && <span className="ml-auto text-xs text-muted-foreground truncate">{option.hint}</span>}
                </button>
              );
            })}
            {pinnedOptions.length > 0 && filteredOptions.length > 0 && (
              <div className="my-1 border-t" />
            )}
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {search ? `No matches for "${search}"` : "No options"}
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    onClick={() => select(option.value)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors ${isSelected ? "bg-accent/60 font-medium" : ""}`}
                  >
                    {isSelected ? <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" /> : <span className="w-3.5" />}
                    <span className="truncate">{option.label}</span>
                    {option.hint && <span className="ml-auto text-xs text-muted-foreground truncate">{option.hint}</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
