import { useEffect, useState } from "react";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { TestTube } from "lucide-react";

export default function LabResultsPage() {
  const { selectedPatient } = usePatient();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [timelineTest, setTimelineTest] = useState<string | null>(null);
  const [timelineData, setTimelineData] = useState<any[]>([]);

  useEffect(() => {
    if (!selectedPatient) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params: Record<string, any> = { patient_id: selectedPatient.id, limit: 200 };
    if (search) params.test_name = search;

    api.get("/lab-results", { params }).then((res) => {
      setResults(res.data.items || []);
      setLoading(false);
    });
  }, [selectedPatient, search]);

  useEffect(() => {
    if (!timelineTest || !selectedPatient) return;
    api
      .get("/lab-results/timeline", {
        params: { patient_id: selectedPatient.id, test_name: timelineTest },
      })
      .then((res) => setTimelineData(res.data.data || []));
  }, [timelineTest, selectedPatient]);

  if (!selectedPatient) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <TestTube className="h-8 w-8" />
        <p>Select a patient to view lab results</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Lab Results</h1>

      <input
        type="text"
        placeholder="Search by test name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-md border px-3 py-2 text-sm"
      />

      {/* Timeline view */}
      {timelineTest && timelineData.length > 0 && (
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{timelineTest} — Trend</h3>
            <button onClick={() => setTimelineTest(null)} className="text-sm text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>
          <div className="mt-3 space-y-1">
            {timelineData.map((d, i) => (
              <div key={i} className="flex items-center gap-4 text-sm">
                <span className="w-24 text-muted-foreground">{d.test_date}</span>
                <span className={`font-medium ${d.is_abnormal ? "text-red-600" : ""}`}>
                  {d.value ?? d.value_text}
                </span>
                <span className="text-muted-foreground">{d.unit || ""}</span>
                {d.reference_range_low != null && (
                  <span className="text-xs text-muted-foreground">
                    (ref: {d.reference_range_low}–{d.reference_range_high})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results table */}
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Test</th>
              <th className="px-4 py-2 text-left font-medium">Value</th>
              <th className="px-4 py-2 text-left font-medium">Unit</th>
              <th className="px-4 py-2 text-left font-medium">Reference</th>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Panel</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Loading...</td></tr>
            ) : results.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No lab results found</td></tr>
            ) : (
              results.map((lr) => (
                <tr key={lr.id} className={lr.is_abnormal ? "bg-red-50" : ""}>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => setTimelineTest(lr.test_name_canonical || lr.test_name_original)}
                      className="text-left text-primary hover:underline"
                    >
                      {lr.test_name_canonical || lr.test_name_original}
                    </button>
                  </td>
                  <td className={`px-4 py-2 font-medium ${lr.is_abnormal ? "text-red-600" : ""}`}>
                    {lr.value ?? lr.value_text ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{lr.unit || ""}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {lr.reference_range_low != null && lr.reference_range_high != null
                      ? `${lr.reference_range_low}–${lr.reference_range_high}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{lr.test_date || "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{lr.panel_name || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
