import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { FileText, Search, Upload, Pencil, Check, X } from "lucide-react";
import FileUpload from "@/components/FileUpload";
import MultiSelectFilter from "@/components/MultiSelectFilter";

const DOC_TYPES = [
  "bloodtest", "labtest_other", "prescription", "invoice", "receipt",
  "insurance_claim", "referral", "discharge", "specialist_report",
  "radiology_report", "surgical_report", "vaccination", "other",
];

interface PipelineStatus {
  processing: string | null;
  processing_step: string | null;
  processing_doc_id: number | null;
  processing_pages: number | null;
  processing_page_current: number | null;
}

export default function DocumentsPage() {
  const { selectedPatient } = usePatient();
  const [documents, setDocuments] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [specialtyFilter, setSpecialtyFilter] = useState<string[]>([]);
  const [doctorFilter, setDoctorFilter] = useState<string[]>([]);
  const [facilityFilter, setFacilityFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const limit = 20;

  // Load filter options
  const [specialties, setSpecialties] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [facilities, setFacilities] = useState<any[]>([]);

  useEffect(() => {
    api.get("/normalization/specialties").then((res) => {
      setSpecialties(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
    api.get("/normalization/doctors").then((res) => {
      setDoctors(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
    api.get("/normalization/facilities").then((res) => {
      setFacilities(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, any> = { limit, offset: page * limit };
    if (selectedPatient) params.patient_id = selectedPatient.id;
    if (search) params.q = search;
    if (typeFilter.length) params.type = typeFilter.join(",");
    if (statusFilter.length) params.status = statusFilter.join(",");
    if (specialtyFilter.length) params.specialty = specialtyFilter.join(",");
    if (doctorFilter.length) params.doctor_id = doctorFilter.join(",");
    if (facilityFilter.length) params.facility_id = facilityFilter.join(",");
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    api.get("/documents", { params }).then((res) => {
      setDocuments(res.data.items || []);
      setTotal(res.data.total || 0);
      setLoading(false);
    });
    api.get("/pipeline/status").then((res) => setPipeline(res.data)).catch(() => {});
  }, [selectedPatient, search, typeFilter, statusFilter, specialtyFilter, doctorFilter, facilityFilter, dateFrom, dateTo, page]);

  // Poll pipeline status for live page progress
  useEffect(() => {
    const interval = setInterval(() => {
      api.get("/pipeline/status").then((res) => setPipeline(res.data)).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <Upload className="h-4 w-4" />
          Upload
        </button>
      </div>

      {showUpload && (
        <FileUpload onUploadComplete={() => {
          setPage(0);
          setLoading(true);
          const params: Record<string, any> = { limit, offset: 0 };
          if (selectedPatient) params.patient_id = selectedPatient.id;
          api.get("/documents", { params }).then((res) => {
            setDocuments(res.data.items || []);
            setTotal(res.data.total || 0);
            setLoading(false);
          });
        }} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-start">
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

        <MultiSelectFilter
          label="Type"
          options={DOC_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
          selected={typeFilter}
          onChange={(v) => { setTypeFilter(v); setPage(0); }}
        />

        <MultiSelectFilter
          label="Status"
          options={[
            { value: "done", label: "Done" },
            { value: "processing", label: "Processing" },
            { value: "pending", label: "Pending" },
            { value: "needs_review", label: "Needs Review" },
            { value: "failed", label: "Failed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          selected={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(0); }}
          searchable={false}
        />

        <MultiSelectFilter
          label="Specialty"
          options={specialties.map((s) => ({
            value: s.canonical_code || s.canonical_display,
            label: s.canonical_display || s.canonical_code,
          }))}
          selected={specialtyFilter}
          onChange={(v) => { setSpecialtyFilter(v); setPage(0); }}
        />

        <MultiSelectFilter
          label="Doctor"
          options={doctors.map((d) => ({
            value: String(d.id),
            label: `${d.title ? d.title + " " : ""}${d.name}`,
          }))}
          selected={doctorFilter}
          onChange={(v) => { setDoctorFilter(v); setPage(0); }}
        />

        <MultiSelectFilter
          label="Facility"
          options={facilities.map((f) => ({
            value: String(f.id),
            label: `${f.name}${f.city ? ` (${f.city})` : ""}`,
          }))}
          selected={facilityFilter}
          onChange={(v) => { setFacilityFilter(v); setPage(0); }}
        />
      </div>

      {/* Date range + clear */}
      <div className="flex flex-wrap gap-3 items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Date from:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">to:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        {(dateFrom || dateTo || typeFilter.length || statusFilter.length || specialtyFilter.length || doctorFilter.length || facilityFilter.length) && (
          <button
            onClick={() => {
              setDateFrom(""); setDateTo(""); setTypeFilter([]);
              setStatusFilter([]); setSpecialtyFilter([]);
              setDoctorFilter([]); setFacilityFilter([]); setPage(0);
            }}
            className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" /> Clear all filters
          </button>
        )}
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
              <th className="px-4 py-2 text-left font-medium">Doctor / Facility</th>
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
                    <InlineRenameCell doc={doc} onRenamed={(updated) => {
                      setDocuments((prev) => prev.map((d) => d.id === doc.id ? { ...d, ...updated } : d));
                    }} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{doc.doc_type?.replace(/_/g, " ") || "\u2014"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{doc.date_visit || doc.date_issued || doc.doc_date || "\u2014"}</td>
                  <td className="px-4 py-2">{doc.patient_name || <span className="text-yellow-600">Unclassified</span>}</td>
                  <td className="px-4 py-2 text-muted-foreground">{doc.doctor_name || doc.facility_name || "\u2014"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      doc.status === "done" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                      doc.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                      doc.status === "needs_review" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
                      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}>
                      {doc.status === "processing" && pipeline?.processing_doc_id === doc.id
                        && pipeline?.processing_pages && pipeline?.processing_page_current != null
                        ? `${pipeline?.processing_step || "processing"} (${pipeline?.processing_page_current}/${pipeline?.processing_pages})`
                        : doc.status}
                    </span>
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
            Showing {page * limit + 1}\u2013{Math.min((page + 1) * limit, total)} of {total}
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

function InlineRenameCell({ doc, onRenamed }: { doc: any; onRenamed: (updated: any) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(doc.original_filename || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!val.trim() || val === doc.original_filename) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await api.post(`/documents/${doc.id}/rename`, { filename: val });
      setEditing(false);
      onRenamed(res.data);
    } catch (e: any) {
      alert("Rename failed: " + (e.response?.data?.detail || e.message));
    }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditing(false); setVal(doc.original_filename); } }}
          className="flex-1 rounded border bg-background px-2 py-0.5 text-sm min-w-0"
          autoFocus disabled={saving}
          onClick={(e) => e.stopPropagation()}
        />
        <button onClick={handleSave} disabled={saving}
          className="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-950 disabled:opacity-50">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => { setEditing(false); setVal(doc.original_filename); }}
          className="rounded p-1 text-muted-foreground hover:bg-accent">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <Link to={`/documents/${doc.id}`} className="flex items-center gap-2 text-primary hover:underline flex-1 min-w-0">
        <FileText className="h-4 w-4 flex-shrink-0" />
        <span className="max-w-[200px] truncate">{doc.original_filename}</span>
      </Link>
      <button
        onClick={(e) => { e.stopPropagation(); setVal(doc.original_filename); setEditing(true); }}
        className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
        title="Rename"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
