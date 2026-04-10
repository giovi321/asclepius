import { useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Search, FileText } from "lucide-react";

export default function SearchPage() {
  const { selectedPatient } = usePatient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);

  const doSearch = async () => {
    if (!query.trim()) return;
    const params: Record<string, any> = { q: query, limit: 50 };
    if (selectedPatient) params.patient_id = selectedPatient.id;

    const res = await api.get("/documents", { params });
    setResults(res.data.items || []);
    setTotal(res.data.total || 0);
    setSearched(true);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Search</h1>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search across all documents, lab results, and notes..."
            className="w-full rounded-md border pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        </div>
        <button
          onClick={doSearch}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          Search
        </button>
      </div>

      {searched && (
        <p className="text-sm text-muted-foreground">
          {total} result{total !== 1 ? "s" : ""} found
        </p>
      )}

      <div className="space-y-2">
        {results.map((doc) => (
          <Link
            key={doc.id}
            to={`/documents/${doc.id}`}
            className="block rounded-lg border p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-medium">{doc.original_filename}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {doc.doc_type?.replace(/_/g, " ")} | {doc.doc_date || "—"} | {doc.patient_name || "Unclassified"}
            </p>
            {doc.ocr_text && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {doc.ocr_text.substring(0, 200)}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
