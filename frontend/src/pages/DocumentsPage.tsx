import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import FileUpload from "@/components/FileUpload";
import type { PipelineStatus } from "@/types";
import { buildBulkConfirm, shouldConfirmBulk } from "@/lib/confirmBulk";
import { useToast } from "@/contexts/ToastContext";
import {
  COLUMNS, COLUMN_STORAGE_KEY, loadVisibleColumns,
  type ColumnKey, type SortKey,
} from "@/components/documents/columns";
import DocumentFilters from "@/components/documents/DocumentFilters";
import BulkActionsBar, { type ReprocessMode } from "@/components/documents/BulkActionsBar";
import DocumentTable from "@/components/documents/DocumentTable";

// URL param helpers. Filter state is seeded from the URL at mount time and
// written back via setSearchParams; we never re-sync on external URL changes.
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
  const { toast } = useToast();
  const confirm = useConfirm();
  const limit = 20;

  const [documents, setDocuments] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Filters (seeded from URL)
  const [search, setSearch] = useState(() => readStr(searchParams, "q"));
  const [typeFilter, setTypeFilter] = useState<string[]>(() => readList(searchParams, "type"));
  const [statusFilter, setStatusFilter] = useState<string[]>(() => readList(searchParams, "status"));
  const [specialtyFilter, setSpecialtyFilter] = useState<string[]>(() => readList(searchParams, "specialty"));
  const [doctorFilter, setDoctorFilter] = useState<string[]>(() => readList(searchParams, "doctor_id"));
  const [facilityFilter, setFacilityFilter] = useState<string[]>(() => readList(searchParams, "facility_id"));
  const [dateFrom, setDateFrom] = useState(() => readStr(searchParams, "date_from"));
  const [dateTo, setDateTo] = useState(() => readStr(searchParams, "date_to"));
  const [page, setPage] = useState(() => readInt(searchParams, "page", 0));

  // Sort + column visibility
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(() => loadVisibleColumns());

  // Selection + bulk state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [llmProviders, setLlmProviders] = useState<any[]>([]);
  const [ocrProviders, setOcrProviders] = useState<any[]>([]);

  const orderedVisibleColumns = useMemo(
    () => COLUMNS.filter((c) => visibleCols.has(c.key)),
    [visibleCols],
  );

  // Persist column choice.
  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(Array.from(visibleCols)));
  }, [visibleCols]);

  useEffect(() => {
    api.get("/settings/llm-providers").then((res: any) => {
      setLlmProviders((res.data || []).filter((p: any) => p.enabled));
    }).catch(() => {});
    api.get("/settings/ocr-providers").then((res: any) => {
      setOcrProviders((res.data || []).filter((p: any) => p.enabled));
    }).catch(() => {});
  }, []);

  // Mirror filter state back to the URL so back-navigation from a document
  // detail page restores the exact filter/search/page state.
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

  const buildListParams = (): Record<string, any> => {
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
    if (sortBy) { params.sort = sortBy; params.order = sortOrder; }
    return params;
  };

  useEffect(() => {
    setLoading(true);
    api.get("/documents", { params: buildListParams() }).then((res: any) => {
      setDocuments(res.data.items || []);
      setTotal(res.data.total || 0);
      setLoading(false);
    });
    api.get("/pipeline/status").then((res: any) => setPipeline(res.data)).catch(() => {});
  }, [selectedPatient, search, typeFilter, statusFilter, specialtyFilter, doctorFilter, facilityFilter, dateFrom, dateTo, page, sortBy, sortOrder]);

  // Poll pipeline status for live page progress
  useEffect(() => {
    const interval = setInterval(() => {
      api.get("/pipeline/status").then((res: any) => setPipeline(res.data)).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Clear selection when filters / page / patient change - it'd be wrong to
  // act on rows the user can no longer see.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectedPatient, search, typeFilter, statusFilter, specialtyFilter, doctorFilter, facilityFilter, dateFrom, dateTo, page]);

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

  const toggleSort = (key: SortKey) => {
    setPage(0);
    const naturalDesc = key === "date" || key === "date_added" || key === "status";
    const naturalOrder: "asc" | "desc" = naturalDesc ? "desc" : "asc";
    if (sortBy !== key) {
      setSortBy(key);
      setSortOrder(naturalOrder);
      return;
    }
    if (sortOrder === naturalOrder) {
      setSortOrder(naturalOrder === "asc" ? "desc" : "asc");
      return;
    }
    setSortBy(null);
    setSortOrder(naturalOrder);
  };

  const reloadDocuments = async () => {
    const res = await api.get("/documents", { params: buildListParams() });
    setDocuments(res.data.items || []);
    setTotal(res.data.total || 0);
  };

  const runBulk = async (label: string, perDoc: (id: number) => Promise<void>) => {
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

  const bulkReprocess = async (mode: ReprocessMode, llmProviderId: string, ocrProviderId: string) => {
    if (shouldConfirmBulk(selectedIds.size)) {
      const modeLabel = mode === "both" ? "OCR and LLM" : mode.toUpperCase();
      const ok = await confirm(buildBulkConfirm({
        count: selectedIds.size,
        verb: "Reprocess",
        noun: "document",
        description: `This will re-run ${modeLabel} on every selected document. It can take a while and may consume paid-provider tokens.`,
        confirmText: "Reprocess",
      }));
      if (!ok) return;
    }

    // Warn on long documents - reprocessing every page through OCR + LLM
    // can take a while and burn paid-provider tokens.
    const longDocs = documents
      .filter((d) => selectedIds.has(d.id))
      .filter((d) => typeof d.page_count === "number" && d.page_count > 5);
    if (longDocs.length > 0) {
      const totalPages = longDocs.reduce((n, d) => n + (d.page_count || 0), 0);
      const ok = await confirm({
        title: longDocs.length === 1
          ? `Reprocess ${longDocs[0].page_count}-page document?`
          : `Reprocess ${longDocs.length} long documents?`,
        description: longDocs.length === 1
          ? `"${longDocs[0].original_filename}" has ${longDocs[0].page_count} pages. Reprocessing runs OCR and the LLM on every page, which can take a while and cost tokens on a paid provider.`
          : `${longDocs.length} of the selected documents have more than 5 pages (${totalPages} pages total). Reprocessing runs OCR and the LLM on every page, which can take a while and cost tokens on a paid provider.`,
        confirmText: "Reprocess",
        cancelText: "Cancel",
      });
      if (!ok) return;
    }

    const payload: Record<string, any> = { mode };
    if (llmProviderId) payload.llm_provider_id = llmProviderId;
    if (ocrProviderId) payload.ocr_provider_id = ocrProviderId;
    await runBulk(
      mode === "both" ? "Reprocess" : `Reprocess (${mode.toUpperCase()})`,
      (id) => api.post(`/documents/${id}/reprocess`, payload).then(() => {}),
    );
  };

  const bulkRegenerateFilename = async () => {
    if (shouldConfirmBulk(selectedIds.size)) {
      const ok = await confirm(buildBulkConfirm({
        count: selectedIds.size,
        verb: "Regenerate filename on",
        noun: "document",
        description: "Each file is re-analyzed by the LLM and renamed on disk. This can take a while and may consume paid-provider tokens.",
        confirmText: "Regenerate",
      }));
      if (!ok) return;
    }
    await runBulk("Regenerate filename", async (id) => {
      const gen = await api.post(`/documents/${id}/generate-filename`);
      const suggested = gen.data?.suggested_filename;
      if (!suggested) throw new Error("No suggestion");
      await api.post(`/documents/${id}/rename`, { filename: suggested });
    });
  };

  return (
    <div className="space-y-4">
      {showUpload && (
        <FileUpload onUploadComplete={() => {
          setPage(0);
          setLoading(true);
          api.get("/documents", {
            params: { limit, offset: 0, ...(selectedPatient ? { patient_id: selectedPatient.id } : {}) },
          }).then((res: any) => {
            setDocuments(res.data.items || []);
            setTotal(res.data.total || 0);
            setLoading(false);
          });
        }} />
      )}

      <DocumentFilters
        search={search}
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        specialtyFilter={specialtyFilter}
        doctorFilter={doctorFilter}
        facilityFilter={facilityFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(patch) => {
          setPage(0);
          if ("search" in patch) setSearch(patch.search!);
          if ("typeFilter" in patch) setTypeFilter(patch.typeFilter!);
          if ("statusFilter" in patch) setStatusFilter(patch.statusFilter!);
          if ("specialtyFilter" in patch) setSpecialtyFilter(patch.specialtyFilter!);
          if ("doctorFilter" in patch) setDoctorFilter(patch.doctorFilter!);
          if ("facilityFilter" in patch) setFacilityFilter(patch.facilityFilter!);
          if ("dateFrom" in patch) setDateFrom(patch.dateFrom!);
          if ("dateTo" in patch) setDateTo(patch.dateTo!);
        }}
        onClearAll={() => {
          setDateFrom(""); setDateTo("");
          setTypeFilter([]); setStatusFilter([]); setSpecialtyFilter([]);
          setDoctorFilter([]); setFacilityFilter([]);
          setPage(0);
        }}
        visibleCols={visibleCols}
        onVisibleColsChange={setVisibleCols}
        onUploadClick={() => setShowUpload(!showUpload)}
      />

      <BulkActionsBar
        selectedCount={selectedIds.size}
        bulkBusy={bulkBusy}
        llmProviders={llmProviders}
        ocrProviders={ocrProviders}
        onDelete={bulkDelete}
        onReprocess={bulkReprocess}
        onRegenerateFilename={bulkRegenerateFilename}
        onClear={() => setSelectedIds(new Set())}
      />

      <DocumentTable
        documents={documents}
        loading={loading}
        orderedVisibleColumns={orderedVisibleColumns}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAllOnPage}
        onRenamed={(updated) => {
          setDocuments((prev) => prev.map((d: any) =>
            d.id === updated.id ? { ...d, ...updated } : d,
          ));
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortToggle={toggleSort}
        pipeline={pipeline}
      />

      {total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {page * limit + 1}-{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >Previous</button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * limit >= total}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
