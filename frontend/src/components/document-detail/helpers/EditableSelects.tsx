import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";
import { ActionButton, IconButton } from "./inlineEditPrimitives";

export function EditableSelect({
  label,
  value,
  field,
  docId,
  onSave,
  options,
  formatLabel,
  apiPath,
}: {
  label: string;
  value: any;
  field: string;
  docId: number;
  onSave: (updated?: any) => void;
  options: string[];
  formatLabel?: (v: string) => string;
  /** Override the PATCH endpoint. See EditableField for details. */
  apiPath?: string;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const fmt = formatLabel || ((v: string) => v.replace(/_/g, " "));

  const handleSave = async (newVal: string) => {
    setSaving(true);
    try {
      const path = apiPath || `/documents/${docId}`;
      const res = await api.patch(path, { [field]: newVal || null });
      setEditing(false);
      setVal(newVal);
      onSave(res.data);
    } catch {
      toast({ title: "Failed to save", variant: "error" });
    }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <span className="text-muted-foreground w-28 flex-shrink-0">
          {label}
        </span>
        <select
          value={val}
          onChange={(e) => handleSave(e.target.value)}
          disabled={saving}
          className="flex-1 h-7 rounded border bg-background px-2 text-sm"
          autoFocus
        >
          <option value="">— none —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {fmt(opt)}
            </option>
          ))}
        </select>
        {value && (
          <ActionButton
            onClick={() => handleSave("")}
            disabled={saving}
            variant="danger"
            title="Delete the saved value"
          >
            Delete
          </ActionButton>
        )}
        <IconButton label="Close" onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    );
  }

  return (
    <div
      className="flex justify-between text-sm py-0.5 group cursor-pointer hover:bg-accent/30 rounded px-1 -mx-1"
      onClick={() => {
        setVal(value || "");
        setEditing(true);
      }}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value ? (
          fmt(value)
        ) : (
          <span className="text-muted-foreground/50 italic group-hover:text-primary text-xs">
            click to edit
          </span>
        )}
      </span>
    </div>
  );
}

// ─── EditableSearchableSelect ─────────────────────────────────
// Same surface as EditableSelect, but the dropdown is preceded by a
// search input that filters the static option list. Used for fields
// with enough valid values that scanning a native <select> is awkward
// (e.g. doc_type), but where the values are a fixed enum rather than
// a normalization endpoint.

export function EditableSearchableSelect({
  label,
  value,
  field,
  docId,
  onSave,
  options,
  formatLabel,
  placeholder,
}: {
  label: string;
  value: any;
  field: string;
  docId: number;
  onSave: (updated?: any) => void;
  options: string[];
  formatLabel?: (v: string) => string;
  placeholder?: string;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fmt = formatLabel || ((v: string) => v.replace(/_/g, " "));

  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setEditing(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  const handleSave = async (newVal: string | null) => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, {
        [field]: newVal || null,
      });
      onSave(res.data);
      setEditing(false);
      setQuery("");
    } catch {
      toast({ title: "Failed to save", variant: "error" });
    }
    setSaving(false);
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => {
        return o.toLowerCase().includes(q) || fmt(o).toLowerCase().includes(q);
      })
    : options;

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <span className="text-muted-foreground w-28 flex-shrink-0">
          {label}
        </span>
        <div ref={rootRef} className="relative flex-1">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditing(false);
                    setQuery("");
                  }
                  if (e.key === "Enter" && filtered.length === 1) {
                    handleSave(filtered[0]);
                  }
                }}
                placeholder={placeholder || "Search..."}
                className="w-full h-7 rounded border bg-background pl-7 pr-2 text-sm"
                autoFocus
                disabled={saving}
              />
            </div>
            {value && (
              <ActionButton
                onClick={() => handleSave(null)}
                disabled={saving}
                variant="danger"
                title="Delete the saved value"
              >
                Delete
              </ActionButton>
            )}
            <IconButton
              label="Close"
              onClick={() => {
                setEditing(false);
                setQuery("");
              }}
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-background shadow-lg">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No match.
              </div>
            )}
            {filtered.map((opt) => {
              const isCurrent =
                value && opt.toLowerCase() === String(value).toLowerCase();
              return (
                <button
                  key={opt}
                  onClick={() => handleSave(opt)}
                  disabled={saving}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent ${isCurrent ? "bg-accent/40" : ""}`}
                >
                  <span className="truncate">{fmt(opt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex justify-between text-sm py-0.5 group cursor-pointer hover:bg-accent/30 rounded px-1 -mx-1"
      onClick={() => {
        setQuery("");
        setEditing(true);
      }}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value ? (
          fmt(value)
        ) : (
          <span className="text-muted-foreground/50 italic group-hover:text-primary text-xs">
            click to edit
          </span>
        )}
      </span>
    </div>
  );
}
