import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X, Check } from "lucide-react";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";

interface FilterOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** If true, show a search box inside the dropdown */
  searchable?: boolean;
}

export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  searchable = true,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on click outside. Listener stays attached regardless of open state
  // (mirrors the original permanent-listener behaviour); the contains-check
  // makes it a no-op while closed.
  useOnClickOutside(ref, () => {
    setOpen(false);
    setSearch("");
  });

  // Focus search and decide alignment on open. If a left-aligned dropdown
  // would overflow the viewport's right edge, flip it to align with the
  // button's right side so the panel extends leftward instead.
  useEffect(() => {
    if (!open) return;
    if (searchRef.current) searchRef.current.focus();
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const panelMaxWidth = 300; // matches max-w-[300px] below
      const viewportWidth = window.innerWidth;
      setAlignRight(rect.left + panelMaxWidth > viewportWidth - 8);
    }
  }, [open]);

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

  const hasActive = selected.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors whitespace-nowrap ${
          hasActive
            ? "border-primary bg-primary/5 text-foreground"
            : "bg-background text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        {hasActive && (
          <span className="flex items-center justify-center h-4 min-w-[16px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
            {selected.length}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {hasActive && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20"
            title="Clear filter"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1 z-30 rounded-lg border bg-background shadow-xl min-w-[220px] max-w-[300px] ${alignRight ? "right-0" : "left-0"}`}
        >
          {/* Search box */}
          {searchable && (
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
          )}

          {/* Actions row */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b text-[11px]">
            <button
              onClick={selectAll}
              className="rounded px-1.5 py-0.5 text-primary hover:bg-accent"
            >
              Select all
            </button>
            <span className="text-muted-foreground">|</span>
            <button
              onClick={clearAll}
              className="rounded px-1.5 py-0.5 text-primary hover:bg-accent"
            >
              Clear
            </button>
            {search && filtered.length > 0 && (
              <>
                <span className="text-muted-foreground">|</span>
                <button
                  onClick={addSearchResults}
                  className="rounded px-1.5 py-0.5 text-primary hover:bg-accent"
                >
                  Add results to selection
                </button>
              </>
            )}
          </div>

          {/* Options list */}
          <div className="max-h-[250px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No matches
              </div>
            ) : (
              filtered.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    onClick={() => toggle(option.value)}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors ${
                      isSelected ? "font-medium" : ""
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center h-4 w-4 rounded border flex-shrink-0 ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{option.label}</span>
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
