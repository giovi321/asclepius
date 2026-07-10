import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Upload } from "lucide-react";
import type { PipelineStatus } from "@/types";
import { formatDocType, getBestDate, getStatusClasses } from "@/lib/utils";
import ResponsiveTable, {
  type ColumnSpec,
} from "@/components/ui/ResponsiveTable";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import InlineRenameCell from "./InlineRenameCell";
import DocumentCard, { statusText } from "./DocumentCard";
import type { ColumnDef, SortKey } from "./columns";

export interface DocumentTableProps {
  documents: any[];
  loading: boolean;
  orderedVisibleColumns: ColumnDef[];
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onRenamed: (updated: any) => void;
  sortBy: SortKey | null;
  sortOrder: "asc" | "desc";
  onSortToggle: (key: SortKey) => void;
  pipeline: PipelineStatus | null;
  /** Phone selection mode: cards grow checkboxes and a tap toggles the
   *  selection instead of navigating. Desktop ignores this (checkboxes are
   *  always on there). */
  selectionMode: boolean;
  /** Wired to the page's upload affordance for the empty state CTA. */
  onUploadClick: () => void;
}

export default function DocumentTable({
  documents,
  loading,
  orderedVisibleColumns,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRenamed,
  sortBy,
  sortOrder,
  onSortToggle,
  pipeline,
  selectionMode,
  onUploadClick,
}: DocumentTableProps) {
  const navigate = useNavigate();

  const columns = useMemo<ColumnSpec<any>[]>(() => {
    const cellFor = (c: ColumnDef) => {
      switch (c.key) {
        case "type":
          return (doc: any) => {
            const t = formatDocType(doc.doc_type);
            return <span title={t}>{t}</span>;
          };
        case "date":
          return (doc: any) => getBestDate(doc) || "-";
        case "doctor":
          return (doc: any) => (
            <span title={doc.doctor_name || ""}>{doc.doctor_name || "-"}</span>
          );
        case "facility":
          return (doc: any) => (
            <span title={doc.facility_name || ""}>
              {doc.facility_name || "-"}
            </span>
          );
        case "patient":
          return (doc: any) => (
            <span title={doc.patient_name || ""}>
              {doc.patient_name || "-"}
            </span>
          );
        case "specialty":
          return (doc: any) => {
            const s = doc.specialty_original || "";
            return <span title={s}>{s || "-"}</span>;
          };
        case "date_added":
          return (doc: any) => {
            const d = doc.created_at ? String(doc.created_at).slice(0, 10) : "";
            return <span title={doc.created_at || ""}>{d || "-"}</span>;
          };
        // status
        default:
          return (doc: any) => (
            <span
              className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${getStatusClasses(doc.status)}`}
            >
              {statusText(doc, pipeline)}
            </span>
          );
      }
    };

    return [
      {
        key: "file",
        header: "File",
        sortable: true,
        // The cell stops propagation so the inline rename pencil + input
        // don't bubble to the row's navigate handler — but the filename
        // Link still fires because clicks ON the link are NOT a
        // navigate-on-row, they are a real link.
        cell: (doc: any) => (
          <div onClick={(e) => e.stopPropagation()}>
            <InlineRenameCell doc={doc} onRenamed={onRenamed} />
          </div>
        ),
      },
      ...orderedVisibleColumns.map(
        (c): ColumnSpec<any> => ({
          key: c.key,
          header: c.label,
          width: c.width,
          sortable: true,
          cellClassName: c.key === "status" ? undefined : "text-muted-foreground",
          cell: cellFor(c),
        }),
      ),
    ];
  }, [orderedVisibleColumns, onRenamed, pipeline]);

  return (
    <ResponsiveTable
      columns={columns}
      rows={documents}
      getRowId={(doc) => doc.id}
      onRowClick={(doc) =>
        selectionMode ? onToggleSelect(doc.id) : navigate(`/documents/${doc.id}`)
      }
      sort={sortBy ? { key: sortBy, dir: sortOrder } : null}
      onSortChange={(key) => onSortToggle(key as SortKey)}
      selectable
      mobileSelectable={selectionMode}
      selectedIds={selectedIds}
      onToggleSelect={(id) => onToggleSelect(id as number)}
      onToggleSelectAll={onToggleSelectAll}
      rowSelectLabel={(doc) => `Select ${doc.original_filename || doc.id}`}
      loading={loading}
      empty={
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Drop files into the inbox or upload to get started"
          action={
            <Button onClick={onUploadClick}>
              <Upload className="h-4 w-4" aria-hidden />
              Upload
            </Button>
          }
        />
      }
      renderCard={(doc) => <DocumentCard doc={doc} pipeline={pipeline} />}
    />
  );
}
