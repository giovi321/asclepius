import React from "react";
import {
  Check,
  ChevronRight,
  Edit3,
  FileText,
  GitMerge,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import type { NormItem } from "./types";

export interface NormalizationRowProps {
  item: NormItem;
  normItems: NormItem[];
  /** Detail payload from /normalization/<type>/<id>; only populated when expanded. */
  detail: any;
  expanded: boolean;
  editing: boolean;
  editCode: string;
  editDisplay: string;
  saveError: string | null;
  newAlias: string;
  newAliasLang: string;
  showMerge: boolean;
  mergeTargetId: number | null;
  rowNewDisplay: string;
  rowNewCode: string;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onViewDocuments: () => void;
  onToggleMerge: () => void;
  onCancelMerge: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditCodeChange: (v: string) => void;
  onEditDisplayChange: (v: string) => void;
  onSaveEdit: () => void;
  onNewAliasChange: (v: string) => void;
  onNewAliasLangChange: (v: string) => void;
  onAddAlias: () => void;
  onDeleteAlias: (aliasId: number) => void;
  onConfirmAll: () => void;
  onMergeTargetChange: (id: number | null) => void;
  onRowNewDisplayChange: (v: string) => void;
  onRowNewCodeChange: (v: string) => void;
  onMerge: () => void;
}

export default function NormalizationRow(props: NormalizationRowProps) {
  const {
    item,
    normItems,
    detail,
    expanded,
    editing,
    editCode,
    editDisplay,
    saveError,
    newAlias,
    newAliasLang,
    showMerge,
    mergeTargetId,
    rowNewDisplay,
    rowNewCode,
    selected,
    onToggleSelect,
    onToggleExpand,
    onViewDocuments,
    onToggleMerge,
    onCancelMerge,
    onDelete,
    onStartEdit,
    onCancelEdit,
    onEditCodeChange,
    onEditDisplayChange,
    onSaveEdit,
    onNewAliasChange,
    onNewAliasLangChange,
    onAddAlias,
    onDeleteAlias,
    onConfirmAll,
    onMergeTargetChange,
    onRowNewDisplayChange,
    onRowNewCodeChange,
    onMerge,
  } = props;

  return (
    <React.Fragment>
      <tr
        className={`cursor-pointer transition-colors ${expanded ? "bg-accent/30" : "hover:bg-accent/20"}`}
        onClick={onToggleExpand}
      >
        <td className="px-3 py-1.5 w-8" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${item.canonical_display || item.id}`}
          />
        </td>
        <td className="px-2 py-1.5 w-6">
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </td>
        <td
          className="px-3 py-1.5 font-mono text-xs text-muted-foreground max-w-[280px] truncate"
          title={item.canonical_code || undefined}
        >
          {item.canonical_code}
        </td>
        <td
          className="px-3 py-1.5 font-medium max-w-[360px] truncate"
          title={item.canonical_display}
        >
          {item.canonical_display}
        </td>
        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
          {item.alias_count || 0} aliases
          {(item.unreviewed_count ?? 0) > 0 && (
            <span className="ml-1.5 inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">
              {item.unreviewed_count} unreviewed
            </span>
          )}
        </td>
        <td
          className="px-3 py-1.5 whitespace-nowrap w-px"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex gap-1">
            <button
              onClick={onViewDocuments}
              className="rounded-md border p-1.5 hover:bg-accent"
              title="Show documents that reference this entry"
              aria-label="Show documents"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onToggleMerge}
              className="rounded-md border p-1.5 hover:bg-accent"
              title="Merge into another entry"
              aria-label="Merge"
            >
              <GitMerge className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="rounded-md border p-1.5 text-destructive hover:bg-destructive/10"
              title="Delete this entry"
              aria-label="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>

      {showMerge && (
        <tr className="bg-orange-50 dark:bg-orange-900/10">
          <td
            colSpan={6}
            className="px-6 py-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground">
                  Merge <strong>{item.canonical_display}</strong> into:
                </span>
                <div className="min-w-[240px] max-w-xs">
                  <SearchableSelect
                    value={
                      mergeTargetId === null ? null : String(mergeTargetId)
                    }
                    onChange={(v) =>
                      onMergeTargetChange(v === null ? null : Number(v))
                    }
                    placeholder="Select target..."
                    pinnedOptions={[
                      { value: "-1", label: "+ Create new entry..." },
                    ]}
                    options={normItems
                      .filter((n) => n.id !== item.id)
                      .map((n) => ({
                        value: String(n.id),
                        label: n.canonical_display,
                        hint: n.canonical_code || undefined,
                      }))}
                  />
                </div>
                <button
                  onClick={onMerge}
                  disabled={
                    !mergeTargetId ||
                    (mergeTargetId === -1 && !rowNewDisplay.trim())
                  }
                  className="rounded-md bg-orange-600 px-3 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                >
                  Merge
                </button>
                <button
                  onClick={onCancelMerge}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
              {mergeTargetId === -1 && (
                <div className="flex flex-wrap items-center gap-2 pl-1">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Name
                    <input
                      type="text"
                      value={rowNewDisplay}
                      onChange={(e) => onRowNewDisplayChange(e.target.value)}
                      placeholder="Display name for the new entry"
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Code <span className="text-[10px]">(optional)</span>
                    <input
                      type="text"
                      value={rowNewCode}
                      onChange={(e) => onRowNewCodeChange(e.target.value)}
                      placeholder="auto"
                      className="rounded-md border bg-background px-2 py-1 text-sm font-mono"
                    />
                  </label>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      {expanded && detail && (
        <tr className="bg-muted/20">
          <td
            colSpan={6}
            className="px-6 py-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 max-w-2xl">
              {/* Canonical Entry */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Canonical Entry</h4>
                  {!editing && (
                    <button
                      onClick={onStartEdit}
                      className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      <Edit3 className="h-3 w-3" /> Edit
                    </button>
                  )}
                </div>
                {editing ? (
                  <div className="grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          Code
                        </span>
                        <input
                          type="text"
                          value={editCode}
                          onChange={(e) => onEditCodeChange(e.target.value)}
                          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm font-mono"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          Display Name
                        </span>
                        <input
                          type="text"
                          value={editDisplay}
                          onChange={(e) => onEditDisplayChange(e.target.value)}
                          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={onSaveEdit}
                        className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
                      >
                        <Save className="h-3 w-3" /> Save
                      </button>
                      <button
                        onClick={onCancelEdit}
                        className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </div>
                    {saveError && (
                      <p className="text-xs text-destructive">
                        Save failed: {saveError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-4 text-sm">
                    <span className="text-muted-foreground">
                      Code:{" "}
                      <span className="font-mono text-foreground">
                        {detail.canonical_code}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Name:{" "}
                      <span className="font-medium text-foreground">
                        {detail.canonical_display}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {/* Aliases */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">
                    Aliases ({detail.aliases?.length || 0})
                    {(item.unreviewed_count ?? 0) > 0 && (
                      <span className="ml-2 rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">
                        {item.unreviewed_count} unreviewed
                      </span>
                    )}
                  </h4>
                  {(item.unreviewed_count ?? 0) > 0 && (
                    <button
                      onClick={onConfirmAll}
                      className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                      title="Accept every auto-mapped alias listed below as correct"
                    >
                      <Check className="h-3 w-3" /> Confirm all
                    </button>
                  )}
                </div>
                {detail.aliases?.length > 0 ? (
                  <div className="rounded-md border divide-y max-h-[300px] overflow-y-auto">
                    {detail.aliases.map((a: any) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-accent/20"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{a.alias}</span>
                          {a.language && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase flex-shrink-0">
                              {a.language}
                            </span>
                          )}
                          {a.auto_mapped === 1 && (
                            <span className="rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-1.5 py-0.5 text-[10px] text-yellow-700 dark:text-yellow-400 flex-shrink-0">
                              auto
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => onDeleteAlias(a.id)}
                          className="rounded p-1 text-muted-foreground hover:text-destructive flex-shrink-0 ml-2"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No aliases yet.
                  </p>
                )}

                <div className="flex gap-2 items-end">
                  <label className="space-y-1 flex-1">
                    <span className="text-xs text-muted-foreground">
                      New alias
                    </span>
                    <input
                      type="text"
                      value={newAlias}
                      onChange={(e) => onNewAliasChange(e.target.value)}
                      placeholder="e.g. Emocromo, CBC, ..."
                      onKeyDown={(e) => e.key === "Enter" && onAddAlias()}
                      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <label className="space-y-1 w-20">
                    <span className="text-xs text-muted-foreground">Lang</span>
                    <input
                      type="text"
                      value={newAliasLang}
                      onChange={(e) => onNewAliasLangChange(e.target.value)}
                      placeholder="en"
                      onKeyDown={(e) => e.key === "Enter" && onAddAlias()}
                      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    onClick={onAddAlias}
                    disabled={!newAlias.trim()}
                    className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
