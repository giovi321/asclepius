import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import { Pill, Stethoscope, Syringe, Image as ImageIcon, FileImage } from "lucide-react";
import DicomViewer from "@/components/DicomViewer";
import {
  Section, InfoRow, MedFormBadge, getSectionTypeStyle,
} from "@/components/document-detail/DocumentDetailHelpers";

// Same DICOM modality → readable label map used in ImagingPage. Keeping
// it co-located with the section avoids a dependency on the imaging page.
const MODALITY_LABELS: Record<string, string> = {
  CT: "CT scan", MR: "MRI", US: "Ultrasound", XR: "X-ray", CR: "X-ray (computed)",
  DX: "X-ray (digital)", MG: "Mammography", PT: "PET", NM: "Nuclear medicine",
  RF: "Fluoroscopy", OT: "Other",
};
const modalityLabel = (code: string | null | undefined) =>
  !code ? "Unknown" : (MODALITY_LABELS[code.toUpperCase()] || code);

export function EncountersSection({ encounters }: { encounters: any[] }) {
  if (!encounters?.length) return null;
  return (
    <Section title="Encounters" icon={Stethoscope}>
      {encounters.map((enc) => (
        <div key={enc.id} className="space-y-1 text-sm">
          <InfoRow label="Date" value={enc.encounter_date} />
          <InfoRow label="Diagnosis" value={enc.diagnosis_original} />
          <InfoRow label="ICD-10" value={enc.diagnosis_code} />
          {enc.findings && <p className="text-muted-foreground">{enc.findings}</p>}
          {enc.notes && <p className="text-muted-foreground">{enc.notes}</p>}
        </div>
      ))}
    </Section>
  );
}

export function MedicationsSection({ medications }: { medications: any[] }) {
  if (!medications?.length) return null;
  return (
    <Section title="Medications" icon={Pill}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1 pr-2 text-left font-medium">Medication</th>
              <th className="py-1 pr-2 text-left font-medium">Dosage</th>
              <th className="py-1 pr-2 text-left font-medium">Form</th>
              <th className="py-1 pr-2 text-left font-medium">Frequency</th>
              <th className="py-1 pr-2 text-left font-medium">Duration</th>
              <th className="py-1 pr-2 text-left font-medium">Qty</th>
              <th className="py-1 text-left font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {medications.map((med) => (
              <tr key={med.id}>
                <td className="py-1 pr-2 font-medium">
                  {med.active_ingredient_original || med.brand_name || "\u2014"}
                </td>
                <td className="py-1 pr-2 text-muted-foreground">{med.dosage || "\u2014"}</td>
                <td className="py-1 pr-2">
                  <MedFormBadge form={med.form} />
                </td>
                <td className="py-1 pr-2 text-muted-foreground">{med.frequency || "\u2014"}</td>
                <td className="py-1 pr-2 text-muted-foreground">{med.duration || "\u2014"}</td>
                <td className="py-1 pr-2 text-muted-foreground">{med.quantity || "\u2014"}</td>
                <td className="py-1 text-muted-foreground">{med.date_prescribed || med.start_date || "\u2014"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
 * DICOM bundle, and surfaces the imaging-specific fields (modality, body
 * part, study date, institution, referring physician, accession number,
 * StudyInstanceUID), the series breakdown, the embedded DICOM frame
 * viewer, and the auxiliary bundle files (DICOMDIR, JPEG previews, etc.)
 * that were extracted from the same zip.
 */
export function ImagingStudiesSection({ studies }: { studies: any[] }) {
  if (!studies?.length) return null;
  return (
    <>
      {studies.map((study) => (
        <ImagingStudyBlock key={study.id} study={study} />
      ))}
    </>
  );
}

function ImagingStudyBlock({ study }: { study: any }) {
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

  return (
    <Section title="Imaging" icon={ImageIcon}>
      {/* Doctor + Facility are NOT shown here — they live on the parent
          documents row (rendered by MetadataEditor) which is the single
          source of truth. The imaging-specific block only carries fields
          that are unique to imaging studies. */}
      <InfoRow label="Type" value={`${modalityLabel(study.modality)}${study.modality ? ` (${study.modality})` : ""}`} />
      <InfoRow label="Body Part" value={study.body_part || "Unknown"} />
      <InfoRow label="Study Date" value={study.study_date || "Unknown"} />
      <InfoRow label="Accession" value={study.accession_number || "Unknown"} />
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
                Series {s.series_number ?? idx + 1}: {s.series_description || s.modality || "Untitled"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{s.num_images} images</span>
            </button>
          ))}
        </div>
      )}

      {activeSeriesId != null && (
        <div className="rounded-md border overflow-hidden h-[500px] mt-2">
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
              <li key={d.link_id} className="flex items-center justify-between text-sm">
                <button
                  onClick={() => navigate(`/documents/${d.id}`)}
                  className="truncate hover:underline text-primary text-left"
                >
                  {d.original_filename}
                </button>
                <span className="text-xs text-muted-foreground ml-2">{d.doc_type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bundleFiles.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mt-3 mb-1 flex items-center gap-1.5">
            <FileImage className="h-3.5 w-3.5" />
            Bundle files
          </p>
          <ul className="max-h-40 overflow-y-auto space-y-0.5 text-xs">
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
        </div>
      )}
    </Section>
  );
}
