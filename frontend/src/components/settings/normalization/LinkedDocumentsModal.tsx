import { Loader2, Trash2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";

export interface LinkedDocumentsModalProps {
  subjectName: string;
  loading: boolean;
  documents: any[] | null;
  onClose: () => void;
  onDelete: () => void;
}

export default function LinkedDocumentsModal({
  subjectName,
  loading,
  documents,
  onClose,
  onDelete,
}: LinkedDocumentsModalProps) {
  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Documents referencing "${subjectName}"`}
      contentClassName="sm:max-w-2xl"
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (documents?.length ?? 0) === 0 ? (
        <div className="space-y-3 py-4">
          <p className="text-sm text-muted-foreground">
            No documents reference this entry. It's safe to delete.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-3 w-3" /> Delete "{subjectName}"
            </button>
            <button
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {documents!.map((d: any) => (
            <a
              key={d.id}
              href={`/documents/${d.id}`}
              className="flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-accent"
            >
              <span className="font-medium truncate">
                {d.original_filename || `Document #${d.id}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {[d.doc_type, d.event_date, d.patient_name]
                  .filter(Boolean)
                  .join(" • ")}
              </span>
            </a>
          ))}
        </div>
      )}
    </Sheet>
  );
}
