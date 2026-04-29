import { useState } from "react";
import { Crop, Trash2 } from "lucide-react";
import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { Section } from "@/components/document-detail/DocumentDetailHelpers";

export interface RegionTranslation {
  id: number;
  page: number;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  ocr_text: string | null;
  translated_text: string | null;
  ocr_provider_id: string | null;
  llm_provider_id: string | null;
  llm_model: string | null;
  thumbnail_path: string | null;
  created_at: string | null;
}

export interface RegionTranslationsSectionProps {
  docId: number | string;
  items: RegionTranslation[];
  onChanged: () => void;
}

function formatTs(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export default function RegionTranslationsSection({
  docId,
  items,
  onChanged,
}: RegionTranslationsSectionProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: "Delete this region translation?",
      description: "The cropped image and its translation will be removed.",
      variant: "destructive",
    });
    if (!ok) return;
    setBusyId(id);
    try {
      await api.delete(`/documents/${docId}/region-translations/${id}`);
      onChanged();
    } catch {
      toast({ title: "Failed to delete", variant: "error" });
    } finally {
      setBusyId(null);
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <Section
      title={`Region translations (${items.length})`}
      icon={Crop}
      sectionId="region-translations"
      defaultOpen={items.length > 0}
    >
      <div className="space-y-3">
        {items.map((item) => {
          const failed = (item.translated_text || "").startsWith("[failed:");
          const pending = !item.translated_text;
          return (
            <div
              key={item.id}
              className="rounded-md border p-3 space-y-2 bg-muted/20"
            >
              <div className="flex items-start gap-3">
                {item.thumbnail_path ? (
                  <a
                    href={`/api/documents/${docId}/region-translations/${item.id}/thumbnail`}
                    target="_blank"
                    rel="noreferrer"
                    className="block flex-shrink-0"
                    title="Open full-size cropped image"
                  >
                    <img
                      src={`/api/documents/${docId}/region-translations/${item.id}/thumbnail`}
                      alt={`Region on page ${item.page}`}
                      className="h-24 w-32 object-contain rounded border bg-background"
                    />
                  </a>
                ) : (
                  <div className="h-24 w-32 flex-shrink-0 flex items-center justify-center rounded border bg-background text-[10px] text-muted-foreground">
                    {pending ? "Processing..." : "(no thumbnail)"}
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Page {item.page}
                    </span>
                    {item.llm_model && (
                      <span className="rounded border px-1.5 py-0 font-mono text-[10px]">
                        {item.llm_model}
                      </span>
                    )}
                    {item.created_at && (
                      <span>{formatTs(item.created_at)}</span>
                    )}
                  </div>
                  {pending ? (
                    <p className="text-sm italic text-muted-foreground">
                      Processing - the cropped region is being OCR'd and
                      translated.
                    </p>
                  ) : failed ? (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {item.translated_text}
                    </p>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {item.translated_text}
                    </p>
                  )}
                  {item.ocr_text && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Show original OCR text ({item.ocr_text.length} chars)
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-[11px]">
                        {item.ocr_text}
                      </pre>
                    </details>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(item.id)}
                  disabled={busyId === item.id}
                  className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  title="Delete this region translation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
