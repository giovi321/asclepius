import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertCircle } from "lucide-react";

export default function UnclassifiedPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const patients = user?.patients || [];

  useEffect(() => {
    // Fetch documents with no patient assigned
    api.get("/documents", { params: { limit: 100 } }).then((res) => {
      const unclassified = (res.data.items || []).filter((d: any) => !d.patient_id);
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
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-yellow-500" />
        <h1 className="text-2xl font-semibold">Unclassified Documents</h1>
        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-sm text-yellow-700">
          {documents.length}
        </span>
      </div>

      {documents.length === 0 ? (
        <p className="text-muted-foreground">All documents are classified.</p>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Link to={`/documents/${doc.id}`} className="font-medium text-primary hover:underline">
                  {doc.original_filename}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {doc.doc_type?.replace(/_/g, " ") || "Unknown type"} | {doc.doc_date || "No date"}
                </p>
                {doc.ocr_text && (
                  <p className="mt-1 max-w-lg truncate text-xs text-muted-foreground">
                    {doc.ocr_text.substring(0, 150)}...
                  </p>
                )}
              </div>
              <select
                className="rounded-md border px-3 py-1.5 text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) assignPatient(doc.id, Number(e.target.value));
                }}
              >
                <option value="">Assign to patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
