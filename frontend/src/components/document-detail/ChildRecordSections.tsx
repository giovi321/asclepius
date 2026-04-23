import { Pill, Stethoscope, Syringe } from "lucide-react";
import {
  Section, InfoRow, MedFormBadge, getSectionTypeStyle,
} from "@/components/document-detail/DocumentDetailHelpers";

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
