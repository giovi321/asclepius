import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

export interface ColumnSpec<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Desktop colgroup width (e.g. "14%", "120px"). */
  width?: string;
  sortable?: boolean;
  headerClassName?: string;
  cellClassName?: string;
  /**
   * How this column appears in the phone card rendering:
   *  - title: the card's first line (bold, up to 2 lines)
   *  - subtitle: second line
   *  - badge: right-aligned chip on the title row
   *  - meta: small label:value entry in the meta grid
   *  - hidden: desktop-only
   * Omitted = meta.
   */
  mobile?: {
    role: "title" | "subtitle" | "badge" | "meta" | "hidden";
    order?: number;
    /** Meta label; defaults to the column header when it is a string. */
    label?: string;
  };
}

export interface ResponsiveTableProps<T> {
  columns: ColumnSpec<T>[];
  rows: T[];
  getRowId: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  sort?: { key: string; dir: "asc" | "desc" } | null;
  /** Called with the column key; the page owns the toggle logic. */
  onSortChange?: (key: string) => void;
  selectable?: boolean;
  /** Card-list checkboxes only when true; defaults to `selectable`. Lets a
   *  page keep always-on desktop checkboxes while gating the phone cards
   *  behind an explicit selection mode. */
  mobileSelectable?: boolean;
  selectedIds?: ReadonlySet<string | number>;
  onToggleSelect?: (id: string | number) => void;
  /** When provided (and `selectable`), renders a select-all checkbox in the
   *  desktop header, checked when every row on the page is selected. */
  onToggleSelectAll?: () => void;
  /** Per-row checkbox aria-label; defaults to "Select row". */
  rowSelectLabel?: (row: T) => string;
  loading?: boolean;
  loadingRows?: number;
  /** Rendered when rows is empty and not loading (use EmptyState). */
  empty?: React.ReactNode;
  /** Full override of the default card composition on phones. */
  renderCard?: (row: T) => React.ReactNode;
  className?: string;
}

function mobileRole<T>(col: ColumnSpec<T>) {
  return col.mobile?.role ?? "meta";
}

/**
 * The table-to-card-list primitive. Renders a real `<table>` from `md` up
 * (sticky surface header, sortable columns, optional row selection) and a
 * tappable card list below `md`. Both renderings share the column config;
 * presentation is CSS-driven (both are in the DOM, one is hidden), so
 * resizing never loses state.
 */
export default function ResponsiveTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  sort,
  onSortChange,
  selectable = false,
  mobileSelectable,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  rowSelectLabel,
  loading = false,
  loadingRows = 6,
  empty,
  renderCard,
  className,
}: ResponsiveTableProps<T>) {
  if (loading) {
    return (
      <div className={cn("rounded-lg border", className)}>
        <SkeletonRows rows={loadingRows} cols={Math.min(columns.length, 5)} className="hidden md:block" />
        <div className="space-y-3 p-3 md:hidden" aria-hidden>
          {Array.from({ length: Math.min(loadingRows, 6) }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className={cn("rounded-lg border", className)}>{empty}</div>;
  }

  const isSelected = (row: T) => selectedIds?.has(getRowId(row)) ?? false;
  const cardSelectable = mobileSelectable ?? selectable;
  const allSelected =
    rows.length > 0 && rows.every((row) => isSelected(row));

  const titleCol = columns.find((c) => mobileRole(c) === "title");
  const subtitleCol = columns.find((c) => mobileRole(c) === "subtitle");
  const badgeCols = columns.filter((c) => mobileRole(c) === "badge");
  const metaCols = columns
    .filter((c) => mobileRole(c) === "meta")
    .sort((a, b) => (a.mobile?.order ?? 0) - (b.mobile?.order ?? 0));

  const defaultCard = (row: T) => (
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 min-w-0 text-sm font-medium">
          {titleCol ? titleCol.cell(row) : getRowId(row)}
        </p>
        {badgeCols.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {badgeCols.map((c) => (
              <span key={c.key}>{c.cell(row)}</span>
            ))}
          </span>
        )}
      </div>
      {subtitleCol && (
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {subtitleCol.cell(row)}
        </p>
      )}
      {metaCols.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {metaCols.map((c) => (
            <span
              key={c.key}
              className="inline-flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground"
            >
              {(c.mobile?.label ?? (typeof c.header === "string" ? c.header : null)) && (
                <span className="shrink-0 opacity-70">
                  {c.mobile?.label ?? (c.header as string)}
                </span>
              )}
              <span className="truncate">{c.cell(row)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={cn("overflow-hidden rounded-lg border", className)}>
      {/* Desktop table */}
      <div className="hidden md:block">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {selectable && <col style={{ width: "32px" }} />}
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-sticky bg-surface text-surface-foreground">
            <tr className="border-b text-left">
              {selectable &&
                (onToggleSelectAll ? (
                  <th className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={onToggleSelectAll}
                      aria-label="Select all on this page"
                      className="h-4 w-4 accent-primary align-middle"
                    />
                  </th>
                ) : (
                  <th className="px-2 py-2" aria-label="Select" />
                ))}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-3 py-2 font-medium text-muted-foreground",
                    c.headerClassName,
                  )}
                >
                  {c.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(c.key)}
                      className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {c.header}
                      {sort?.key === c.key &&
                        (sort.dir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        ))}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const id = getRowId(row);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "bg-card transition-colors",
                    onRowClick && "cursor-pointer hover:bg-accent/40",
                    isSelected(row) && "bg-primary/5",
                  )}
                >
                  {selectable && (
                    <td
                      className="px-2 py-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected(row)}
                        onChange={() => onToggleSelect?.(id)}
                        aria-label={rowSelectLabel?.(row) ?? "Select row"}
                        className="h-4 w-4 accent-primary"
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn("truncate px-3 py-2", c.cellClassName)}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone card list */}
      <ul className="divide-y md:hidden">
        {rows.map((row) => {
          const id = getRowId(row);
          const selected = isSelected(row);
          return (
            <li key={id} className="bg-card">
              <div
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "flex min-h-16 items-start gap-3 p-3",
                  onRowClick && "cursor-pointer active:bg-accent/40",
                  selected && "bg-primary/5",
                )}
              >
                {cardSelectable && (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelect?.(id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={rowSelectLabel?.(row) ?? "Select row"}
                    className="mt-1 h-5 w-5 shrink-0 accent-primary"
                  />
                )}
                {renderCard ? renderCard(row) : defaultCard(row)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
