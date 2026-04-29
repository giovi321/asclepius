import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import {
  Pill,
  Stethoscope,
  Syringe,
  Image as ImageIcon,
  FileImage,
  Pencil,
  X,
  Trash2,
  Plus,
  Search,
} from "lucide-react";
import DicomViewer from "@/components/DicomViewer";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useDiagnoses } from "@/hooks/data";
import {
  Section,
  InfoRow,
  EditableField,
  EditableSelect,
  MedFormBadge,
  getSectionTypeStyle,
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

// Same DICOM modality → readable label map used in ImagingPage. Keeping
// it co-located with the section avoids a dependency on the imaging page.
const MODALITY_LABELS: Record<string, string> = {
  CT: "CT scan",
  MR: "MRI",
  US: "Ultrasound",
  XR: "X-ray",
  CR: "X-ray (computed)",
  DX: "X-ray (digital)",
  MG: "Mammography",
  PT: "PET",
  NM: "Nuclear medicine",
  RF: "Fluoroscopy",
  OT: "Other",
};
const modalityLabel = (code: string | null | undefined) =>
  !code ? "Unknown" : MODALITY_LABELS[code.toUpperCase()] || code;
const MODALITY_CODES = Object.keys(MODALITY_LABELS);

/** DICOM tags routinely arrive in ALL-CAPS (e.g. body_part="ABDOMEN",
 * series_description="T2 AXIAL FLAIR"). Title-case them for display
 * without rewriting the stored value, so editing still shows the raw
 * tag the user can fix.
 */
function niceCase(s: string | null | undefined): string {
  if (!s) return "";
  // Only normalise when the string is mostly upper-case — preserve
  // mixed-case strings the user already curated.
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (!letters) return s;
  const upperRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
  if (upperRatio < 0.7) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
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

  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setEditing(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

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
        <div className="flex items-center gap-1">
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
    <Section title="Encounters" icon={Stethoscope} sectionId="encounters">
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

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

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

export function VaccinationsSection({ vaccinations }: { vaccinations: any[] }) {
  if (!vaccinations?.length) return null;
  return (
    <Section title="Vaccinations" icon={Syringe} sectionId="vaccinations">
      {vaccinations.map((vax) => (
        <div key={vax.id} className="text-sm">
          <span className="font-medium">{vax.vaccine_name}</span>
          {vax.date_administered && (
            <span className="text-muted-foreground">
              {" "}
              \u2014 {vax.date_administered}
            </span>
          )}
          {vax.dose_number && (
            <span className="text-muted-foreground">
              {" "}
              (dose {vax.dose_number})
            </span>
          )}
        </div>
      ))}
    </Section>
  );
}

/** Vision-LLM emits structured DOM-like text ("<div data-bbox=...>") to
 * preserve layout. When the LLM-summarisation step is skipped (>10 sections)
 * the raw markup leaks into ``summary_en``. Strip tags and pull alt /
 * data-label values up so the user sees the semantic description. */
const _ALT_OR_LABEL = /(?:alt|data-label)\s*=\s*"([^"]+)"/gi;
const _HTML_TAG = /<[^>]*>/g;

function cleanSectionSummary(s: string | null | undefined): string {
  if (!s) return "";
  if (!s.includes("<")) return s.trim();
  const semantic: string[] = [];
  for (const m of s.matchAll(_ALT_OR_LABEL)) semantic.push(m[1].trim());
  const stripped = s.replace(_HTML_TAG, " ");
  const combined = (semantic.join(" ") + " " + stripped)
    .replace(/\s+/g, " ")
    .trim();
  return combined.length > 280
    ? combined.slice(0, 280).trimEnd() + "\u2026"
    : combined;
}

export function DocumentSectionsList({ sections }: { sections: any[] }) {
  if (!sections?.length) return null;
  return (
    <Section
      title={`Document Sections (${sections.length})`}
      sectionId="document-sections"
      defaultOpen={false}
    >
      {sections.map((section) => {
        const cleaned = cleanSectionSummary(section.summary_en);
        return (
          <div
            key={section.id}
            className="flex items-center gap-3 text-sm rounded-md border p-2"
          >
            <span className="text-xs text-muted-foreground w-16">
              pp. {section.page_start}
              {"\u2013"}
              {section.page_end}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getSectionTypeStyle(section.section_type)}`}
            >
              {section.section_type?.replace(/_/g, " ")}
            </span>
            {cleaned && (
              <span
                className="flex-1 text-xs text-muted-foreground truncate"
                title={cleaned}
              >
                {cleaned}
              </span>
            )}
          </div>
        );
      })}
    </Section>
  );
}

/**
 * Imaging block on the Document Detail page. Mirrors how lab results are
 * shown for blood-test documents: it only appears when the document is a
 * DICOM bundle. The imaging-specific fields (modality, body_part,
 * accession_number) are now editable inline with the same UX as the
 * MetadataEditor on the documents side; corrections are recorded in
 * ``extraction_corrections`` for the same self-learning loop.
 *
 * Study date is NOT shown here because it lives on the parent
 * ``documents.event_date`` (single source of truth) and is already
 * editable via ``MetadataEditor``.
 */
export function ImagingStudiesSection({
  studies,
  onUpdated,
}: {
  studies: any[];
  onUpdated?: () => void;
}) {
  if (!studies?.length) return null;
  return (
    <>
      {studies.map((study) => (
        <ImagingStudyBlock key={study.id} study={study} onUpdated={onUpdated} />
      ))}
    </>
  );
}

function ImagingStudyBlock({
  study,
  onUpdated,
}: {
  study: any;
  onUpdated?: () => void;
}) {
  const navigate = useNavigate();
  const series = study.series || [];
  const [activeSeriesId, setActiveSeriesId] = useState<number | null>(
    series.length > 0 ? series[0].id : null,
  );
  const [bundleFiles, setBundleFiles] = useState<
    { name: string; size: number; kind: string }[]
  >([]);
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);

  useEffect(() => {
    api
      .get(`/imaging/${study.id}/bundle-files`)
      .then((r) => {
        setBundleFiles(r.data.items || []);
      })
      .catch(() => setBundleFiles([]));
    api
      .get(`/imaging/${study.id}/links`)
      .then((r) => {
        setLinkedDocs(r.data.items || []);
      })
      .catch(() => setLinkedDocs([]));
  }, [study.id]);

  // Save handler used by every editable row in this block. The shared
  // EditableField / EditableSelect components hit the override path
  // ``/api/imaging/{id}/metadata`` instead of their default
  // ``/documents/{docId}`` so changes land on imaging_studies.
  const apiPath = `/imaging/${study.id}/metadata`;
  const handleSaved = () => {
    // Triggers a parent reload so the section re-renders with the new
    // value, mirroring the MetadataEditor flow.
    onUpdated?.();
  };

  return (
    <Section title="Imaging" icon={ImageIcon} sectionId="imaging-study">
      {/* Doctor + Facility + Event Date are NOT shown here — they live
          on the parent documents row (rendered by MetadataEditor) which
          is the single source of truth. The imaging-specific block only
          carries fields that are unique to imaging studies. */}
      <EditableSelect
        label="Type"
        value={study.modality || ""}
        field="modality"
        docId={study.id}
        apiPath={apiPath}
        onSave={handleSaved}
        options={MODALITY_CODES}
        formatLabel={(code) => `${modalityLabel(code)} (${code})`}
      />
      <EditableField
        label="Body Part"
        value={study.body_part || ""}
        field="body_part"
        docId={study.id}
        apiPath={apiPath}
        onSave={handleSaved}
        formatDisplay={niceCase}
      />
      <EditableField
        label="Description"
        value={study.study_description || ""}
        field="study_description"
        docId={study.id}
        apiPath={apiPath}
        onSave={handleSaved}
        formatDisplay={niceCase}
      />
      <EditableField
        label="Accession"
        value={study.accession_number || ""}
        field="accession_number"
        docId={study.id}
        apiPath={apiPath}
        onSave={handleSaved}
      />
      <InfoRow
        label="Study UID"
        value={study.study_instance_uid || "Unknown"}
      />
      <InfoRow
        label="Series"
        value={`${study.num_series ?? series.length} | ${study.num_images} images`}
      />

      {series.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground mt-2">
            Series
          </p>
          {series.map((s: any, idx: number) => (
            <button
              key={s.id}
              onClick={() => setActiveSeriesId(s.id)}
              className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent/50 ${
                activeSeriesId === s.id ? "border-primary bg-primary/5" : ""
              }`}
            >
              <span className="truncate">
                Series {s.series_number ?? idx + 1}:{" "}
                {niceCase(s.series_description) || s.modality || "Untitled"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {s.num_images} images
              </span>
            </button>
          ))}
        </div>
      )}

      {activeSeriesId != null && (
        // 720px gives the viewport enough room (toolbar + optional MR
        // controls + 400px min viewport + slider row). A shorter
        // container clips the slider thumb at the bottom.
        <div className="rounded-md border h-[720px] mt-2 flex flex-col">
          <DicomViewer
            studyId={study.id}
            seriesId={activeSeriesId}
            modality={study.modality || null}
          />
        </div>
      )}

      {linkedDocs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mt-3 mb-1">
            Linked documents
          </p>
          <ul className="space-y-1">
            {linkedDocs.map((d) => (
              <li
                // The "report" entry is synthetic (no link_id). Build a
                // composite key so it doesn't collide with real links.
                key={
                  d.link_type === "report"
                    ? `report-${d.id}`
                    : `link-${d.link_id}`
                }
                className="flex items-center justify-between text-sm gap-2"
              >
                <button
                  onClick={() => navigate(`/documents/${d.id}`)}
                  className="truncate hover:underline text-primary text-left flex-1 min-w-0"
                >
                  {d.original_filename}
                </button>
                {d.link_type === "report" ? (
                  <span className="text-[10px] uppercase tracking-wide rounded-full bg-primary/10 text-primary px-2 py-0.5 flex-shrink-0">
                    Report
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                    {d.doc_type}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {bundleFiles.length > 0 && (
        // Collapsed by default — bundle files are auxiliary
        // (DICOMDIR + JPEG previews) and the user only opens them
        // occasionally. <details> renders a tidy native disclosure.
        <details className="mt-3">
          <summary className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 cursor-pointer hover:text-foreground select-none">
            <FileImage className="h-3.5 w-3.5" />
            Bundle files ({bundleFiles.length})
          </summary>
          <ul className="max-h-40 overflow-y-auto space-y-0.5 text-xs mt-2">
            {bundleFiles.map((f) => (
              <li key={f.name} className="flex items-center justify-between">
                <a
                  href={`/api/imaging/${study.id}/bundle-file/${encodeURI(f.name)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline text-primary"
                >
                  {f.name}
                </a>
                <span className="text-muted-foreground tabular-nums ml-2">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
