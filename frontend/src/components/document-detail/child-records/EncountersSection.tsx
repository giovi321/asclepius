import { useMemo, useRef, useState } from "react";
import api from "@/api/client";
import { Stethoscope, Pencil, X, Trash2, Search } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useDiagnoses } from "@/hooks/data";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import Badge from "@/components/ui/Badge";
import {
  Section,
  EditableField,
  ActionButton,
  IconButton,
} from "@/components/document-detail/DocumentDetailHelpers";

/** Heading-style inline editor for an encounter's diagnosis. Uses the
 * encounter PATCH endpoint so the rest of the section stays aligned with
 * the same backend.
 */
function DiagnosisHeading({
  value,
  encounterId,
  onSaved,
}: {
  value: string;
  encounterId: number;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if ((val || "").trim() === (value || "").trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/encounters/${encounterId}`, {
        diagnosis_original: val.trim() || null,
      });
      setEditing(false);
      onSaved();
    } catch {
      toast({ title: "Failed to save", variant: "error" });
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await api.patch(`/encounters/${encounterId}`, {
        diagnosis_original: null,
      });
      setEditing(false);
      setVal("");
      onSaved();
    } catch {
      toast({ title: "Failed to delete", variant: "error" });
    }
    setSaving(false);
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
              setVal(value || "");
            }
          }}
          className="flex-1 h-7 rounded border bg-background px-2 text-base font-semibold"
          autoFocus
          disabled={saving}
        />
        <ActionButton onClick={handleSave} disabled={saving} variant="primary">
          {saving ? "..." : "Save"}
        </ActionButton>
        {value && (
          <ActionButton
            onClick={handleDelete}
            disabled={saving}
            variant="danger"
            title="Delete the saved diagnosis"
          >
            Delete
          </ActionButton>
        )}
        <IconButton
          label="Close"
          onClick={() => {
            setEditing(false);
            setVal(value || "");
          }}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setVal(value || "");
        setEditing(true);
      }}
      className="group flex w-full items-center gap-2 text-left rounded px-1 -mx-1 hover:bg-accent/30"
    >
      <span className="flex-1 text-base font-semibold truncate">
        {value || (
          <span className="text-muted-foreground italic font-normal">
            No diagnosis — click to add
          </span>
        )}
      </span>
      <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0" />
    </button>
  );
}

/** Searchable ICD-10 picker. Backed by the /normalization/diagnoses
 * list — each canonical row carries an ``icd10_code`` field, which is
 * what we save to ``encounters.diagnosis_code``. The display name from
 * the matching diagnosis row gives the user a recognisable preview.
 */
function IcdCodeSelect({
  value,
  encounterId,
  onSaved,
}: {
  value: string | null;
  encounterId: number;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const diagnoses = useDiagnoses();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Map the current value back to a diagnosis row (if any) for the
  // display label. Falls back to just the raw code when the user typed
  // a code we don't have in norm_diagnoses.
  const options = (
    Array.isArray(diagnoses.data) ? diagnoses.data : []
  ) as any[];
  const codedOptions = useMemo(
    () => options.filter((o: any) => (o.icd10_code || "").trim()),
    [options],
  );
  const currentRow = value
    ? codedOptions.find(
        (o: any) => (o.icd10_code || "").toLowerCase() === value.toLowerCase(),
      )
    : null;

  useOnClickOutside(
    rootRef,
    () => {
      setEditing(false);
      setQuery("");
    },
    editing,
  );

  const save = async (code: string | null) => {
    setSaving(true);
    try {
      await api.patch(`/encounters/${encounterId}`, { diagnosis_code: code });
      setEditing(false);
      setQuery("");
      onSaved();
    } catch {
      toast({ title: "Failed to save", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? codedOptions.filter((o: any) => {
        const code = (o.icd10_code || "").toLowerCase();
        const name = (o.canonical_display || "").toLowerCase();
        return code.includes(q) || name.includes(q);
      })
    : codedOptions.slice(0, 50);

  if (editing) {
    return (
      <div ref={rootRef} className="relative w-72 max-w-full">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditing(false);
                  setQuery("");
                }
                if (e.key === "Enter" && filtered.length === 1) {
                  save(filtered[0].icd10_code);
                }
              }}
              placeholder="Search ICD-10 code or diagnosis..."
              className="w-full h-7 rounded border bg-background pl-7 pr-2 text-sm"
              autoFocus
              disabled={saving}
            />
          </div>
          {value && (
            <ActionButton
              onClick={() => save(null)}
              disabled={saving}
              variant="danger"
              title="Delete the saved ICD-10 code"
            >
              Delete
            </ActionButton>
          )}
          <IconButton
            label="Close"
            onClick={() => {
              setEditing(false);
              setQuery("");
            }}
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-background shadow-lg">
          {diagnoses.loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No matching ICD-10 codes.
            </div>
          ) : (
            filtered.map((opt: any) => {
              const isCurrent =
                value &&
                (opt.icd10_code || "").toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={opt.id}
                  onClick={() => save(opt.icd10_code)}
                  disabled={saving}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent ${isCurrent ? "bg-accent/40" : ""}`}
                >
                  <span className="font-mono text-[11px] text-primary flex-shrink-0">
                    {opt.icd10_code}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {opt.canonical_display}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // Pill view: compact monospace badge that triggers the search panel.
  // Empty state shows a discreet "+ ICD-10" affordance.
  const tooltip = currentRow?.canonical_display || undefined;
  return (
    <button
      onClick={() => {
        setQuery("");
        setEditing(true);
      }}
      title={tooltip}
      className={
        value
          ? "inline-flex items-center rounded-md bg-primary/10 px-2 h-6 font-mono text-xs font-medium text-primary hover:bg-primary/15"
          : "inline-flex items-center rounded-md border border-dashed px-2 h-6 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      }
    >
      {value || "+ ICD-10"}
    </button>
  );
}

export function EncountersSection({
  encounters,
  onUpdated,
}: {
  encounters: any[];
  onUpdated?: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  if (!encounters?.length) return null;

  const handleDelete = async (encId: number) => {
    const ok = await confirm({
      title: "Delete this encounter?",
      description:
        "The encounter row will be removed. The parent document is left untouched.",
      variant: "destructive",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await api.delete(`/encounters/${encId}`);
      onUpdated?.();
    } catch {
      toast({ title: "Failed to delete", variant: "error" });
    }
  };

  return (
    <Section
      title="Encounters"
      icon={Stethoscope}
      sectionId="encounters"
      defaultOpen={!isMobile}
      headerExtra={<Badge size="sm">{encounters.length}</Badge>}
    >
      {encounters.map((enc, i) => (
        <div key={enc.id} className={i > 0 ? "pt-4 mt-4 border-t" : ""}>
          {/* Three-tier card: headline (diagnosis + ICD pill + delete) →
              body (details). The pill keeps clinical metadata on the
              same row as the headline so the eye parses one unit, not
              three competing label/value rows. */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <DiagnosisHeading
                value={enc.diagnosis_original || ""}
                encounterId={enc.id}
                onSaved={onUpdated || (() => {})}
              />
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <IcdCodeSelect
                value={enc.diagnosis_code || null}
                encounterId={enc.id}
                onSaved={onUpdated || (() => {})}
              />
              <IconButton
                label="Delete encounter"
                onClick={() => handleDelete(enc.id)}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
          <div className="mt-2 pl-3 border-l-2 border-muted">
            <EditableField
              label="Details"
              value={enc.notes || ""}
              field="notes"
              docId={enc.id}
              apiPath={`/encounters/${enc.id}`}
              onSave={onUpdated || (() => {})}
              multiline
            />
          </div>
        </div>
      ))}
    </Section>
  );
}
