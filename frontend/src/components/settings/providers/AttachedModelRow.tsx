import { Brain, Check, Eye, Pencil, ScanText, Trash2, X } from "lucide-react";
import type { AttachedModel } from "./types";

export interface AttachedModelRowProps {
  model: AttachedModel;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

export default function AttachedModelRow({ model: m, onToggle, onEdit, onRemove }: AttachedModelRowProps) {
  const KindIcon = m.kind === "vision" ? Eye : m.kind === "ocr" ? ScanText : Brain;
  const kindClass =
    m.kind === "vision"
      ? "text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-300"
      : m.kind === "ocr"
      ? "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300"
      : "text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-300";

  return (
    <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${m.enabled ? "" : "opacity-60"}`}>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${kindClass}`}>
        <KindIcon className="h-3 w-3" />
        {m.kind}
      </span>
      <span className="flex-1 min-w-0 truncate text-sm">{m.name}</span>
      {m.model && m.model !== m.name && (
        <span className="text-xs text-muted-foreground truncate">{m.model}</span>
      )}
      <button onClick={onToggle}
        title={m.enabled ? "Enabled - click to disable" : "Disabled - click to enable"}
        className={`rounded-md p-1 ${m.enabled ? "text-green-600" : "text-muted-foreground"} hover:bg-accent`}>
        {m.enabled ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </button>
      <button onClick={onEdit}
        title="Edit model"
        className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button onClick={onRemove}
        className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
