import { useState } from "react";
import { StickyNote } from "lucide-react";
import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";
import { Section } from "@/components/document-detail/DocumentDetailHelpers";

export interface NotesEditorProps {
  docId: number | string;
  initialNotes: string;
}

export default function NotesEditor({ docId, initialNotes }: NotesEditorProps) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(initialNotes);
  const [editing, setEditing] = useState(false);

  const handleSave = async () => {
    try {
      await api.patch(`/documents/${docId}`, { user_notes: notes });
      setEditing(false);
    } catch {
      toast({ title: "Failed to save notes", variant: "error" });
    }
  };

  return (
    <Section
      title="Notes"
      icon={StickyNote}
      sectionId="notes"
      defaultOpen={!!initialNotes?.trim()}
    >
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            rows={4}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setNotes(initialNotes);
              }}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="cursor-pointer rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:bg-accent/50 min-h-[60px]"
        >
          {notes || "Click to add notes..."}
        </div>
      )}
    </Section>
  );
}
