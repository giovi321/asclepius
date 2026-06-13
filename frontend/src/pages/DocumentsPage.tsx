import { useEffect, useMemo, useState } from "react";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { usePatient } from "@/contexts/PatientContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import FileUpload from "@/components/FileUpload";
import type { PipelineStatus } from "@/types";
import { buildBulkConfirm, shouldConfirmBulk } from "@/lib/confirmBulk";
import { useToast } from "@/contexts/ToastContext";
import {
  COLUMNS,
  DOCUMENTS_DEFAULTS,
  type ColumnKey,
} from "@/components/documents/columns";
import { useColumnPrefs } from "@/lib/columnPrefs";
import DocumentFilters from "@/components/documents/DocumentFilters";
import BulkActionsBar, {
  type ReprocessMode,
} from "@/components/documents/BulkActionsBar";
import DocumentTable from "@/components/documents/DocumentTable";
import { useDocumentList } from "@/hooks/data/useDocumentList";
import { useLlmProviders, useOcrProviders } from "@/hooks/data";
import ShareDialog from "@/components/share/ShareDialog";

export default function DocumentsPage() {
  const { selectedPatient } = usePatient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const limit = 20;

  const {
    items: documents,
    total,
    loading,
    filters,
    setFilters,
    clearFilters,
    sort,
    toggleSort,
    page,
    setPage,
    reload: reloadDocuments,
    setItems: setDocuments,
  } = useDocumentList({ patientId: selectedPatient?.id, limit });

  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Column visibility — synced through the backend so the user's choice
  // follows them across devices. The hook migrates the legacy localStorage
  // entry (asclepius_documents_columns) up to the server on first run.
  const colPrefs = useColumnPrefs("documents", DOCUMENTS_DEFAULTS);
  const visibleCols = useMemo(
    () => new Set(colPrefs.visible as ColumnKey[]),
    [colPrefs.visible],
  );
  const setVisibleCols = (next: Set<ColumnKey>) =>
    colPrefs.setVisible(Array.from(next));

  // Selection + bulk state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [bulkShareOpen, setBulkShareOpen] = useState(false);

  // A share covers exactly one patient, so the bulk-share button is only
  // valid when the entire selection sits inside the same patient_id. We
  // also derive the patient name for the dialog header so the user can
  // sanity-check before clicking Create.
  const sharePatient = useMemo(() => {
    const selected = documents.filter((d: any) => selectedIds.has(d.id));
    if (selected.length === 0)
      return {
        id: null as number | null,
        name: null as string | null,
        conflict: false,
      };
    const ids = new Set(selected.map((d: any) => d.patient_id));
    if (ids.size > 1) return { id: null, name: null, conflict: true };
    const first = selected[0];
    return {
      id: first.patient_id ?? null,
      name: first.patient_name ?? null,
      conflict: false,
    };
  }, [documents, selectedIds]);

  const shareTooltip = sharePatient.conflict
    ? "Selection spans multiple patients. A share covers one patient at a time."
    : !sharePatient.id
      ? "Selected documents are not assigned to a patient."
      : null;
  const { data: llmData } = useLlmProviders();
  const { data: ocrData } = useOcrProviders();
  const llmProviders = useMemo(
    () => (Array.isArray(llmData) ? llmData : []).filter((p: any) => p.enabled),
    [llmData],
  );
  const ocrProviders = useMemo(
    () => (Array.isArray(ocrData) ? ocrData : []).filter((p: any) => p.enabled),
    [ocrData],
  );

  const orderedVisibleColumns = useMemo(
    () => COLUMNS.filter((c) => visibleCols.has(c.key)),
    [visibleCols],
  );

  // Poll pipeline status for live page progress
  useEffect(() => {
    api
      .get("/pipeline/status")
      .then((res: any) => setPipeline(res.data))
      .catch(() => {});
    const interval = setInterval(() => {
      api
        .get("/pipeline/status")
        .then((res: any) => setPipeline(res.data))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Clear selection when filters / page / patient change - it'd be wrong to
  // act on rows the user can no longer see.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectedPatient, filters, page]);

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
        const d = getErrorMessage(err, "failed");
        failures.push(
          `#${id}: ${typeof d === "string" ? d : JSON.stringify(d)}`,
        );
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
        description:
          failures.slice(0, 3).join(" • ") +
          (failures.length > 3 ? ` (+${failures.length - 3} more)` : ""),
        variant: "error",
      });
    }
  };

  const bulkDelete = async () => {
    const n = selectedIds.size;
    const ok = await confirm({
      title: `Delete ${n} document${n === 1 ? "" : "s"}?`,
      description:
        "Files will be removed from disk and every related record (lab results, encounters, medications, etc.) will be cascaded. This cannot be undone.",
      variant: "destructive",
    });
    if (!ok) return;
    await runBulk("Delete", (id) =>
      api.delete(`/documents/${id}`).then(() => {}),
    );
  };

  const bulkReprocess = async (
    mode: ReprocessMode,
    llmProviderId: string,
    ocrProviderId: string,
  ) => {
    if (shouldConfirmBulk(selectedIds.size)) {
      const modeLabel = mode === "both" ? "OCR and LLM" : mode.toUpperCase();
      const ok = await confirm(
        buildBulkConfirm({
          count: selectedIds.size,
          verb: "Reprocess",
          noun: "document",
          description: `This will re-run ${modeLabel} on every selected document. It can take a while and may consume paid-provider tokens.`,
          confirmText: "Reprocess",
        }),
      );
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
        title:
          longDocs.length === 1
            ? `Reprocess ${longDocs[0].page_count}-page document?`
            : `Reprocess ${longDocs.length} long documents?`,
        description:
          longDocs.length === 1
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
      const ok = await confirm(
        buildBulkConfirm({
          count: selectedIds.size,
          verb: "Regenerate filename on",
          noun: "document",
          description:
            "Each file is re-analyzed by the LLM and renamed on disk. This can take a while and may consume paid-provider tokens.",
          confirmText: "Regenerate",
        }),
      );
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
        <FileUpload
          onUploadComplete={() => {
            setPage(0);
            reloadDocuments();
          }}
        />
      )}

      <DocumentFilters
        search={filters.search}
        typeFilter={filters.typeFilter}
        statusFilter={filters.statusFilter}
        specialtyFilter={filters.specialtyFilter}
        doctorFilter={filters.doctorFilter}
        facilityFilter={filters.facilityFilter}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        onChange={(patch) => {
          const next: Partial<typeof filters> = {};
          if ("search" in patch) next.search = patch.search!;
          if ("typeFilter" in patch) next.typeFilter = patch.typeFilter!;
          if ("statusFilter" in patch) next.statusFilter = patch.statusFilter!;
          if ("specialtyFilter" in patch)
            next.specialtyFilter = patch.specialtyFilter!;
          if ("doctorFilter" in patch) next.doctorFilter = patch.doctorFilter!;
          if ("facilityFilter" in patch)
            next.facilityFilter = patch.facilityFilter!;
          if ("dateFrom" in patch) next.dateFrom = patch.dateFrom!;
          if ("dateTo" in patch) next.dateTo = patch.dateTo!;
          setFilters(next);
        }}
        onClearAll={clearFilters}
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
        onShare={() => setBulkShareOpen(true)}
        shareTooltip={shareTooltip}
      />

      <ShareDialog
        open={bulkShareOpen}
        onClose={() => setBulkShareOpen(false)}
        patientId={sharePatient.id}
        documentIds={Array.from(selectedIds)}
        patientName={sharePatient.name}
        selectionLabel={`${selectedIds.size} document${selectedIds.size === 1 ? "" : "s"}`}
      />

      <DocumentTable
        documents={documents}
        loading={loading}
        orderedVisibleColumns={orderedVisibleColumns}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAllOnPage}
        onRenamed={(updated) => {
          setDocuments((prev) =>
            prev.map((d: any) =>
              d.id === updated.id ? { ...d, ...updated } : d,
            ),
          );
        }}
        sortBy={sort.sortBy}
        sortOrder={sort.sortOrder}
        onSortToggle={toggleSort}
        pipeline={pipeline}
      />

      {total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {page * limit + 1}-{Math.min((page + 1) * limit, total)} of{" "}
            {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={(page + 1) * limit >= total}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
