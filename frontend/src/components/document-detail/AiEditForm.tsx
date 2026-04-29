import { useState } from "react";
import { Stethoscope } from "lucide-react";
import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";
import { Section } from "@/components/document-detail/DocumentDetailHelpers";

export interface AiEditFormProps {
  docId: number | string;
  onApplied: () => Promise<void> | void;
}

export default function AiEditForm({ docId, onApplied }: AiEditFormProps) {
  const { toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!instruction.trim()) return;
    setBusy(true);
    try {
      const resp = await api.post(`/documents/${docId}/edit-with-ai`, {
        instruction,
      });
      setInstruction("");
      await onApplied();
      const data = resp?.data || {};
      if (data.mode === "pages") {
        const pages: number[] = Array.isArray(data.pages) ? data.pages : [];
        const oor: number[] = Array.isArray(data.out_of_range_pages)
          ? data.out_of_range_pages
          : [];
        const notCached: number[] = Array.isArray(data.not_in_cache_pages)
          ? data.not_in_cache_pages
          : [];
        let description = `Re-extracted from page${pages.length === 1 ? "" : "s"} ${pages.join(", ")}`;
        if (oor.length) {
          description += ` (skipped out-of-range: ${oor.join(", ")})`;
        }
        if (notCached.length) {
          description += ` (skipped not in OCR cache: ${notCached.join(", ")} — re-run full OCR to refresh)`;
        }
        toast({ title: "Pages reprocessed", description, variant: "success" });
      }
    } catch (e: any) {
      toast({
        title: "AI edit failed",
        description: e.response?.data?.detail || e.message,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="AI Edit"
      icon={Stethoscope}
      sectionId="ai-edit"
      defaultOpen={false}
    >
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder='e.g. "doctor is Dr. Bianchi", "reprocess page 41 for lab tests"'
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
            disabled={busy}
          />
          <button
            onClick={submit}
            disabled={busy || !instruction.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
          >
            {busy ? "..." : "Apply"}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Edit metadata, or re-extract specific pages by mentioning them (e.g.
          "page 41", "pages 12-15"). Re-extracting wipes existing labs /
          encounters / medications and re-inserts from the chosen pages.
        </p>
      </div>
    </Section>
  );
}
