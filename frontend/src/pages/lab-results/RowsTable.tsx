import { Link } from "react-router-dom";
import { Check, Edit3, FileText, Trash2, X } from "lucide-react";
import type { LabRow } from "./types";

// ── Rows table ────────────────────────────────────────────────────

interface RowsTableProps {
  rows: LabRow[];
  editingId: number | null;
  editVals: Partial<LabRow>;
  setEditVals: (v: Partial<LabRow>) => void;
  startEdit: (r: LabRow) => void;
  cancelEdit: () => void;
  saveEdit: (id: number) => void;
  deleteRow: (r: LabRow) => void;
  saving: boolean;
  showDocument?: boolean;
}

export function RowsTable({
  rows,
  editingId,
  editVals,
  setEditVals,
  startEdit,
  cancelEdit,
  saveEdit,
  deleteRow,
  saving,
  showDocument = true,
}: RowsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b bg-muted/50">
        <tr>
          {showDocument && (
            <th className="px-3 py-2 text-left font-medium">Document</th>
          )}
          <th className="px-3 py-2 text-left font-medium">Test</th>
          <th className="px-3 py-2 text-left font-medium">Value</th>
          <th className="px-3 py-2 text-left font-medium">Unit</th>
          <th className="px-3 py-2 text-left font-medium">Reference</th>
          <th className="px-3 py-2 text-left font-medium">Date</th>
          <th className="px-3 py-2 text-left font-medium w-px whitespace-nowrap">
            Actions
          </th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((lr) => {
          const editing = editingId === lr.id;
          return (
            <tr
              key={lr.id}
              className={`${lr.is_abnormal ? "bg-red-50/50 dark:bg-red-950/30" : ""} ${editing ? "bg-accent/40" : ""}`}
            >
              {showDocument && (
                <td className="px-3 py-1.5 max-w-[220px] truncate">
                  {lr.document_id ? (
                    <Link
                      to={`/documents/${lr.document_id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      title={lr.document_filename || ""}
                    >
                      <FileText className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">
                        {lr.document_filename || `#${lr.document_id}`}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">
                      no document
                    </span>
                  )}
                </td>
              )}
              <td className="px-3 py-1.5">
                {editing ? (
                  <input
                    type="text"
                    value={(editVals.test_name_original as string) ?? ""}
                    onChange={(e) =>
                      setEditVals({
                        ...editVals,
                        test_name_original: e.target.value,
                      })
                    }
                    className="w-full rounded border bg-background px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  <span>{lr.test_name_canonical || lr.test_name_original}</span>
                )}
              </td>
              <td
                className={`px-3 py-1.5 font-medium ${lr.is_abnormal ? "text-red-600 dark:text-red-400" : ""}`}
              >
                {editing ? (
                  <input
                    type="number"
                    step="any"
                    value={(editVals.value as number) ?? ""}
                    onChange={(e) =>
                      setEditVals({
                        ...editVals,
                        value:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="w-24 rounded border bg-background px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  (lr.value ?? lr.value_text ?? "—")
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {editing ? (
                  <input
                    type="text"
                    value={(editVals.unit as string) ?? ""}
                    onChange={(e) =>
                      setEditVals({ ...editVals, unit: e.target.value })
                    }
                    className="w-20 rounded border bg-background px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  lr.unit || ""
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {editing ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="any"
                      value={(editVals.reference_range_low as number) ?? ""}
                      onChange={(e) =>
                        setEditVals({
                          ...editVals,
                          reference_range_low:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      className="w-16 rounded border bg-background px-1.5 py-0.5 text-sm"
                      placeholder="low"
                    />
                    <span>–</span>
                    <input
                      type="number"
                      step="any"
                      value={(editVals.reference_range_high as number) ?? ""}
                      onChange={(e) =>
                        setEditVals({
                          ...editVals,
                          reference_range_high:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      className="w-16 rounded border bg-background px-1.5 py-0.5 text-sm"
                      placeholder="high"
                    />
                  </div>
                ) : lr.reference_range_low != null &&
                  lr.reference_range_high != null ? (
                  `${lr.reference_range_low}–${lr.reference_range_high}`
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                {editing ? (
                  <input
                    type="date"
                    value={(editVals.test_date as string) ?? ""}
                    onChange={(e) =>
                      setEditVals({ ...editVals, test_date: e.target.value })
                    }
                    className="rounded border bg-background px-1.5 py-0.5 text-sm"
                  />
                ) : (
                  lr.test_date || "—"
                )}
              </td>
              <td
                className="px-3 py-1.5 whitespace-nowrap"
                onClick={(e) => e.stopPropagation()}
              >
                {editing ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => saveEdit(lr.id)}
                      disabled={saving}
                      className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEdit(lr)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                      title="Edit"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => deleteRow(lr)}
                      className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
