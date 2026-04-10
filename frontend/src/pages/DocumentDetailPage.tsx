import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/api/client";
import { RefreshCw, FileText, TestTube, Pill, Syringe, Stethoscope } from "lucide-react";

export default function DocumentDetailPage() {
  const { id } = useParams();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/documents/${id}`).then((res) => {
      setDoc(res.data);
      setLoading(false);
    });
  }, [id]);

  const handleReprocess = async () => {
    await api.post(`/documents/${id}/reprocess`);
    setLoading(true);
    const res = await api.get(`/documents/${id}`);
    setDoc(res.data);
    setLoading(false);
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!doc) return <div className="text-destructive">Document not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{doc.original_filename}</h1>
          <p className="text-sm text-muted-foreground">
            {doc.doc_type?.replace(/_/g, " ")} | {doc.doc_date || "No date"} | {doc.patient_name || "Unclassified"}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/documents/${id}/file`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <FileText className="h-4 w-4" /> View file
          </a>
          <button
            onClick={handleReprocess}
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" /> Reprocess
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Metadata */}
        <div className="space-y-4">
          <Section title="Document Info">
            <InfoRow label="Status" value={doc.status} />
            <InfoRow label="Type" value={doc.doc_type} />
            <InfoRow label="Date" value={doc.doc_date} />
            <InfoRow label="Provider" value={doc.provider_name} />
            <InfoRow label="Language" value={doc.language_source} />
            <InfoRow label="OCR Engine" value={doc.ocr_engine} />
            <InfoRow label="OCR Confidence" value={doc.ocr_confidence?.toFixed(2)} />
            <InfoRow label="Cost" value={doc.cost_amount ? `${doc.cost_amount} ${doc.cost_currency}` : null} />
          </Section>

          {/* Lab Results */}
          {doc.lab_results?.length > 0 && (
            <Section title="Lab Results" icon={TestTube}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left font-medium">Test</th>
                    <th className="py-1 text-left font-medium">Value</th>
                    <th className="py-1 text-left font-medium">Unit</th>
                    <th className="py-1 text-left font-medium">Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {doc.lab_results.map((lr: any) => (
                    <tr key={lr.id} className={lr.is_abnormal ? "text-red-600" : ""}>
                      <td className="py-1">{lr.test_name_original}</td>
                      <td className="py-1 font-medium">{lr.value ?? lr.value_text ?? "—"}</td>
                      <td className="py-1">{lr.unit || ""}</td>
                      <td className="py-1 text-muted-foreground">
                        {lr.reference_range_low != null && lr.reference_range_high != null
                          ? `${lr.reference_range_low}–${lr.reference_range_high}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Encounters */}
          {doc.encounters?.length > 0 && (
            <Section title="Encounters" icon={Stethoscope}>
              {doc.encounters.map((enc: any) => (
                <div key={enc.id} className="space-y-1 text-sm">
                  <InfoRow label="Date" value={enc.encounter_date} />
                  <InfoRow label="Diagnosis" value={enc.diagnosis_original} />
                  <InfoRow label="ICD-10" value={enc.diagnosis_code} />
                  {enc.findings && <p className="text-muted-foreground">{enc.findings}</p>}
                  {enc.notes && <p className="text-muted-foreground">{enc.notes}</p>}
                </div>
              ))}
            </Section>
          )}

          {/* Medications */}
          {doc.medications?.length > 0 && (
            <Section title="Medications" icon={Pill}>
              {doc.medications.map((med: any) => (
                <div key={med.id} className="text-sm">
                  <span className="font-medium">{med.active_ingredient_original || med.brand_name}</span>
                  {med.dosage && <span className="text-muted-foreground"> {med.dosage}</span>}
                  {med.frequency && <span className="text-muted-foreground"> — {med.frequency}</span>}
                </div>
              ))}
            </Section>
          )}

          {/* Vaccinations */}
          {doc.vaccinations?.length > 0 && (
            <Section title="Vaccinations" icon={Syringe}>
              {doc.vaccinations.map((vax: any) => (
                <div key={vax.id} className="text-sm">
                  <span className="font-medium">{vax.vaccine_name}</span>
                  {vax.date_administered && <span className="text-muted-foreground"> — {vax.date_administered}</span>}
                  {vax.dose_number && <span className="text-muted-foreground"> (dose {vax.dose_number})</span>}
                </div>
              ))}
            </Section>
          )}
        </div>

        {/* OCR Text */}
        <Section title="OCR Text">
          <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs">
            {doc.ocr_text || "No text extracted"}
          </pre>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 flex items-center gap-2 font-medium">
        {Icon && <Icon className="h-4 w-4" />}
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
