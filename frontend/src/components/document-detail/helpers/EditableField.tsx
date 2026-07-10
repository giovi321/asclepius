import React, { useState } from "react";
import { Pencil, X } from "lucide-react";
import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";
import { ActionButton, IconButton } from "./inlineEditPrimitives";

export function EditableField({
  label,
  value,
  field,
  docId,
  onSave,
  type = "text",
  multiline = false,
  apiPath,
  formatDisplay,
}: {
  label: string;
  value: any;
  field: string;
  docId: number;
  onSave: (updated?: any) => void;
  type?: string;
  multiline?: boolean;
  /** Override the PATCH endpoint. Defaults to ``/documents/{docId}`` so
   * regular document fields keep their behaviour. The imaging detail
   * page passes ``/imaging/{studyId}/metadata`` so modality, body_part,
   * etc. save against ``imaging_studies`` instead. */
  apiPath?: string;
  /** Optional read-only formatter for the displayed value. The raw
   * value is still used for editing and saving — the formatter only
   * affects how it appears in the row. Used to title-case DICOM-source
   * strings like body_part="ABDOMEN" without rewriting the DB. */
  formatDisplay?: (v: any) => string;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const path = apiPath || `/documents/${docId}`;
      const res = await api.patch(path, { [field]: val || null });
      setEditing(false);
      // Pass updated doc back so parent can update state without full reload
      onSave(res.data);
    } catch {
      toast({ title: "Failed to save", variant: "error" });
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      const path = apiPath || `/documents/${docId}`;
      const res = await api.patch(path, { [field]: null });
      setEditing(false);
      setVal("");
      onSave(res.data);
    } catch {
      toast({ title: "Failed to delete", variant: "error" });
    }
    setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) handleSave();
    if (e.key === "Escape") {
      setEditing(false);
      setVal(value || "");
    }
  };

  const cancel = () => {
    setEditing(false);
    setVal(value || "");
  };

  // Multiline fields stack: label on its own line as a small-caps
  // eyebrow, value (or textarea) full-width below. Single-line fields
  // keep the inline label-on-left, value-on-right row.
  if (editing && multiline) {
    return (
      <div className="space-y-1.5 py-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full rounded border bg-background px-2 py-1.5 text-sm"
          rows={3}
          autoFocus
          disabled={saving}
        />
        <div className="flex justify-end gap-1">
          <ActionButton
            onClick={handleSave}
            disabled={saving}
            variant="primary"
          >
            {saving ? "Saving..." : "Save"}
          </ActionButton>
          {value && (
            <ActionButton
              onClick={handleDelete}
              disabled={saving}
              variant="danger"
              title="Delete the saved value"
            >
              Delete
            </ActionButton>
          )}
          <IconButton label="Close" onClick={cancel}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <span className="text-muted-foreground w-28 flex-shrink-0">
          {label}
        </span>
        <div className="flex-1 flex items-center gap-2">
          <input
            type={type}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 h-7 rounded border bg-background px-2 text-sm"
            autoFocus
            disabled={saving}
          />
          <ActionButton
            onClick={handleSave}
            disabled={saving}
            variant="primary"
          >
            {saving ? "..." : "Save"}
          </ActionButton>
          {value && (
            <ActionButton
              onClick={handleDelete}
              disabled={saving}
              variant="danger"
              title="Delete the saved value"
            >
              Delete
            </ActionButton>
          )}
          <IconButton label="Close" onClick={cancel}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    );
  }

  if (multiline) {
    return (
      <div
        className="space-y-1 py-1 group cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 coarse:min-h-11"
        onClick={() => {
          setVal(value || "");
          setEditing(true);
        }}
      >
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
          <Pencil
            aria-hidden
            className="h-3 w-3 shrink-0 text-muted-foreground/60 opacity-100 md:opacity-0 md:group-hover:opacity-100"
          />
        </p>
        {value ? (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {formatDisplay ? formatDisplay(value) : value}
          </p>
        ) : (
          <p className="text-xs italic text-muted-foreground/50 group-hover:text-primary">
            click to add
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-2 text-sm py-0.5 group cursor-pointer hover:bg-accent/30 rounded px-1 -mx-1 coarse:min-h-11"
      onClick={() => {
        setVal(value || "");
        setEditing(true);
      }}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        {value ? (
          formatDisplay ? (
            formatDisplay(value)
          ) : (
            value
          )
        ) : (
          <span className="text-muted-foreground/50 italic group-hover:text-primary text-xs coarse:opacity-70">
            click to edit
          </span>
        )}
        <Pencil
          aria-hidden
          className="h-3 w-3 shrink-0 text-muted-foreground/60 opacity-100 md:opacity-0 md:group-hover:opacity-100"
        />
      </span>
    </div>
  );
}
