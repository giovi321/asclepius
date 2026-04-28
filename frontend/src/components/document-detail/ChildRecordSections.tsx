import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import { Pill, Stethoscope, Syringe, Image as ImageIcon, FileImage, Pencil, X } from "lucide-react";
import DicomViewer from "@/components/DicomViewer";
import { useToast } from "@/contexts/ToastContext";
import {
  Section, InfoRow, EditableField, EditableSelect, MedFormBadge, getSectionTypeStyle,
} from "@/components/document-detail/DocumentDetailHelpers";

/** Heading-style inline editor for an encounter's diagnosis. Uses the
 * encounter PATCH endpoint so the rest of the section stays aligned with
 * the same backend.
 */
function DiagnosisHeading({ value, encounterId, onSaved }: {
  value: string; encounterId: number; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if ((val || "").trim() === (value || "").trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      await api.patch(`/encounters/${encounterId}`, { diagnosis_original: val.trim() || null });
      setEditing(false);
      onSaved();
    } catch { toast({ title: "Failed to save", variant: "error" }); }
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
            if (e.key === "Escape") { setEditing(false); setVal(value || ""); }
          }}
          className="flex-1 rounded border bg-background px-2 py-1 text-base font-semibold"
          autoFocus
          disabled={saving}
        />
        <button onClick={handleSave} disabled={saving}
          className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">
          {saving ? "..." : "OK"}
        </button>
        <button onClick={() => { setEditing(false); setVal(value || ""); }}
          className="rounded border px-2 py-1 text-xs">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setVal(value || ""); setEditing(true); }}
      className="group flex w-full items-center gap-2 text-left rounded px-1 -mx-1 hover:bg-accent/30"
    >
      <span className="flex-1 text-base font-semibold truncate">
        {value || <span className="text-muted-foreground italic font-normal">No diagnosis — click to add</span>}
      </span>
      <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0" />
    </button>
  );
}

// Same DICOM modality → readable label map used in ImagingPage. Keeping
// it co-located with the section avoids a dependency on the imaging page.
const MODALITY_LABELS: Record<string, string> = {
  CT: "CT scan", MR: "MRI", US: "Ultrasound", XR: "X-ray", CR: "X-ray (computed)",
  DX: "X-ray (digital)", MG: "Mammography", PT: "PET", NM: "Nuclear medicine",
  RF: "Fluoroscopy", OT: "Other",
};
const modalityLabel = (code: string | null | undefined) =>
  !code ? "Unknown" : (MODALITY_LABELS[code.toUpperCase()] || code);
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

export function EncountersSection({ encounters, onUpdated }: { encounters: any[]; onUpdated?: () => void }) {
  if (!encounters?.length) return null;
  return (
    <Section title="Encounters" icon={Stethoscope}>
      {encounters.map((enc, i) => (
        <div key={enc.id} className={`space-y-1 ${i > 0 ? "pt-3 mt-3 border-t" : ""}`}>
          {/* Diagnosis is the encounter's headline — render larger than the
              metadata rows so it's visually distinct. The other fields below
              use EditableField rows. */}
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Diagnosis</p>
          <DiagnosisHeading
            value={enc.diagnosis_original || ""}
            encounterId={enc.id}
            onSaved={onUpdated || (() => {})}
          />
          <EditableField
            label="ICD-10"
            value={enc.diagnosis_code || ""}
            field="diagnosis_code"
            docId={enc.id}
            apiPath={`/encounters/${enc.id}`}
            onSave={onUpdated || (() => {})}
          />
          <EditableField
            label="Specialty"
            value={enc.specialty_canonical_display || enc.specialty_original || ""}
            field="specialty_original"
            docId={enc.id}
            apiPath={`/encounters/${enc.id}`}
            onSave={onUpdated || (() => {})}
          />
          <EditableField
            label="Findings"
            value={enc.findings || ""}
            field="findings"
            docId={enc.id}
            apiPath={`/encounters/${enc.id}`}
            onSave={onUpdated || (() => {})}
            multiline
          />
          <EditableField
            label="Notes"
            value={enc.notes || ""}
            field="notes"
            docId={enc.id}
            apiPath={`/encounters/${enc.id}`}
            onSave={onUpdated || (() => {})}
            multiline
          />
        </div>
      ))}
    </Section>
  );
}

export function MedicationsSection({ medications, onUpdated }: { medications: any[]; onUpdated?: () => void }) {
  if (!medications?.length) return null;
  // The medications block was previously a static table. Inline editing per-
  // row matches the encounters / imaging pattern: each field is an
  // EditableField backed by /api/medications/{id}.
  return (
    <Section title="Medications" icon={Pill}>
      {medications.map((med, i) => (
        <div key={med.id} className={`space-y-1 ${i > 0 ? "pt-3 mt-3 border-t" : ""}`}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold flex-1 truncate">
              {med.active_ingredient_original || med.brand_name || "Medication"}
            </span>
            <MedFormBadge form={med.form} />
          </div>
          <EditableField
            label="Active ingredient"
            value={med.active_ingredient_original || ""}
            field="active_ingredient_original"
            docId={med.id}
            apiPath={`/medications/${med.id}`}
            onSave={onUpdated || (() => {})}
          />
          <EditableField
            label="Brand"
            value={med.brand_name || ""}
            field="brand_name"
            docId={med.id}
            apiPath={`/medications/${med.id}`}
            onSave={onUpdated || (() => {})}
          />
          <EditableField
            label="Dosage"
            value={med.dosage || ""}
            field="dosage"
            docId={med.id}
            apiPath={`/medications/${med.id}`}
            onSave={onUpdated || (() => {})}
          />
          <EditableField
            label="Form"
            value={med.form || ""}
            field="form"
            docId={med.id}
            apiPath={`/medications/${med.id}`}
            onSave={onUpdated || (() => {})}
          />
          <EditableField
            label="Frequency"
            value={med.frequency || ""}
            field="frequency"
            docId={med.id}
            apiPath={`/medications/${med.id}`}
            onSave={onUpdated || (() => {})}
          />
          <EditableField
            label="Duration"
            value={med.duration || ""}
            field="duration"
            docId={med.id}
            apiPath={`/medications/${med.id}`}
            onSave={onUpdated || (() => {})}
          />
          <EditableField
            label="Quantity"
            value={med.quantity || ""}
            field="quantity"
            docId={med.id}
            apiPath={`/medications/${med.id}`}
            onSave={onUpdated || (() => {})}
          />
        </div>
      ))}
    </Section>
  );
}

export function VaccinationsSection({ vaccinations }: { vaccinations: any[] }) {
  if (!vaccinations?.length) return null;
  return (
    <Section title="Vaccinations" icon={Syringe}>
      {vaccinations.map((vax) => (
        <div key={vax.id} className="text-sm">
          <span className="font-medium">{vax.vaccine_name}</span>
          {vax.date_administered && <span className="text-muted-foreground"> \u2014 {vax.date_administered}</span>}
          {vax.dose_number && <span className="text-muted-foreground"> (dose {vax.dose_number})</span>}
        </div>
      ))}
    </Section>
  );
}

export function DocumentSectionsList({ sections }: { sections: any[] }) {
  if (!sections?.length) return null;
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 font-medium">Document Sections ({sections.length})</h3>
      <div className="space-y-2">
        {sections.map((section) => (
          <div key={section.id} className="flex items-center gap-3 text-sm rounded-md border p-2">
            <span className="text-xs text-muted-foreground w-16">
              pp. {section.page_start}{"\u2013"}{section.page_end}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getSectionTypeStyle(section.section_type)}`}>
              {section.section_type?.replace(/_/g, " ")}
            </span>
            {section.summary_en && (
              <span className="flex-1 text-xs text-muted-foreground truncate">{section.summary_en}</span>
            )}
          </div>
        ))}
      </div>
    </div>
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
export function ImagingStudiesSection({ studies, onUpdated }: { studies: any[]; onUpdated?: () => void }) {
  if (!studies?.length) return null;
  return (
    <>
      {studies.map((study) => (
        <ImagingStudyBlock key={study.id} study={study} onUpdated={onUpdated} />
      ))}
    </>
  );
}

function ImagingStudyBlock({ study, onUpdated }: { study: any; onUpdated?: () => void }) {
  const navigate = useNavigate();
  const series = study.series || [];
  const [activeSeriesId, setActiveSeriesId] = useState<number | null>(
    series.length > 0 ? series[0].id : null,
  );
  const [bundleFiles, setBundleFiles] = useState<{ name: string; size: number; kind: string }[]>([]);
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/imaging/${study.id}/bundle-files`).then((r) => {
      setBundleFiles(r.data.items || []);
    }).catch(() => setBundleFiles([]));
    api.get(`/imaging/${study.id}/links`).then((r) => {
      setLinkedDocs(r.data.items || []);
    }).catch(() => setLinkedDocs([]));
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
    <Section title="Imaging" icon={ImageIcon}>
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
      <InfoRow label="Study UID" value={study.study_instance_uid || "Unknown"} />
      <InfoRow label="Series" value={`${study.num_series ?? series.length} | ${study.num_images} images`} />

      {series.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground mt-2">Series</p>
          {series.map((s: any, idx: number) => (
            <button
              key={s.id}
              onClick={() => setActiveSeriesId(s.id)}
              className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent/50 ${
                activeSeriesId === s.id ? "border-primary bg-primary/5" : ""
              }`}
            >
              <span className="truncate">
                Series {s.series_number ?? idx + 1}: {niceCase(s.series_description) || s.modality || "Untitled"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{s.num_images} images</span>
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
          <p className="text-xs font-medium text-muted-foreground mt-3 mb-1">Linked documents</p>
          <ul className="space-y-1">
            {linkedDocs.map((d) => (
              <li
                // The "report" entry is synthetic (no link_id). Build a
                // composite key so it doesn't collide with real links.
                key={d.link_type === "report" ? `report-${d.id}` : `link-${d.link_id}`}
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
                  <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{d.doc_type}</span>
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
