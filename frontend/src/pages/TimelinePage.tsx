import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Loader2 } from "lucide-react";

interface TimelineDoc {
  id: number;
  doc_type: string;
  doc_date: string | null;
  date_visit: string | null;
  date_issued: string | null;
  original_filename: string;
  doctor_name: string | null;
  facility_name: string | null;
  summary_en: string | null;
}

const DOC_TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  // Clinical
  specialist_report: { bg: "bg-primary/15", text: "text-primary", label: "Specialist Report" },
  discharge: { bg: "bg-primary/15", text: "text-primary", label: "Discharge" },
  er_report: { bg: "bg-primary/15", text: "text-primary", label: "ER Report" },
  surgical_report: { bg: "bg-primary/15", text: "text-primary", label: "Surgical Report" },
  // Lab
  bloodtest: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Blood Test" },
  labtest_other: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Lab Test" },
  // Financial
  invoice: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", label: "Invoice" },
  receipt: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", label: "Receipt" },
  insurance_claim: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", label: "Insurance Claim" },
  // Imaging
  radiology_report: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", label: "Radiology Report" },
  imaging_dicom: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", label: "DICOM" },
  imaging_other: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", label: "Imaging" },
  // Medications
  prescription: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", label: "Prescription" },
};

function getTypeStyle(docType: string) {
  return DOC_TYPE_COLORS[docType] || {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-700 dark:text-gray-300",
    label: docType?.replace(/_/g, " ") || "Unknown",
  };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "No date";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function getYear(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  return dateStr.substring(0, 4);
}

export default function TimelinePage() {
  const { selectedPatient } = usePatient();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<TimelineDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, any> = { limit: 500 };
    if (selectedPatient) params.patient_id = selectedPatient.id;
    api
      .get("/documents", { params })
      .then((res) => {
        const items: TimelineDoc[] = res.data.items || [];
        // Sort by best date descending (newest first)
        const bestDate = (d: TimelineDoc) => d.date_visit || d.date_issued || d.doc_date || "";
        items.sort((a, b) => {
          const da = bestDate(a);
          const db = bestDate(b);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return db.localeCompare(da);
        });
        setDocuments(items);
      })
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [selectedPatient]);

  // No longer requires patient selection — shows all documents or filtered by patient

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Group documents by year
  const grouped: Record<string, TimelineDoc[]> = {};
  for (const doc of documents) {
    const year = getYear(doc.date_visit || doc.date_issued || doc.doc_date);
    if (!grouped[year]) grouped[year] = [];
    grouped[year].push(doc);
  }

  // Sort years descending
  const years = Object.keys(grouped).sort((a, b) => {
    if (a === "Unknown") return 1;
    if (b === "Unknown") return -1;
    return b.localeCompare(a);
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Timeline</h1>

      {documents.length === 0 ? (
        <p className="text-muted-foreground">No documents found for this patient.</p>
      ) : (
        <div className="relative ml-4">
          {/* Vertical timeline line */}
          <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />

          {years.map((year) => (
            <div key={year} className="mb-8">
              {/* Year header */}
              <div className="relative mb-4 flex items-center">
                <div className="z-10 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {year === "Unknown" ? "?" : year.slice(2)}
                </div>
                <span className="ml-3 text-lg font-semibold">{year}</span>
              </div>

              {/* Documents in this year */}
              {grouped[year].map((doc) => {
                const style = getTypeStyle(doc.doc_type);
                return (
                  <div key={doc.id} className="relative mb-3 ml-4 pl-8">
                    {/* Dot on timeline */}
                    <div className="absolute -left-[13px] top-4 h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground" />

                    {/* Card */}
                    <button
                      onClick={() => navigate(`/documents/${doc.id}`)}
                      className="w-full rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-medium">
                          {formatDate(doc.date_visit || doc.date_issued || doc.doc_date)}
                        </span>
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                        >
                          {style.label}
                        </span>
                      </div>

                      <p className="text-sm font-medium truncate">
                        {doc.original_filename}
                      </p>

                      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                        {doc.doctor_name && <span>Dr. {doc.doctor_name}</span>}
                        {doc.facility_name && <span>{doc.facility_name}</span>}
                      </div>

                      {doc.summary_en && (
                        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                          {doc.summary_en}
                        </p>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
