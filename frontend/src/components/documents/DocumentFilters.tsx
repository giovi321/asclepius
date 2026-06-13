import { useRef, useState } from "react";
import { ChevronDown, Columns3, Search, Upload, X } from "lucide-react";
import MultiSelectFilter from "@/components/MultiSelectFilter";
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

/**
 * Top-of-page filter row for DocumentsPage: search box + multi-selects
 * (Type / Status / Specialty / Doctor / Facility), column toggle popover,
 * upload button, and the date-range + "clear all" row.
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

  return (
    <>
      <div className="flex flex-wrap gap-2 items-start">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => onChange({ search: e.target.value })}
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <MultiSelectFilter
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

        <MultiSelectFilter
          label="Status"
          options={[
            { value: "__blank__", label: "(blank)" },
            { value: "done", label: "Done" },
            { value: "processing", label: "Processing" },
            { value: "pending", label: "Pending" },
            { value: "needs_review", label: "Needs Review" },
            { value: "failed", label: "Failed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          selected={statusFilter}
          onChange={(v: string[]) => onChange({ statusFilter: v })}
          searchable={false}
        />

        <MultiSelectFilter
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

        <MultiSelectFilter
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

        <MultiSelectFilter
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

        <div ref={colsRef} className="relative ml-auto">
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
            <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-lg border bg-background shadow-xl p-2">
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

        <button
          onClick={onUploadClick}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <Upload className="h-4 w-4" />
          Upload
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Date from:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">to:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onChange({ dateTo: e.target.value })}
            className="rounded-md border bg-background px-3 py-2 text-sm"
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
