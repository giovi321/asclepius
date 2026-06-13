import { useState } from "react";
import { Crop, Trash2 } from "lucide-react";
import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { Section } from "@/components/document-detail/DocumentDetailHelpers";
import { parseBackendTs } from "@/lib/datetime";

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
  // Route through parseBackendTs so a naive (tz-less) backend timestamp is
  // interpreted as UTC. The old copy used ``new Date(ts)`` directly, which
  // parsed naive strings as *local* time and rendered the wrong offset.
  const ms = parseBackendTs(ts);
  if (ms == null) return ts;
  const d = new Date(ms);
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
          const thumbUrl = item.thumbnail_path
            ? `/api/documents/${docId}/region-translations/${item.id}/thumbnail`
            : null;
          return (
            <div
              key={item.id}
              className="rounded-md border p-3 space-y-2 bg-muted/20"
            >
              {/* Header: metadata + small thumbnail preview + delete. The
                  thumbnail sits inline so the body text below can use the
                  full card width — a left-column thumbnail wasted space
                  on short translations. */}
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  Page {item.page}
                </span>
                {item.llm_model && (
                  <span
                    className="rounded border px-1.5 py-0 font-mono text-[10px]"
                    title={item.llm_model}
                  >
                    {item.llm_model}
                  </span>
                )}
                {item.created_at && <span>{formatTs(item.created_at)}</span>}
                {thumbUrl ? (
                  <a
                    href={thumbUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group/thumb relative ml-auto block flex-shrink-0"
                    title="Hover to preview, click to open full-size"
                  >
                    <img
                      src={thumbUrl}
                      alt={`Region on page ${item.page}`}
                      className="h-7 w-12 object-cover rounded border bg-background"
                    />
                    {/* Hover preview — anchored to the right of the
                        thumbnail and pointer-events-none so it doesn't
                        steal hover from the trigger. */}
                    <div className="pointer-events-none absolute right-0 top-full mt-1 z-20 hidden rounded-md border bg-background p-1 shadow-xl group-hover/thumb:block">
                      <img
                        src={thumbUrl}
                        alt=""
                        className="max-h-64 max-w-xs object-contain"
                      />
                    </div>
                  </a>
                ) : (
                  <span className="ml-auto text-[10px] italic">
                    {pending ? "Processing..." : "(no thumbnail)"}
                  </span>
                )}
                <button
                  onClick={() => handleDelete(item.id)}
                  disabled={busyId === item.id}
                  className="flex-shrink-0 rounded p-1 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  title="Delete this region translation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Body — full card width, no left-column indent. */}
              {pending ? (
                <p className="text-sm italic text-muted-foreground">
                  Processing - the cropped region is being OCR'd and translated.
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
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Show original OCR text ({item.ocr_text.length} chars)
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-[11px]">
                    {item.ocr_text}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
