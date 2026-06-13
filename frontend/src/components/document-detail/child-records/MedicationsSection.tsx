import { useRef, useState } from "react";
import api from "@/api/client";
import { Pill, Trash2, Plus } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import {
  Section,
  EditableField,
  MedFormBadge,
} from "@/components/document-detail/DocumentDetailHelpers";

/** Schema for the medication editor: each entry binds a label to a DB
 * column. ``active_ingredient_original`` is the headline so it always
 * shows; the rest are gated on (a) having a value or (b) the user
 * having explicitly added them via the "+" menu. */
const MED_FIELDS: Array<{ key: string; label: string }> = [
  { key: "active_ingredient_original", label: "Active ingredient" },
  { key: "brand_name", label: "Brand" },
  { key: "dosage", label: "Dosage" },
  { key: "form", label: "Form" },
  { key: "frequency", label: "Frequency" },
  { key: "duration", label: "Duration" },
  { key: "quantity", label: "Quantity" },
];

function MedicationRow({
  med,
  onUpdated,
  onDelete,
}: {
  med: any;
  onUpdated: () => void;
  onDelete: () => void;
}) {
  // Fields that have any DB value are always shown. The "+" menu only
  // surfaces the rest, and once a user picks one we keep it visible
  // even before they save anything so they can type into it.
  const hasValue = (k: string) => {
    const v = med[k];
    return v !== null && v !== undefined && String(v).trim() !== "";
  };
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(pickerRef, () => setPickerOpen(false), pickerOpen);

  const visible = MED_FIELDS.filter(
    (f) => hasValue(f.key) || revealed.has(f.key),
  );
  const hidden = MED_FIELDS.filter(
    (f) => !hasValue(f.key) && !revealed.has(f.key),
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold flex-1 truncate">
          {med.active_ingredient_original || med.brand_name || "Medication"}
        </span>
        <MedFormBadge form={med.form} />
        <button
          onClick={onDelete}
          className="rounded border p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
          title="Delete medication"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {visible.map((f) => (
        <EditableField
          key={f.key}
          label={f.label}
          value={med[f.key] || ""}
          field={f.key}
          docId={med.id}
          apiPath={`/medications/${med.id}`}
          onSave={onUpdated}
        />
      ))}
      {hidden.length > 0 && (
        <div ref={pickerRef} className="relative pt-0.5">
          <button
            onClick={() => setPickerOpen(!pickerOpen)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <Plus className="h-3 w-3" />
            Add field
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 min-w-[160px] rounded-md border bg-background shadow-lg">
              {hidden.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    setRevealed((prev) => new Set(prev).add(f.key));
                    setPickerOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MedicationsSection({
  medications,
  onUpdated,
}: {
  medications: any[];
  onUpdated?: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  if (!medications?.length) return null;

  const handleDelete = async (medId: number) => {
    const ok = await confirm({
      title: "Delete this medication?",
      description:
        "The medication row will be removed. The parent document is left untouched.",
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await api.delete(`/medications/${medId}`);
      onUpdated?.();
    } catch {
      toast({ title: "Failed to delete", variant: "error" });
    }
  };

  return (
    <Section title="Medications" icon={Pill} sectionId="medications">
      {medications.map((med, i) => (
        <div key={med.id} className={i > 0 ? "pt-3 mt-3 border-t" : ""}>
          <MedicationRow
            med={med}
            onUpdated={onUpdated || (() => {})}
            onDelete={() => handleDelete(med.id)}
          />
        </div>
      ))}
    </Section>
  );
}
