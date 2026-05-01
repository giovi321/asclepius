import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import shareApi from "@/api/shareClient";
import ShareDocumentViewer from "@/components/share/ShareDocumentViewer";
import ShareTranslateMenu from "@/components/share/ShareTranslateMenu";

interface ShareDocumentDetail {
  id: number;
  doc_type: string | null;
  event_date: string | null;
  issued_date: string | null;
  date_received: string | null;
  doctor_name: string | null;
  facility_name: string | null;
  specialty_display: string | null;
  summary_en: string | null;
  summary_original: string | null;
  notes: string | null;
  language_source: string | null;
  ocr_text: string | null;
  ocr_text_en: string | null;
  page_count: number | null;
  original_filename: string | null;
  lab_results: any[];
  medications: any[];
  vaccinations: any[];
  region_translations: any[];
}

/**
 * Read-only document detail for the doctor share view.
 *
 * Reuses the backend's normal record shape so the same fields drive both
 * the admin and doctor sides — but the JSX deliberately renders no edit
 * affordances. The PDF/image is fetched via shareApi (cookie-bound) by
 * the ShareDocumentViewer, which never exposes a downloadable URL.
 */
export default function ShareDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const docId = id ? parseInt(id, 10) : 0;
  const [doc, setDoc] = useState<ShareDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await shareApi.get<ShareDocumentDetail>(
        `/documents/${docId}`,
      );
      setDoc(res.data);
      setError(null);
    } catch (err: any) {
      const status = err?.response?.status;
      setError(
        status === 404
          ? "Document not available in this share."
          : "Failed to load document.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!docId) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  if (loading)
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (error || !doc) {
    return (
      <div className="min-h-screen bg-muted/30">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <Link
            to="/share/dashboard"
            className="inline-flex items-center gap-1 text-sm hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to documents
          </Link>
          <p className="mt-6 text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            to="/share/dashboard"
            className="inline-flex items-center gap-1.5 text-sm hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="text-xs text-muted-foreground">Read-only view</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <ShareDocumentViewer documentId={doc.id} />
        </section>

        <section className="space-y-6">
          <div>
            <h1 className="text-lg font-semibold">
              {doc.original_filename || doc.doc_type || "Document"}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {doc.doc_type && <span>{doc.doc_type}</span>}
              {doc.event_date && <span>Event: {doc.event_date}</span>}
              {doc.issued_date && <span>Issued: {doc.issued_date}</span>}
              {doc.specialty_display && <span>{doc.specialty_display}</span>}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {doc.doctor_name && <>Dr. {doc.doctor_name}</>}
              {doc.doctor_name && doc.facility_name ? " · " : ""}
              {doc.facility_name}
            </div>
          </div>

          {doc.summary_en && (
            <div>
              <h2 className="text-sm font-semibold mb-1">Summary (English)</h2>
              <p className="text-sm whitespace-pre-wrap">{doc.summary_en}</p>
            </div>
          )}

          {doc.summary_original && (
            <div>
              <h2 className="text-sm font-semibold mb-1">
                Summary (original
                {doc.language_source ? ` · ${doc.language_source}` : ""})
              </h2>
              <p className="text-sm whitespace-pre-wrap">
                {doc.summary_original}
              </p>
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold mb-2">Translation</h2>
            <ShareTranslateMenu
              documentId={doc.id}
              hasOcrText={!!doc.ocr_text}
              onQueued={refresh}
            />
            {doc.ocr_text_en && (
              <details className="mt-3 rounded-md border bg-card">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                  English translation
                </summary>
                <div className="border-t p-3 text-sm whitespace-pre-wrap">
                  {doc.ocr_text_en}
                </div>
              </details>
            )}
          </div>

          {doc.lab_results && doc.lab_results.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Lab results</h2>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2">Test</th>
                      <th className="text-left px-3 py-2">Value</th>
                      <th className="text-left px-3 py-2">Unit</th>
                      <th className="text-left px-3 py-2">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {doc.lab_results.map((lr: any) => (
                      <tr
                        key={lr.id}
                        className={lr.is_abnormal ? "bg-amber-50/40" : ""}
                      >
                        <td className="px-3 py-1.5">
                          {lr.test_name_canonical || lr.test_name_original}
                        </td>
                        <td className="px-3 py-1.5 font-mono">
                          {lr.value ?? lr.value_text ?? ""}
                        </td>
                        <td className="px-3 py-1.5">{lr.unit || ""}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          {lr.reference_range_low != null ||
                          lr.reference_range_high != null
                            ? `${lr.reference_range_low ?? ""} - ${lr.reference_range_high ?? ""}`
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {doc.medications && doc.medications.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Medications</h2>
              <ul className="space-y-1 text-sm">
                {doc.medications.map((m: any) => (
                  <li key={m.id} className="flex flex-wrap gap-x-3">
                    <span className="font-medium">
                      {m.medication_canonical_display ||
                        m.brand_name ||
                        m.active_ingredient_original}
                    </span>
                    {m.dosage && <span>{m.dosage}</span>}
                    {m.frequency && (
                      <span className="text-muted-foreground">
                        {m.frequency}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {doc.vaccinations && doc.vaccinations.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Vaccinations</h2>
              <ul className="space-y-1 text-sm">
                {doc.vaccinations.map((v: any) => (
                  <li key={v.id}>
                    {v.vaccine_name}
                    {v.date_administered ? ` · ${v.date_administered}` : ""}
                    {v.manufacturer ? ` · ${v.manufacturer}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {doc.notes && (
            <div>
              <h2 className="text-sm font-semibold mb-1">Notes</h2>
              <p className="text-sm whitespace-pre-wrap">{doc.notes}</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
