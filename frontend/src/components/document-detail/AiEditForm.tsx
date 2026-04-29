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
      await api.post(`/documents/${docId}/edit-with-ai`, { instruction });
      setInstruction("");
      await onApplied();
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
            placeholder='e.g. "doctor is Dr. Bianchi", "type is invoice", "date 15/03/2024"'
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
          Tell the AI what to change. Press Enter or click Apply.
        </p>
      </div>
    </Section>
  );
}
