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
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";
import IconButton from "@/components/ui/IconButton";
import Input from "@/components/ui/Input";
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

/** Row actions (documents / merge / delete), shared between table row and card. */
function RowActions({
  onViewDocuments,
  onToggleMerge,
  onDelete,
}: Pick<
  NormalizationRowProps,
  "onViewDocuments" | "onToggleMerge" | "onDelete"
>) {
  return (
    <div className="flex gap-1">
      <IconButton
        size="sm"
        variant="secondary"
        label="Show documents that reference this entry"
        onClick={onViewDocuments}
      >
        <FileText className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        size="sm"
        variant="secondary"
        label="Merge into another entry"
        onClick={onToggleMerge}
      >
        <GitMerge className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        size="sm"
        variant="danger"
        label="Delete this entry"
        onClick={onDelete}
        className="border"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

/** "Merge X into ..." form, shared between the table's merge row and the card. */
function MergeForm({
  item,
  normItems,
  mergeTargetId,
  rowNewDisplay,
  rowNewCode,
  onMergeTargetChange,
  onRowNewDisplayChange,
  onRowNewCodeChange,
  onMerge,
  onCancelMerge,
}: Pick<
  NormalizationRowProps,
  | "item"
  | "normItems"
  | "mergeTargetId"
  | "rowNewDisplay"
  | "rowNewCode"
  | "onMergeTargetChange"
  | "onRowNewDisplayChange"
  | "onRowNewCodeChange"
  | "onMerge"
  | "onCancelMerge"
>) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
        <span className="text-muted-foreground">
          Merge <strong>{item.canonical_display}</strong> into:
        </span>
        <div className="w-full md:w-auto md:min-w-[240px] md:max-w-xs">
          <Combobox
            value={mergeTargetId === null ? null : String(mergeTargetId)}
            onChange={(v) => onMergeTargetChange(v === null ? null : Number(v))}
            placeholder="Select target..."
            title="Merge into..."
            pinnedOptions={[{ value: "-1", label: "+ Create new entry..." }]}
            options={normItems
              .filter((n) => n.id !== item.id)
              .map((n) => ({
                value: String(n.id),
                label: n.canonical_display,
                hint: n.canonical_code || undefined,
              }))}
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onMerge}
            disabled={
              !mergeTargetId || (mergeTargetId === -1 && !rowNewDisplay.trim())
            }
          >
            Merge
          </Button>
          <Button size="sm" variant="secondary" onClick={onCancelMerge}>
            Cancel
          </Button>
        </div>
      </div>
      {mergeTargetId === -1 && (
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:pl-1">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground md:flex-row md:items-center md:gap-1.5">
            Name
            <Input
              value={rowNewDisplay}
              onChange={(e) => onRowNewDisplayChange(e.target.value)}
              placeholder="Display name for the new entry"
              className="md:w-64"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground md:flex-row md:items-center md:gap-1.5">
            Code <span className="text-[10px]">(optional)</span>
            <Input
              value={rowNewCode}
              onChange={(e) => onRowNewCodeChange(e.target.value)}
              placeholder="auto"
              className="font-mono md:w-40"
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** Expanded content (canonical-entry edit form + alias management), shared
 *  between the table's detail row and the card. */
function ExpandedDetail({
  item,
  detail,
  editing,
  editCode,
  editDisplay,
  saveError,
  newAlias,
  newAliasLang,
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
}: Pick<
  NormalizationRowProps,
  | "item"
  | "detail"
  | "editing"
  | "editCode"
  | "editDisplay"
  | "saveError"
  | "newAlias"
  | "newAliasLang"
  | "onStartEdit"
  | "onCancelEdit"
  | "onEditCodeChange"
  | "onEditDisplayChange"
  | "onSaveEdit"
  | "onNewAliasChange"
  | "onNewAliasLangChange"
  | "onAddAlias"
  | "onDeleteAlias"
  | "onConfirmAll"
>) {
  return (
    <div className="space-y-4 max-w-2xl">
      {/* Canonical Entry */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Canonical Entry</h4>
          {!editing && (
            <Button size="sm" variant="secondary" onClick={onStartEdit}>
              <Edit3 className="h-3 w-3" /> Edit
            </Button>
          )}
        </div>
        {editing ? (
          <div className="grid gap-2">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Code</span>
                <Input
                  value={editCode}
                  onChange={(e) => onEditCodeChange(e.target.value)}
                  className="font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">
                  Display Name
                </span>
                <Input
                  value={editDisplay}
                  onChange={(e) => onEditDisplayChange(e.target.value)}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={onSaveEdit}>
                <Save className="h-3 w-3" /> Save
              </Button>
              <Button size="sm" variant="secondary" onClick={onCancelEdit}>
                Cancel
              </Button>
            </div>
            {saveError && (
              <p className="text-xs text-destructive">
                Save failed: {saveError}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-sm md:flex-row md:gap-4">
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
              <Badge variant="warning" size="sm" className="ml-2">
                {item.unreviewed_count} unreviewed
              </Badge>
            )}
          </h4>
          {(item.unreviewed_count ?? 0) > 0 && (
            <Button
              size="sm"
              onClick={onConfirmAll}
              title="Accept every auto-mapped alias listed below as correct"
            >
              <Check className="h-3 w-3" /> Confirm all
            </Button>
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
                    <Badge variant="warning" size="sm" className="flex-shrink-0">
                      auto
                    </Badge>
                  )}
                </div>
                <IconButton
                  size="sm"
                  variant="danger"
                  label="Delete alias"
                  onClick={() => onDeleteAlias(a.id)}
                  className="ml-2 flex-shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No aliases yet.</p>
        )}

        <div className="flex flex-wrap gap-2 items-end">
          <label className="space-y-1 w-full md:w-auto md:flex-1">
            <span className="text-xs text-muted-foreground">New alias</span>
            <Input
              value={newAlias}
              onChange={(e) => onNewAliasChange(e.target.value)}
              placeholder="e.g. Emocromo, CBC, ..."
              onKeyDown={(e) => e.key === "Enter" && onAddAlias()}
            />
          </label>
          <label className="space-y-1 w-24 flex-1 md:flex-none md:w-20">
            <span className="text-xs text-muted-foreground">Lang</span>
            <Input
              value={newAliasLang}
              onChange={(e) => onNewAliasLangChange(e.target.value)}
              placeholder="en"
              onKeyDown={(e) => e.key === "Enter" && onAddAlias()}
            />
          </label>
          <Button size="sm" onClick={onAddAlias} disabled={!newAlias.trim()}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Table presentation (md and up). */
export default function NormalizationRow(props: NormalizationRowProps) {
  const {
    item,
    detail,
    expanded,
    showMerge,
    selected,
    onToggleSelect,
    onToggleExpand,
    onViewDocuments,
    onToggleMerge,
    onDelete,
  } = props;

  return (
    <React.Fragment>
      <tr
        className={`cursor-pointer transition-colors ${expanded ? "bg-accent/30" : "hover:bg-accent/20"}`}
        onClick={onToggleExpand}
      >
        <td className="px-3 py-1.5 w-8" onClick={(e) => e.stopPropagation()}>
          <label className="flex cursor-pointer items-center justify-center coarse:min-h-11 coarse:min-w-11">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select ${item.canonical_display || item.id}`}
            />
          </label>
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
            <Badge variant="warning" size="sm" className="ml-1.5">
              {item.unreviewed_count} unreviewed
            </Badge>
          )}
        </td>
        <td
          className="px-3 py-1.5 whitespace-nowrap w-px"
          onClick={(e) => e.stopPropagation()}
        >
          <RowActions
            onViewDocuments={onViewDocuments}
            onToggleMerge={onToggleMerge}
            onDelete={onDelete}
          />
        </td>
      </tr>

      {showMerge && (
        <tr className="bg-warning-soft">
          <td
            colSpan={6}
            className="px-6 py-3"
            onClick={(e) => e.stopPropagation()}
          >
            <MergeForm {...props} />
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
            <ExpandedDetail {...props} />
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

/** Card presentation (below md). Same props and behaviour as the table row:
 *  tapping the header expands the same detail content, the checkbox feeds
 *  the batch-merge selection, and the action buttons match the table's. */
export function NormalizationCard(props: NormalizationRowProps) {
  const {
    item,
    detail,
    expanded,
    showMerge,
    selected,
    onToggleSelect,
    onToggleExpand,
    onViewDocuments,
    onToggleMerge,
    onDelete,
  } = props;

  return (
    <div className="rounded-lg border bg-card">
      <div
        className="flex cursor-pointer items-center gap-1 p-3"
        onClick={onToggleExpand}
      >
        <label
          className="-my-2 -ml-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${item.canonical_display || item.id}`}
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.canonical_display}</div>
          {item.canonical_code && (
            <div className="truncate font-mono text-xs text-muted-foreground">
              {item.canonical_code}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge size="sm">{item.alias_count || 0} aliases</Badge>
            {(item.unreviewed_count ?? 0) > 0 && (
              <Badge variant="warning" size="sm">
                {item.unreviewed_count} unreviewed
              </Badge>
            )}
          </div>
        </div>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden
        />
      </div>

      <div className="flex items-center gap-1 px-3 pb-2">
        <RowActions
          onViewDocuments={onViewDocuments}
          onToggleMerge={onToggleMerge}
          onDelete={onDelete}
        />
      </div>

      {showMerge && (
        <div className="border-t bg-warning-soft p-3">
          <MergeForm {...props} />
        </div>
      )}

      {expanded && detail && (
        <div className="border-t p-3">
          <ExpandedDetail {...props} />
        </div>
      )}
    </div>
  );
}
