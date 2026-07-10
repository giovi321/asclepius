import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, FileText, Pencil, X } from "lucide-react";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/contexts/ToastContext";

export interface InlineRenameCellProps {
  doc: any;
  onRenamed: (updated: any) => void;
}

export default function InlineRenameCell({
  doc,
  onRenamed,
}: InlineRenameCellProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(doc.original_filename || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!val.trim() || val === doc.original_filename) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(`/documents/${doc.id}/rename`, {
        filename: val,
      });
      setEditing(false);
      onRenamed(res.data);
    } catch (e: any) {
      toast({
        title: "Rename failed",
        description: getErrorMessage(e),
        variant: "error",
      });
    }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") {
              setEditing(false);
              setVal(doc.original_filename);
            }
          }}
          className="flex-1 rounded border bg-background px-2 py-0.5 text-sm min-w-0"
          autoFocus
          disabled={saving}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded p-1 text-success hover:bg-success-soft disabled:opacity-50"
          aria-label="Save filename"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setVal(doc.original_filename);
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Cancel rename"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <Link
        to={`/documents/${doc.id}`}
        className="flex items-center gap-2 text-primary hover:underline flex-1 min-w-0"
        title={doc.original_filename}
      >
        <FileText className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{doc.original_filename}</span>
      </Link>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setVal(doc.original_filename);
          setEditing(true);
        }}
        // Hover-only reveal is acceptable here: this cell renders only in
        // the desktop (md+) table — the mobile card list uses DocumentCard.
        // focus-visible keeps it reachable for keyboard users.
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
        title="Rename"
        aria-label="Rename"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
