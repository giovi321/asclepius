import { useEffect, useState } from "react";
import { ChevronDown, Pencil, RefreshCw, X } from "lucide-react";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/contexts/ToastContext";
import { useCollapseState } from "./useCollapseState";
import { ActionButton, IconButton } from "./inlineEditPrimitives";

export function EditableSummary({
  value,
  docId,
  onSave,
}: {
  value: string | null;
  docId: number;
  onSave: (updated?: any) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useCollapseState("summary", !!value);

  useEffect(() => {
    setVal(value || "");
  }, [value]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, {
        summary_en: val || null,
      });
      setEditing(false);
      onSave(res.data);
    } catch {
      toast({ title: "Failed to save", variant: "error" });
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, { summary_en: null });
      setEditing(false);
      setVal("");
      onSave(res.data);
    } catch {
      toast({ title: "Failed to delete", variant: "error" });
    }
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 hover:bg-primary/10 transition-colors"
      >
        <h3 className="text-sm font-medium text-primary">Summary</h3>
        <ChevronDown
          className={`h-4 w-4 text-primary/60 transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open && (
        <div className="px-4 pb-4">
          {editing ? (
            <>
              <textarea
                value={val}
                onChange={(e) => setVal(e.target.value)}
                className="w-full rounded border bg-background px-3 py-2 text-sm"
                rows={3}
                autoFocus
                disabled={saving}
              />
              <div className="flex gap-1 mt-2">
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
                    title="Delete the saved summary"
                  >
                    Delete
                  </ActionButton>
                )}
                <ActionButton
                  onClick={() => {
                    setEditing(false);
                    setVal(value || "");
                  }}
                >
                  Close
                </ActionButton>
              </div>
            </>
          ) : (
            <div
              className="cursor-pointer rounded p-1 -m-1 hover:bg-primary/5 group"
              onClick={() => setEditing(true)}
            >
              <p className="text-sm">
                {value || (
                  <span className="text-muted-foreground italic">
                    No summary - click to add
                  </span>
                )}
              </p>
              <p className="mt-1 text-[10px] text-primary/50 opacity-0 group-hover:opacity-100">
                click to edit
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EditableFilename ──────────────────────────────────────────

export function EditableFilename({
  value,
  docId,
  onSave,
}: {
  value: string;
  docId: number;
  onSave: (updated?: any) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setVal(value || "");
  }, [value]);

  const handleSave = async () => {
    if (!val.trim() || val === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(`/documents/${docId}/rename`, {
        filename: val,
      });
      setEditing(false);
      onSave(res.data);
    } catch (e: any) {
      toast({
        title: "Rename failed",
        description: getErrorMessage(e),
        variant: "error",
      });
    }
    setSaving(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/documents/${docId}/generate-filename`);
      const suggested = res.data.suggested_filename;
      if (suggested) {
        setVal(suggested);
        setEditing(true);
      }
    } catch (e: any) {
      toast({
        title: "Failed to generate filename",
        description: getErrorMessage(e),
        variant: "error",
      });
    }
    setGenerating(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") {
              setEditing(false);
              setVal(value);
            }
          }}
          className="text-xl font-semibold bg-background border rounded px-2 py-1 flex-1"
          autoFocus
          disabled={saving}
        />
        <ActionButton onClick={handleSave} disabled={saving} variant="primary">
          {saving ? "..." : "Save"}
        </ActionButton>
        <IconButton
          label="Close"
          onClick={() => {
            setEditing(false);
            setVal(value);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    );
  }

  return (
    <h1 className="text-xl font-semibold group cursor-pointer flex items-center gap-2">
      <span onClick={() => setEditing(true)}>{value}</span>
      <span className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
        <button
          onClick={() => setEditing(true)}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Edit filename"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-50"
          title="Generate filename from document data"
        >
          <RefreshCw
            className={`h-4 w-4 ${generating ? "animate-spin" : ""}`}
          />
        </button>
      </span>
    </h1>
  );
}
