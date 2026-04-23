import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { PipelineStatus } from "@/types";
import { formatDocType, getBestDate, getStatusClasses } from "@/lib/utils";
import InlineRenameCell from "./InlineRenameCell";
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
}

function SortArrow({ active, order }: { active: boolean; order: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  return order === "asc"
    ? <ArrowUp className="h-3 w-3 text-primary" />
    : <ArrowDown className="h-3 w-3 text-primary" />;
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
}: DocumentTableProps) {
  const tableColSpan = 2 + orderedVisibleColumns.length;
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col style={{ width: "32px" }} />
          <col />
          {orderedVisibleColumns.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-2 py-2 text-left">
              <input
                type="checkbox"
                checked={documents.length > 0 && selectedIds.size === documents.length}
                onChange={onToggleSelectAll}
                aria-label="Select all on this page"
                className="align-middle"
              />
            </th>
            <th
              className="px-4 py-2 text-left font-medium cursor-pointer select-none hover:text-foreground"
              onClick={() => onSortToggle("file")}
            >
              <span className="inline-flex items-center gap-1">
                File <SortArrow active={sortBy === "file"} order={sortOrder} />
              </span>
            </th>
            {orderedVisibleColumns.map((c) => (
              <th
                key={c.key}
                className="px-4 py-2 text-left font-medium cursor-pointer select-none hover:text-foreground"
                onClick={() => onSortToggle(c.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label} <SortArrow active={sortBy === c.key} order={sortOrder} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading ? (
            <tr><td colSpan={tableColSpan} className="p-4 text-center text-muted-foreground">Loading...</td></tr>
          ) : documents.length === 0 ? (
            <tr><td colSpan={tableColSpan} className="p-4 text-center text-muted-foreground">No documents found</td></tr>
          ) : (
            documents.map((doc: any) => (
              <tr key={doc.id} className={`hover:bg-accent/50 ${selectedIds.has(doc.id) ? "bg-accent/30" : ""}`}>
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(doc.id)}
                    onChange={() => onToggleSelect(doc.id)}
                    aria-label={`Select ${doc.original_filename || doc.id}`}
                    className="align-middle"
                  />
                </td>
                <td className="px-4 py-2 overflow-hidden">
                  <InlineRenameCell doc={doc} onRenamed={onRenamed} />
                </td>
                {orderedVisibleColumns.map((c) => {
                  if (c.key === "type") {
                    const t = formatDocType(doc.doc_type);
                    return <td key={c.key} className="px-4 py-2 text-muted-foreground truncate" title={t}>{t}</td>;
                  }
                  if (c.key === "date") {
                    return <td key={c.key} className="px-4 py-2 text-muted-foreground truncate">{getBestDate(doc) || "-"}</td>;
                  }
                  if (c.key === "doctor") {
                    return <td key={c.key} className="px-4 py-2 text-muted-foreground truncate" title={doc.doctor_name || ""}>{doc.doctor_name || "-"}</td>;
                  }
                  if (c.key === "facility") {
                    return <td key={c.key} className="px-4 py-2 text-muted-foreground truncate" title={doc.facility_name || ""}>{doc.facility_name || "-"}</td>;
                  }
                  if (c.key === "patient") {
                    return <td key={c.key} className="px-4 py-2 text-muted-foreground truncate" title={doc.patient_name || ""}>{doc.patient_name || "-"}</td>;
                  }
                  if (c.key === "specialty") {
                    const s = doc.specialty_original || "";
                    return <td key={c.key} className="px-4 py-2 text-muted-foreground truncate" title={s}>{s || "-"}</td>;
                  }
                  if (c.key === "date_added") {
                    const d = doc.created_at ? String(doc.created_at).slice(0, 10) : "";
                    return <td key={c.key} className="px-4 py-2 text-muted-foreground truncate" title={doc.created_at || ""}>{d || "-"}</td>;
                  }
                  // status
                  return (
                    <td key={c.key} className="px-4 py-2">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${getStatusClasses(doc.status)}`}>
                        {doc.status === "processing" && pipeline?.processing_doc_id === doc.id
                          && pipeline?.processing_pages && pipeline?.processing_page_current != null
                          ? `${pipeline?.processing_step || "processing"} (${pipeline?.processing_page_current}/${pipeline?.processing_pages})`
                          : doc.status}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
