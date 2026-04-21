import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { FileText, Search, Upload, Pencil, Check, X, ChevronDown } from "lucide-react";
import FileUpload from "@/components/FileUpload";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import type { PipelineStatus } from "@/types";
import { formatDocType, getBestDate, getStatusClasses } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

const DOC_TYPES = [
  "bloodtest", "labtest_other", "prescription", "invoice", "receipt",
  "insurance_claim", "referral", "discharge", "specialist_report",
  "radiology_report", "surgical_report", "vaccination", "other",
];

// Read URL params once at mount-time so every filter starts seeded from the
// URL. We never re-sync on external URL changes; the component is the source
// of truth while it's mounted and writes back via setSearchParams.
const readList = (sp: URLSearchParams, key: string): string[] => {
  const v = sp.get(key);
  return v ? v.split(",").filter(Boolean) : [];
};
const readStr = (sp: URLSearchParams, key: string): string => sp.get(key) || "";
const readInt = (sp: URLSearchParams, key: string, fallback: number): number => {
  const v = sp.get(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export default function DocumentsPage() {
  const { selectedPatient } = usePatient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [documents, setDocuments] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => readStr(searchParams, "q"));
  const [typeFilter, setTypeFilter] = useState<string[]>(() => readList(searchParams, "type"));
  const [statusFilter, setStatusFilter] = useState<string[]>(() => readList(searchParams, "status"));
  const [specialtyFilter, setSpecialtyFilter] = useState<string[]>(() => readList(searchParams, "specialty"));
  const [doctorFilter, setDoctorFilter] = useState<string[]>(() => readList(searchParams, "doctor_id"));
  const [facilityFilter, setFacilityFilter] = useState<string[]>(() => readList(searchParams, "facility_id"));
  const [dateFrom, setDateFrom] = useState(() => readStr(searchParams, "date_from"));
  const [dateTo, setDateTo] = useState(() => readStr(searchParams, "date_to"));
  const [page, setPage] = useState(() => readInt(searchParams, "page", 0));
  const [showUpload, setShowUpload] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [reprocessMode, setReprocessMode] = useState<"both" | "ocr" | "llm">("both");
  const [reprocessLlmProvider, setReprocessLlmProvider] = useState("");
  const [reprocessOcrProvider, setReprocessOcrProvider] = useState("");
  const [llmProviders, setLlmProviders] = useState<any[]>([]);
  const [ocrProviders, setOcrProviders] = useState<any[]>([]);
  const reprocessRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const confirm = useConfirm();
  const limit = 20;

  // Load filter options
  const [specialties, setSpecialties] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [facilities, setFacilities] = useState<any[]>([]);

  useEffect(() => {
    api.get("/normalization/specialties").then((res: any) => {
      setSpecialties(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
    api.get("/normalization/doctors").then((res: any) => {
      setDoctors(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
    api.get("/normalization/facilities").then((res: any) => {
      setFacilities(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
    api.get("/settings/llm-providers").then((res: any) => {
      setLlmProviders((res.data || []).filter((p: any) => p.enabled));
    }).catch(() => {});
    api.get("/settings/ocr-providers").then((res: any) => {
      setOcrProviders((res.data || []).filter((p: any) => p.enabled));
    }).catch(() => {});
  }, []);

  // Mirror filter state back to the URL so back-navigation from a document
  // detail page restores the exact filter/search/page state. `replace: true`
  // so keystrokes in the search box don't pollute browser history.
  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (typeFilter.length) next.set("type", typeFilter.join(","));
    if (statusFilter.length) next.set("status", statusFilter.join(","));
    if (specialtyFilter.length) next.set("specialty", specialtyFilter.join(","));
    if (doctorFilter.length) next.set("doctor_id", doctorFilter.join(","));
    if (facilityFilter.length) next.set("facility_id", facilityFilter.join(","));
    if (dateFrom) next.set("date_from", dateFrom);
    if (dateTo) next.set("date_to", dateTo);
    if (page) next.set("page", String(page));
    setSearchParams(next, { replace: true });
  }, [search, typeFilter, statusFilter, specialtyFilter, doctorFilter, facilityFilter, dateFrom, dateTo, page, setSearchParams]);

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

    api.get("/documents", { params }).then((res: any) => {
      setDocuments(res.data.items || []);
      setTotal(res.data.total || 0);
      setLoading(false);
    });
    api.get("/pipeline/status").then((res: any) => setPipeline(res.data)).catch(() => {});
  }, [selectedPatient, search, typeFilter, statusFilter, specialtyFilter, doctorFilter, facilityFilter, dateFrom, dateTo, page]);

  // Poll pipeline status for live page progress
  useEffect(() => {
    const interval = setInterval(() => {
      api.get("/pipeline/status").then((res: any) => setPipeline(res.data)).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Clear selection when filters / page / patient change — it'd be wrong to
  // act on rows the user can no longer see.
  useEffect(() => {
    setSelectedIds(new Set());
    setReprocessOpen(false);
  }, [selectedPatient, search, typeFilter, statusFilter, specialtyFilter, doctorFilter, facilityFilter, dateFrom, dateTo, page]);

  // Close reprocess menu on outside click
  useEffect(() => {
    if (!reprocessOpen) return;
    const handler = (e: MouseEvent) => {
      if (reprocessRef.current && !reprocessRef.current.contains(e.target as Node)) {
        setReprocessOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [reprocessOpen]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    if (selectedIds.size === documents.length && documents.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(documents.map((d: any) => d.id)));
    }
  };

  const reloadDocuments = async () => {
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
    const res = await api.get("/documents", { params });
    setDocuments(res.data.items || []);
    setTotal(res.data.total || 0);
  };

  // Run a per-doc async action against every selected id. Collects failures
  // and surfaces a single toast at the end so a run-through of 20 docs with
  // two 403s doesn't spray twenty error toasts.
  const runBulk = async (
    label: string,
    perDoc: (id: number) => Promise<void>,
  ) => {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(label);
    const ids = Array.from(selectedIds);
    let ok = 0;
    const failures: string[] = [];
    for (const id of ids) {
      try {
        await perDoc(id);
        ok += 1;
      } catch (err: any) {
        const d = err?.response?.data?.detail || err?.message || "failed";
        failures.push(`#${id}: ${typeof d === "string" ? d : JSON.stringify(d)}`);
      }
    }
    setBulkBusy(null);
    setSelectedIds(new Set());
    setReprocessOpen(false);
    await reloadDocuments();
    if (failures.length === 0) {
      toast({ title: `${label}: ${ok}/${ids.length} done` });
    } else {
      toast({
        title: `${label}: ${ok}/${ids.length} done, ${failures.length} failed`,
        description: failures.slice(0, 3).join(" • ") + (failures.length > 3 ? ` (+${failures.length - 3} more)` : ""),
        variant: "error",
      });
    }
  };

  const bulkDelete = async () => {
    const n = selectedIds.size;
    const ok = await confirm({
      title: `Delete ${n} document${n === 1 ? "" : "s"}?`,
      description: "Files will be removed from disk and every related record (lab results, encounters, medications, etc.) will be cascaded. This cannot be undone.",
      variant: "destructive",
    });
    if (!ok) return;
    await runBulk("Delete", (id) => api.delete(`/documents/${id}`).then(() => {}));
  };

  const bulkReprocess = async () => {
    const mode = reprocessMode;
    const payload: Record<string, any> = { mode };
    if (reprocessLlmProvider) payload.llm_provider_id = reprocessLlmProvider;
    if (reprocessOcrProvider) payload.ocr_provider_id = reprocessOcrProvider;
    await runBulk(
      mode === "both" ? "Reprocess" : `Reprocess (${mode.toUpperCase()})`,
      (id) => api.post(`/documents/${id}/reprocess`, payload).then(() => {}),
    );
  };

  const bulkRegenerateFilename = async () => {
    await runBulk("Regenerate filename", async (id) => {
      const gen = await api.post(`/documents/${id}/generate-filename`);
      const suggested = gen.data?.suggested_filename;
      if (!suggested) throw new Error("No suggestion");
      await api.post(`/documents/${id}/rename`, { filename: suggested });
    });
  };

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
          api.get("/documents", { params }).then((res: any) => {
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(0); }}
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <MultiSelectFilter
          label="Type"
          options={DOC_TYPES.map((t: string) => ({ value: t, label: t.replace(/_/g, " ") }))}
          selected={typeFilter}
          onChange={(v: string[]) => { setTypeFilter(v); setPage(0); }}
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
          onChange={(v: string[]) => { setStatusFilter(v); setPage(0); }}
          searchable={false}
        />

        <MultiSelectFilter
          label="Specialty"
          options={specialties.map((s: any) => ({
            value: s.canonical_code || s.canonical_display,
            label: s.canonical_display || s.canonical_code,
          }))}
          selected={specialtyFilter}
          onChange={(v: string[]) => { setSpecialtyFilter(v); setPage(0); }}
        />

        <MultiSelectFilter
          label="Doctor"
          options={doctors.map((d: any) => ({
            value: String(d.id),
            label: `${d.title ? d.title + " " : ""}${d.name}`,
          }))}
          selected={doctorFilter}
          onChange={(v: string[]) => { setDoctorFilter(v); setPage(0); }}
        />

        <MultiSelectFilter
          label="Facility"
          options={facilities.map((f: any) => ({
            value: String(f.id),
            label: `${f.name}${f.city ? ` (${f.city})` : ""}`,
          }))}
          selected={facilityFilter}
          onChange={(v: string[]) => { setFacilityFilter(v); setPage(0); }}
        />
      </div>

      {/* Date range + clear */}
      <div className="flex flex-wrap gap-3 items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Date from:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setDateFrom(e.target.value); setPage(0); }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">to:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setDateTo(e.target.value); setPage(0); }}
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

      {/* Bulk-actions bar — intentionally subdued. Only visible when rows are selected. */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <span>{selectedIds.size} selected</span>
          <span className="text-muted-foreground/40">|</span>
          <button
            onClick={bulkDelete}
            disabled={!!bulkBusy}
            className="hover:text-destructive disabled:opacity-50"
          >
            {bulkBusy === "Delete" ? "Deleting..." : "Delete"}
          </button>
          <div ref={reprocessRef} className="relative">
            <button
              onClick={() => setReprocessOpen((o) => !o)}
              disabled={!!bulkBusy}
              className="inline-flex items-center gap-0.5 hover:text-foreground disabled:opacity-50"
            >
              {bulkBusy?.startsWith("Reprocess") ? bulkBusy + "..." : "Reprocess"}
              <ChevronDown className="h-3 w-3" />
            </button>
            {reprocessOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 w-72 rounded-lg border bg-background shadow-xl p-3 space-y-3 text-foreground">
                <p className="text-xs font-medium text-muted-foreground">What to reprocess</p>
                <div className="flex gap-1">
                  {[
                    { value: "both", label: "OCR + LLM" },
                    { value: "ocr", label: "OCR only" },
                    { value: "llm", label: "LLM only" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setReprocessMode(opt.value as "both" | "ocr" | "llm")}
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                        reprocessMode === opt.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {reprocessMode !== "llm" && ocrProviders.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">OCR Provider</p>
                    <select
                      value={reprocessOcrProvider}
                      onChange={(e) => setReprocessOcrProvider(e.target.value)}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="">Default (highest priority)</option>
                      {ocrProviders.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {reprocessMode !== "ocr" && llmProviders.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">LLM Provider</p>
                    <select
                      value={reprocessLlmProvider}
                      onChange={(e) => setReprocessLlmProvider(e.target.value)}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="">Default (highest priority)</option>
                      {llmProviders.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={bulkReprocess}
                  disabled={!!bulkBusy}
                  className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Start Reprocessing ({selectedIds.size})
                </button>
              </div>
            )}
          </div>
          <button
            onClick={bulkRegenerateFilename}
            disabled={!!bulkBusy}
            className="hover:text-foreground disabled:opacity-50"
          >
            {bulkBusy === "Regenerate filename" ? "Renaming..." : "Regenerate filename"}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={!!bulkBusy}
            className="ml-auto hover:text-foreground disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-2 py-2 w-8 text-left">
                <input
                  type="checkbox"
                  checked={documents.length > 0 && selectedIds.size === documents.length}
                  onChange={toggleSelectAllOnPage}
                  aria-label="Select all on this page"
                  className="align-middle"
                />
              </th>
              <th className="px-4 py-2 text-left font-medium w-[30%]">File</th>
              <th className="px-4 py-2 text-left font-medium w-[14%]">Type</th>
              <th className="px-4 py-2 text-left font-medium w-[12%]">Date</th>
              <th className="px-4 py-2 text-left font-medium w-[22%]">Doctor / Facility</th>
              <th className="px-4 py-2 text-left font-medium w-[22%]">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Loading...</td></tr>
            ) : documents.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No documents found</td></tr>
            ) : (
              documents.map((doc: any) => (
                <tr key={doc.id} className={`hover:bg-accent/50 ${selectedIds.has(doc.id) ? "bg-accent/30" : ""}`}>
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(doc.id)}
                      onChange={() => toggleSelect(doc.id)}
                      aria-label={`Select ${doc.original_filename || doc.id}`}
                      className="align-middle"
                    />
                  </td>
                  <td className="px-4 py-2 overflow-hidden">
                    <InlineRenameCell doc={doc} onRenamed={(updated: any) => {
                      setDocuments((prev: any[]) => prev.map((d: any) => d.id === doc.id ? { ...d, ...updated } : d));
                    }} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground truncate" title={formatDocType(doc.doc_type)}>{formatDocType(doc.doc_type)}</td>
                  <td className="px-4 py-2 text-muted-foreground truncate">{getBestDate(doc) || "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground truncate" title={doc.doctor_name || doc.facility_name || ""}>{doc.doctor_name || doc.facility_name || "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${getStatusClasses(doc.status)}`}>
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
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p: number) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >Previous</button>
            <button
              onClick={() => setPage((p: number) => p + 1)}
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
  const { toast } = useToast();
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
      toast({ title: "Rename failed", description: e.response?.data?.detail || e.message, variant: "error" });
    }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input value={val} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVal(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditing(false); setVal(doc.original_filename); } }}
          className="flex-1 rounded border bg-background px-2 py-0.5 text-sm min-w-0"
          autoFocus disabled={saving}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
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
      <Link to={`/documents/${doc.id}`} className="flex items-center gap-2 text-primary hover:underline flex-1 min-w-0" title={doc.original_filename}>
        <FileText className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{doc.original_filename}</span>
      </Link>
      <button
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setVal(doc.original_filename); setEditing(true); }}
        className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
        title="Rename"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
