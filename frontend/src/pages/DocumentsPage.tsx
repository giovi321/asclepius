import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { FileText, Search } from "lucide-react";

const DOC_TYPES = [
  "bloodtest", "labtest_other", "prescription", "invoice", "receipt",
  "insurance_claim", "referral", "discharge", "specialist_report",
  "radiology_report", "surgical_report", "vaccination", "other",
];

export default function DocumentsPage() {
  const { selectedPatient } = usePatient();
  const [documents, setDocuments] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    const params: Record<string, any> = { limit, offset: page * limit };
    if (selectedPatient) params.patient_id = selectedPatient.id;
    if (search) params.q = search;
    if (typeFilter) params.type = typeFilter;

    api.get("/documents", { params }).then((res) => {
      setDocuments(res.data.items || []);
      setTotal(res.data.total || 0);
      setLoading(false);
    });
  }, [selectedPatient, search, typeFilter, page]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Documents</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">File</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Patient</th>
              <th className="px-4 py-2 text-left font-medium">Provider</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Loading...</td></tr>
            ) : documents.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No documents found</td></tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-accent/50">
                  <td className="px-4 py-2">
                    <Link to={`/documents/${doc.id}`} className="flex items-center gap-2 text-primary hover:underline">
                      <FileText className="h-4 w-4" />
                      <span className="max-w-[200px] truncate">{doc.original_filename}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{doc.doc_type?.replace(/_/g, " ") || "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{doc.doc_date || "—"}</td>
                  <td className="px-4 py-2">{doc.patient_name || <span className="text-yellow-600">Unclassified</span>}</td>
                  <td className="px-4 py-2 text-muted-foreground">{doc.provider_name || "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      doc.status === "done" ? "bg-green-100 text-green-700" :
                      doc.status === "failed" ? "bg-red-100 text-red-700" :
                      doc.status === "needs_review" ? "bg-yellow-100 text-yellow-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>{doc.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >Previous</button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * limit >= total}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
