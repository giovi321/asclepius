import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Columns3,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import MultiSelect from "@/components/ui/MultiSelect";
import Sheet from "@/components/ui/Sheet";
import { useDoctors, useFacilities, useSpecialties } from "@/hooks/data";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import { COLUMNS, DOC_TYPES, type ColumnKey } from "./columns";

export interface DocumentFiltersValue {
  search: string;
  typeFilter: string[];
  statusFilter: string[];
  specialtyFilter: string[];
  doctorFilter: string[];
  facilityFilter: string[];
  dateFrom: string;
  dateTo: string;
}

export interface DocumentFiltersProps extends DocumentFiltersValue {
  onChange: (patch: Partial<DocumentFiltersValue>) => void;
  onClearAll: () => void;
  visibleCols: Set<ColumnKey>;
  onVisibleColsChange: (next: Set<ColumnKey>) => void;
  onUploadClick: () => void;
}

const STATUS_OPTIONS = [
  { value: "__blank__", label: "(blank)" },
  { value: "done", label: "Done" },
  { value: "processing", label: "Processing" },
  { value: "pending", label: "Pending" },
  { value: "needs_review", label: "Needs Review" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

interface ChipSpec {
  key: string;
  label: string;
  onRemove: () => void;
}

function FilterChip({ chip }: { chip: ChipSpec }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 text-xs">
      <span className="truncate">{chip.label}</span>
      <button
        type="button"
        onClick={chip.onRemove}
        aria-label={`Remove filter: ${chip.label}`}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground coarse:p-1"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * Top-of-page filter controls for DocumentsPage.
 *
 * Desktop (md+): the flex-wrap toolbar — search + five multi-selects +
 * column toggle popover + upload button, then the date-range / clear row.
 * Phones: full-width search + a "Filters" button (active count badge)
 * opening a Sheet that stacks every control, with removable active-filter
 * chips under the search row. The upload FAB lives on the page itself.
 */
export default function DocumentFilters({
  search,
  typeFilter,
  statusFilter,
  specialtyFilter,
  doctorFilter,
  facilityFilter,
  dateFrom,
  dateTo,
  onChange,
  onClearAll,
  visibleCols,
  onVisibleColsChange,
  onUploadClick,
}: DocumentFiltersProps) {
  const { data: specialtiesData } = useSpecialties();
  const { data: doctorsData } = useDoctors();
  const { data: facilitiesData } = useFacilities();
  const specialties = specialtiesData ?? [];
  const doctors = (doctorsData ?? []) as any[];
  const facilities = (facilitiesData ?? []) as any[];

  const [colsOpen, setColsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(colsRef, () => setColsOpen(false), colsOpen);

  const hasAnyFilter = !!(
    dateFrom ||
    dateTo ||
    typeFilter.length ||
    statusFilter.length ||
    specialtyFilter.length ||
    doctorFilter.length ||
    facilityFilter.length
  );

  // One removable chip per active filter group: "<value>" when a single
  // value is selected, "<label> × <count>" otherwise. Removing a chip
  // clears that whole group.
  const chips = useMemo<ChipSpec[]>(() => {
    const out: ChipSpec[] = [];
    const group = (
      key: string,
      label: string,
      selected: string[],
      resolve: (v: string) => string,
      clear: () => void,
    ) => {
      if (selected.length === 0) return;
      out.push({
        key,
        label:
          selected.length === 1
            ? resolve(selected[0])
            : `${label} × ${selected.length}`,
        onRemove: clear,
      });
    };
    group(
      "type",
      "Type",
      typeFilter,
      (v) => (v === "__blank__" ? "(blank)" : v.replace(/_/g, " ")),
      () => onChange({ typeFilter: [] }),
    );
    group(
      "status",
      "Status",
      statusFilter,
      (v) => STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v,
      () => onChange({ statusFilter: [] }),
    );
    group(
      "specialty",
      "Specialty",
      specialtyFilter,
      (v) => {
        if (v === "__blank__") return "(blank)";
        const s = specialties.find(
          (x: any) => (x.canonical_code || x.canonical_display) === v,
        );
        return s?.canonical_display || s?.canonical_code || v;
      },
      () => onChange({ specialtyFilter: [] }),
    );
    group(
      "doctor",
      "Doctor",
      doctorFilter,
      (v) => {
        if (v === "__blank__") return "(blank)";
        const d = doctors.find((x) => String(x.id) === v);
        return d?.canonical_display || d?.name || v;
      },
      () => onChange({ doctorFilter: [] }),
    );
    group(
      "facility",
      "Facility",
      facilityFilter,
      (v) => {
        if (v === "__blank__") return "(blank)";
        const f = facilities.find((x) => String(x.id) === v);
        return f?.canonical_display || f?.name || v;
      },
      () => onChange({ facilityFilter: [] }),
    );
    if (dateFrom) {
      out.push({
        key: "date_from",
        label: `From ${dateFrom}`,
        onRemove: () => onChange({ dateFrom: "" }),
      });
    }
    if (dateTo) {
      out.push({
        key: "date_to",
        label: `To ${dateTo}`,
        onRemove: () => onChange({ dateTo: "" }),
      });
    }
    return out;
  }, [
    typeFilter,
    statusFilter,
    specialtyFilter,
    doctorFilter,
    facilityFilter,
    dateFrom,
    dateTo,
    specialties,
    doctors,
    facilities,
    onChange,
  ]);

  // The five multi-selects, shared between the desktop toolbar and the
  // phone filter sheet (each render spot gets its own instance).
  const renderFilterSelects = () => (
    <>
      <MultiSelect
        label="Type"
        options={[
          { value: "__blank__", label: "(blank)" },
          ...DOC_TYPES.map((t) => ({
            value: t,
            label: t.replace(/_/g, " "),
          })),
        ]}
        selected={typeFilter}
        onChange={(v: string[]) => onChange({ typeFilter: v })}
      />

      <MultiSelect
        label="Status"
        options={STATUS_OPTIONS}
        selected={statusFilter}
        onChange={(v: string[]) => onChange({ statusFilter: v })}
        searchable={false}
      />

      <MultiSelect
        label="Specialty"
        options={[
          { value: "__blank__", label: "(blank)" },
          ...specialties.map((s: any) => ({
            value: s.canonical_code || s.canonical_display,
            label: s.canonical_display || s.canonical_code,
          })),
        ]}
        selected={specialtyFilter}
        onChange={(v: string[]) => onChange({ specialtyFilter: v })}
      />

      <MultiSelect
        label="Doctor"
        options={[
          { value: "__blank__", label: "(blank)" },
          ...doctors.map((d: any) => ({
            value: String(d.id),
            label: d.canonical_display || d.name,
          })),
        ]}
        selected={doctorFilter}
        onChange={(v: string[]) => onChange({ doctorFilter: v })}
      />

      <MultiSelect
        label="Facility"
        options={[
          { value: "__blank__", label: "(blank)" },
          ...facilities.map((f: any) => ({
            value: String(f.id),
            label: f.canonical_display || f.name,
          })),
        ]}
        selected={facilityFilter}
        onChange={(v: string[]) => onChange({ facilityFilter: v })}
      />
    </>
  );

  const searchBox = (
    <div className="relative flex-1 min-w-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        placeholder="Search documents..."
        value={search}
        onChange={(e) => onChange({ search: e.target.value })}
        className="pl-9"
      />
    </div>
  );

  return (
    <>
      {/* ── Phone: search + Filters button, then active-filter chips ── */}
      <div className="space-y-2 md:hidden">
        <div className="flex items-center gap-2">
          {searchBox}
          <Button
            variant="secondary"
            size="md"
            onClick={() => setFiltersOpen(true)}
            className="shrink-0 gap-1.5"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Filters
            {chips.length > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {chips.length}
              </span>
            )}
          </Button>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <FilterChip key={chip.key} chip={chip} />
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filters"
        footer={
          <>
            <Button variant="secondary" onClick={onClearAll}>
              Clear all
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </>
        }
      >
        <div className="flex flex-col items-start gap-3">
          {renderFilterSelects()}
          <label className="flex w-full flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Date from</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => onChange({ dateFrom: e.target.value })}
            />
          </label>
          <label className="flex w-full flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Date to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => onChange({ dateTo: e.target.value })}
            />
          </label>
        </div>
      </Sheet>

      {/* ── Desktop: flex-wrap toolbar + date-range row ── */}
      <div className="hidden md:flex flex-wrap gap-2 items-start">
        <div className="flex-1 min-w-[200px]">{searchBox}</div>

        {renderFilterSelects()}

        <div ref={colsRef} className="relative ml-auto hidden md:flex">
          <button
            onClick={() => setColsOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
            title="Show/hide columns"
          >
            <Columns3 className="h-4 w-4" />
            Columns
            <ChevronDown className="h-3 w-3" />
          </button>
          {colsOpen && (
            <div className="absolute right-0 top-full mt-1 z-dropdown w-52 rounded-lg border bg-popover shadow-overlay p-2">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Visible columns
              </div>
              {COLUMNS.map((c) => (
                <label
                  key={c.key}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={visibleCols.has(c.key)}
                    onChange={() => {
                      const next = new Set(visibleCols);
                      if (next.has(c.key)) next.delete(c.key);
                      else next.add(c.key);
                      onVisibleColsChange(next);
                    }}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
              <div className="mt-1 border-t pt-1">
                <button
                  onClick={() =>
                    onVisibleColsChange(
                      new Set(
                        COLUMNS.filter((c) => c.defaultVisible).map(
                          (c) => c.key,
                        ),
                      ),
                    )
                  }
                  className="w-full rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Reset to defaults
                </button>
              </div>
            </div>
          )}
        </div>

        <Button variant="primary" size="md" onClick={onUploadClick}>
          <Upload className="h-4 w-4" aria-hidden />
          Upload
        </Button>
      </div>

      <div className="hidden md:flex flex-wrap gap-3 items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Date from:</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
            className="w-auto"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">to:</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => onChange({ dateTo: e.target.value })}
            className="w-auto"
          />
        </label>
        {hasAnyFilter && (
          <button
            onClick={onClearAll}
            className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" /> Clear all filters
          </button>
        )}
      </div>
    </>
  );
}
