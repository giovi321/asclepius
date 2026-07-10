import { Link } from "react-router-dom";
import { AlertTriangle, Check, Edit3, FileText, Trash2, X } from "lucide-react";
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
    <>
      {/* Stacked rows below md — the 7-column table has no room on phones. */}
      <div className="divide-y md:hidden">
        {rows.map((lr) => {
          const editing = editingId === lr.id;
          return (
            <div
              key={lr.id}
              className={`px-3 py-2.5 ${lr.is_abnormal ? "bg-destructive-soft/50" : ""} ${editing ? "bg-accent/40" : ""}`}
            >
              {editing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={(editVals.test_name_original as string) ?? ""}
                    onChange={(e) =>
                      setEditVals({
                        ...editVals,
                        test_name_original: e.target.value,
                      })
                    }
                    placeholder="Test name"
                    className="w-full rounded border bg-background px-2 py-1.5 text-base sm:text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      step="any"
                      value={(editVals.value as number) ?? ""}
                      onChange={(e) =>
                        setEditVals({
                          ...editVals,
                          value:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      placeholder="Value"
                      className="w-full rounded border bg-background px-2 py-1.5 text-base sm:text-sm"
                    />
                    <input
                      type="text"
                      value={(editVals.unit as string) ?? ""}
                      onChange={(e) =>
                        setEditVals({ ...editVals, unit: e.target.value })
                      }
                      placeholder="Unit"
                      className="w-full rounded border bg-background px-2 py-1.5 text-base sm:text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
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
                      placeholder="Ref. low"
                      className="w-full rounded border bg-background px-2 py-1.5 text-base sm:text-sm"
                    />
                    <span className="text-muted-foreground">–</span>
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
                      placeholder="Ref. high"
                      className="w-full rounded border bg-background px-2 py-1.5 text-base sm:text-sm"
                    />
                  </div>
                  <input
                    type="date"
                    value={(editVals.test_date as string) ?? ""}
                    onChange={(e) =>
                      setEditVals({ ...editVals, test_date: e.target.value })
                    }
                    className="w-full rounded border bg-background px-2 py-1.5 text-base sm:text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={cancelEdit}
                      className="inline-flex min-h-9 items-center justify-center rounded-md border px-3 text-sm hover:bg-accent coarse:min-h-11 coarse:min-w-11"
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Cancel
                    </button>
                    <button
                      onClick={() => saveEdit(lr.id)}
                      disabled={saving}
                      className="inline-flex min-h-9 items-center justify-center rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50 coarse:min-h-11 coarse:min-w-11"
                    >
                      <Check className="mr-1 h-3.5 w-3.5" />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="min-w-0 truncate font-medium">
                        {lr.test_name_canonical || lr.test_name_original}
                      </span>
                      {lr.is_abnormal && (
                        <AlertTriangle
                          className="h-3.5 w-3.5 flex-shrink-0 text-destructive"
                          aria-label="Abnormal"
                        />
                      )}
                    </div>
                    <div className="text-sm">
                      <span
                        className={`font-medium ${lr.is_abnormal ? "text-destructive" : ""}`}
                      >
                        {lr.value ?? lr.value_text ?? "—"}
                        {lr.unit ? ` ${lr.unit}` : ""}
                      </span>
                      {lr.reference_range_low != null &&
                        lr.reference_range_high != null && (
                          <span className="ml-2 text-muted-foreground">
                            ref {lr.reference_range_low}–
                            {lr.reference_range_high}
                          </span>
                        )}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex-shrink-0">
                        {lr.test_date || "—"}
                      </span>
                      {showDocument &&
                        (lr.document_id ? (
                          <Link
                            to={`/documents/${lr.document_id}`}
                            className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
                            title={lr.document_filename || ""}
                          >
                            <FileText className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">
                              {lr.document_filename || `#${lr.document_id}`}
                            </span>
                          </Link>
                        ) : (
                          <span className="italic">no document</span>
                        ))}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button
                      onClick={() => startEdit(lr)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-accent coarse:h-11 coarse:w-11"
                      title="Edit"
                      aria-label="Edit"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => deleteRow(lr)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 coarse:h-11 coarse:w-11"
                      title="Delete"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* md+ keeps the full table. */}
      <div className="hidden md:block">
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
                  className={`${lr.is_abnormal ? "bg-destructive-soft/50" : ""} ${editing ? "bg-accent/40" : ""}`}
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
                      <span>
                        {lr.test_name_canonical || lr.test_name_original}
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-1.5 font-medium ${lr.is_abnormal ? "text-destructive" : ""}`}
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
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
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
                          value={
                            (editVals.reference_range_high as number) ?? ""
                          }
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
      </div>
    </>
  );
}
