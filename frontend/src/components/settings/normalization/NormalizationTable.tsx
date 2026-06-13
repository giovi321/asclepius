import { type NormItem } from "./types";
import NormalizationRow from "./NormalizationRow";

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
  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-3 py-2.5 text-left font-medium w-8">
              <input
                type="checkbox"
                checked={
                  normItems.length > 0 && selectedIds.size === normItems.length
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
              <td colSpan={6} className="p-6 text-center text-muted-foreground">
                {searchQuery ? "No matches found" : "No entries"}
              </td>
            </tr>
          ) : (
            normItems.map((item) => (
              <NormalizationRow
                key={item.id}
                item={item}
                normItems={normItems}
                detail={detail}
                expanded={expandedId === item.id}
                editing={editing}
                editCode={editCode}
                editDisplay={editDisplay}
                saveError={saveError}
                newAlias={newAlias}
                newAliasLang={newAliasLang}
                showMerge={showMergeFor === item.id}
                mergeTargetId={mergeTargetId}
                rowNewDisplay={rowNewDisplay}
                rowNewCode={rowNewCode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => onToggleSelect(item.id)}
                onToggleExpand={() => onToggleExpand(item.id)}
                onViewDocuments={() =>
                  onViewDocuments(
                    item.id,
                    item.canonical_display || item.name || `#${item.id}`,
                  )
                }
                onToggleMerge={() =>
                  onSetShowMergeFor(showMergeFor === item.id ? null : item.id)
                }
                onCancelMerge={onCancelMerge}
                onDelete={() =>
                  onDelete(
                    item.id,
                    item.canonical_display || item.name || `#${item.id}`,
                  )
                }
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onEditCodeChange={onEditCodeChange}
                onEditDisplayChange={onEditDisplayChange}
                onSaveEdit={onSaveEdit}
                onNewAliasChange={onNewAliasChange}
                onNewAliasLangChange={onNewAliasLangChange}
                onAddAlias={onAddAlias}
                onDeleteAlias={onDeleteAlias}
                onConfirmAll={() => onConfirmAll(item.id)}
                onMergeTargetChange={onMergeTargetChange}
                onRowNewDisplayChange={onRowNewDisplayChange}
                onRowNewCodeChange={onRowNewCodeChange}
                onMerge={() => mergeTargetId && onMerge(item.id)}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
