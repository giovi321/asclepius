import { type NormItem } from "./types";
import NormalizationRow, {
  NormalizationCard,
  type NormalizationRowProps,
} from "./NormalizationRow";

export interface NormalizationTableProps {
  normItems: NormItem[];
  detail: any;
  expandedId: number | null;
  editing: boolean;
  editCode: string;
  editDisplay: string;
  saveError: string | null;
  newAlias: string;
  newAliasLang: string;
  showMergeFor: number | null;
  mergeTargetId: number | null;
  rowNewDisplay: string;
  rowNewCode: string;
  searchQuery: string;
  selectedIds: Set<number>;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
  onViewDocuments: (id: number, name: string) => void;
  onSetShowMergeFor: (id: number | null) => void;
  onCancelMerge: () => void;
  onDelete: (id: number, name: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditCodeChange: (v: string) => void;
  onEditDisplayChange: (v: string) => void;
  onSaveEdit: () => void;
  onNewAliasChange: (v: string) => void;
  onNewAliasLangChange: (v: string) => void;
  onAddAlias: () => void;
  onDeleteAlias: (aliasId: number) => void;
  onConfirmAll: (id: number) => void;
  onMergeTargetChange: (id: number | null) => void;
  onRowNewDisplayChange: (v: string) => void;
  onRowNewCodeChange: (v: string) => void;
  onMerge: (id: number) => void;
}

export default function NormalizationTable({
  normItems,
  detail,
  expandedId,
  editing,
  editCode,
  editDisplay,
  saveError,
  newAlias,
  newAliasLang,
  showMergeFor,
  mergeTargetId,
  rowNewDisplay,
  rowNewCode,
  searchQuery,
  selectedIds,
  onToggleSelectAll,
  onToggleSelect,
  onToggleExpand,
  onViewDocuments,
  onSetShowMergeFor,
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
}: NormalizationTableProps) {
  /** Per-item props shared by the table row (md+) and the card (below md). */
  const itemProps = (item: NormItem): NormalizationRowProps => ({
    item,
    normItems,
    detail,
    expanded: expandedId === item.id,
    editing,
    editCode,
    editDisplay,
    saveError,
    newAlias,
    newAliasLang,
    showMerge: showMergeFor === item.id,
    mergeTargetId,
    rowNewDisplay,
    rowNewCode,
    selected: selectedIds.has(item.id),
    onToggleSelect: () => onToggleSelect(item.id),
    onToggleExpand: () => onToggleExpand(item.id),
    onViewDocuments: () =>
      onViewDocuments(item.id, item.canonical_display || item.name || `#${item.id}`),
    onToggleMerge: () =>
      onSetShowMergeFor(showMergeFor === item.id ? null : item.id),
    onCancelMerge,
    onDelete: () =>
      onDelete(item.id, item.canonical_display || item.name || `#${item.id}`),
    onStartEdit,
    onCancelEdit,
    onEditCodeChange,
    onEditDisplayChange,
    onSaveEdit,
    onNewAliasChange,
    onNewAliasLangChange,
    onAddAlias,
    onDeleteAlias,
    onConfirmAll: () => onConfirmAll(item.id),
    onMergeTargetChange,
    onRowNewDisplayChange,
    onRowNewCodeChange,
    onMerge: () => mergeTargetId && onMerge(item.id),
  });

  const emptyLabel = searchQuery ? "No matches found" : "No entries";

  return (
    <>
      {/* Table presentation, md and up */}
      <div className="hidden rounded-lg border overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium w-8">
                <input
                  type="checkbox"
                  checked={
                    normItems.length > 0 &&
                    selectedIds.size === normItems.length
                  }
                  onChange={onToggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-2 py-2 text-left font-medium w-6"></th>
              <th className="px-3 py-2 text-left font-medium">Code</th>
              <th className="px-3 py-2 text-left font-medium">Display Name</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">
                Aliases
              </th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {normItems.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="p-6 text-center text-muted-foreground"
                >
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              normItems.map((item) => (
                <NormalizationRow key={item.id} {...itemProps(item)} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Card presentation, below md. Bottom padding keeps the fixed
          batch-merge bar from covering the last card while selecting. */}
      <div
        className={`space-y-2 md:hidden ${selectedIds.size > 0 ? "pb-44" : ""}`}
      >
        {normItems.length === 0 ? (
          <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          <>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm text-muted-foreground">
              <span className="-my-2 flex h-11 w-11 items-center justify-center">
                <input
                  type="checkbox"
                  checked={selectedIds.size === normItems.length}
                  onChange={onToggleSelectAll}
                  aria-label="Select all"
                />
              </span>
              Select all ({normItems.length})
            </label>
            {normItems.map((item) => (
              <NormalizationCard key={item.id} {...itemProps(item)} />
            ))}
          </>
        )}
      </div>
    </>
  );
}
