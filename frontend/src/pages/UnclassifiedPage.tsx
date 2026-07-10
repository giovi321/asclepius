import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertCircle } from "lucide-react";
import Select from "@/components/ui/Select";
import { formatDocType, getBestDate } from "@/lib/utils";

export default function UnclassifiedPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const patients = user?.patients || [];

  useEffect(() => {
    // Fetch documents with no patient assigned
    api.get("/documents", { params: { limit: 100 } }).then((res) => {
      const unclassified = (res.data.items || []).filter(
        (d: any) => !d.patient_id,
      );
      setDocuments(unclassified);
      setLoading(false);
    });
  }, []);

  const assignPatient = async (docId: number, patientId: number) => {
    await api.patch(`/documents/${docId}`, { patient_id: patientId });
    setDocuments((docs) => docs.filter((d) => d.id !== docId));
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <AlertCircle className="h-4 w-4 text-yellow-500" />
        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
          {documents.length}
        </span>
        <span className="text-sm">unclassified</span>
      </div>

      {documents.length === 0 ? (
        <p className="text-muted-foreground">All documents are classified.</p>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <Link
                  to={`/documents/${doc.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {doc.original_filename}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {formatDocType(doc.doc_type)} |{" "}
                  {getBestDate(doc) || "No date"}
                </p>
                {doc.ocr_text && (
                  <p className="mt-1 max-w-lg truncate text-xs text-muted-foreground">
                    {doc.ocr_text.substring(0, 150)}...
                  </p>
                )}
              </div>
              <Select
                className="w-full shrink-0 md:w-56"
                defaultValue=""
                aria-label="Assign to patient"
                onChange={(e) => {
                  if (e.target.value)
                    assignPatient(doc.id, Number(e.target.value));
                }}
              >
                <option value="">Assign to patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
