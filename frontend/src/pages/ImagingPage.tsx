import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import {
  Image as ImageIcon,
  Search,
  SlidersHorizontal,
  FileText,
  FileX2,
} from "lucide-react";
import FileUpload from "@/components/FileUpload";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import ResponsiveTable, {
  type ColumnSpec,
} from "@/components/ui/ResponsiveTable";
import Select from "@/components/ui/Select";
import Sheet from "@/components/ui/Sheet";
import { useColumnPrefs } from "@/lib/columnPrefs";
import type { ListResponse } from "@/types";

const MODALITY_LABELS: Record<string, string> = {
  CT: "CT scan",
  MR: "MRI",
  US: "Ultrasound",
  XR: "X-ray",
  CR: "X-ray (computed)",
  DX: "X-ray (digital)",
  MG: "Mammography",
  PT: "PET",
  NM: "Nuclear medicine",
  RF: "Fluoroscopy",
  OT: "Other",
};
function modalityLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return MODALITY_LABELS[code.toUpperCase()] || code;
}

/** Title-case DICOM-source strings that arrive in ALL CAPS. */
function niceCase(s: string | null | undefined): string {
  if (!s) return "";
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (!letters) return s;
  const upperRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
  if (upperRatio < 0.7) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

interface Study {
  id: number;
  document_id: number;
  patient_id: number;
  patient_name: string | null;
  modality: string | null;
  body_part: string | null;
  study_date: string | null;
  doctor_name: string | null;
  facility_name: string | null;
  num_series: number;
  num_images: number;
  report_status: "placeholder" | "attached";
  report_filename: string | null;
  date_added: string | null;
}

// Column registry moved to components/imaging/columns.ts so the Settings page
// can drive visibility/ordering through the same useColumnPrefs hook the
// Documents page uses. The IMAGING_COLUMNS source of truth now lives there.
import {
  IMAGING_COLUMNS,
  IMAGING_DEFAULTS,
  type ImagingColumnKey,
} from "@/components/imaging/columns";

const PAGE_SIZE = 20;

function ReportBadge({ status }: { status: Study["report_status"] }) {
  return status === "attached" ? (
    <Badge variant="success">
      <FileText className="h-3 w-3" /> Attached
    </Badge>
  ) : (
    <Badge variant="warning">
      <FileX2 className="h-3 w-3" /> Pending
    </Badge>
  );
}

/**
 * Imaging list page. Mirrors DocumentsPage's shape: search + filter chips,
 * sortable columns, paginated results, upload zone at the top. Selecting a
 * row navigates to /imaging/:studyId for the detail view. Below `md` the
 * table collapses to a card list and the filter controls move into a Sheet.
 */
export default function ImagingPage() {
  const { selectedPatient } = usePatient();
  const navigate = useNavigate();
  const [items, setItems] = useState<Study[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalityFilter, setModalityFilter] = useState("");
  const [reportStatusFilter, setReportStatusFilter] = useState<
    "" | "placeholder" | "attached"
  >("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<string>("study_date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const params = useMemo(() => {
    const p: Record<string, any> = {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sort,
      order,
    };
    if (selectedPatient) p.patient_id = selectedPatient.id;
    if (search) p.q = search;
    if (modalityFilter) p.modality = modalityFilter;
    if (reportStatusFilter) p.report_status = reportStatusFilter;
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    return p;
  }, [
    selectedPatient,
    search,
    modalityFilter,
    reportStatusFilter,
    dateFrom,
    dateTo,
    sort,
    order,
    page,
  ]);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .get<ListResponse<Study>>("/imaging", { params })
      .then((res) => {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Reset to first page when filters change.
  useEffect(() => {
    setPage(0);
  }, [
    selectedPatient,
    search,
    modalityFilter,
    reportStatusFilter,
    dateFrom,
    dateTo,
  ]);

  const toggleSort = (key: string) => {
    if (sort === key) {
      setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setOrder("desc");
    }
  };

  const activeFilterCount = [
    modalityFilter,
    reportStatusFilter,
    dateFrom,
    dateTo,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setModalityFilter("");
    setReportStatusFilter("");
    setDateFrom("");
    setDateTo("");
  };

  const modalitySelect = (
    <Select
      value={modalityFilter}
      onChange={(e) => setModalityFilter(e.target.value)}
      aria-label="Imaging type"
    >
      <option value="">All types</option>
      {Object.entries(MODALITY_LABELS).map(([code, label]) => (
        <option key={code} value={code}>
          {label} ({code})
        </option>
      ))}
    </Select>
  );

  const reportStatusSelect = (
    <Select
      value={reportStatusFilter}
      onChange={(e) => setReportStatusFilter(e.target.value as any)}
      aria-label="Report status"
    >
      <option value="">All reports</option>
      <option value="attached">Report attached</option>
      <option value="placeholder">Report pending</option>
    </Select>
  );

  return (
    <div className="space-y-4">
      {showUpload && (
        <FileUpload
          onUploadComplete={() => {
            setShowUpload(false);
            reload();
          }}
        />
      )}

      {/* Filters: search stays inline everywhere; the selects + date range
          render inline from md up and collapse into a Sheet below md. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search body part, facility, doctor, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Desktop inline filters */}
        <div className="hidden items-center gap-2 md:flex">
          <Select
            value={modalityFilter}
            onChange={(e) => setModalityFilter(e.target.value)}
            aria-label="Imaging type"
            className="w-auto"
          >
            <option value="">All types</option>
            {Object.entries(MODALITY_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label} ({code})
              </option>
            ))}
          </Select>
          <Select
            value={reportStatusFilter}
            onChange={(e) => setReportStatusFilter(e.target.value as any)}
            aria-label="Report status"
            className="w-auto"
          >
            <option value="">All reports</option>
            <option value="attached">Report attached</option>
            <option value="placeholder">Report pending</option>
          </Select>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="From date"
            className="w-auto"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="To date"
            className="w-auto"
          />
        </div>

        {/* Phone: filter controls live in the sheet */}
        <Button
          variant="secondary"
          size="md"
          className="md:hidden"
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="info" size="sm">
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        <Button
          variant="secondary"
          size="md"
          onClick={() => setShowUpload((v) => !v)}
        >
          {showUpload ? "Hide upload" : "Upload"}
        </Button>
      </div>

      <Sheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filters"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={clearFilters}
              disabled={activeFilterCount === 0}
            >
              Clear filters
            </Button>
            <Button size="md" onClick={() => setFiltersOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-4 pt-1">
          <Field label="Type">{modalitySelect}</Field>
          <Field label="Report">{reportStatusSelect}</Field>
          <Field label="From date">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </Field>
          <Field label="To date">
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>

      {/* Table (md+) / card list (below md) — column visibility/order is
          driven by the Settings page (Table columns tab). We resolve the
          user's prefs once here and render each column key by name so
          visibility and reordering both work without the body falling out
          of sync with the headers. */}
      <ImagingTable
        items={items}
        loading={loading}
        sort={sort}
        order={order}
        toggleSort={toggleSort}
        navigate={navigate}
      />

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}-
            {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const CELL_CLASSES: Partial<Record<ImagingColumnKey, string>> = {
  body_part: "text-muted-foreground",
  study_date: "text-muted-foreground tabular-nums",
  facility: "text-muted-foreground",
  doctor: "text-muted-foreground",
  date_added: "text-muted-foreground tabular-nums",
};

function cellContent(key: ImagingColumnKey, s: Study): React.ReactNode {
  switch (key) {
    case "modality":
      return modalityLabel(s.modality);
    case "body_part":
      return niceCase(s.body_part) || "Unknown";
    case "study_date":
      return s.study_date || "";
    case "facility":
      return s.facility_name || "";
    case "doctor":
      return s.doctor_name || "";
    case "report_status":
      return <ReportBadge status={s.report_status} />;
    case "date_added":
      return s.date_added ? s.date_added.slice(0, 10) : "—";
  }
}

function ImagingTable({
  items,
  loading,
  sort,
  order,
  toggleSort,
  navigate,
}: {
  items: Study[];
  loading: boolean;
  sort: string;
  order: "asc" | "desc";
  toggleSort: (k: string) => void;
  navigate: (p: string) => void;
}) {
  const prefs = useColumnPrefs("imaging", IMAGING_DEFAULTS);
  const ordered = [
    ...prefs.order.filter((k) => IMAGING_COLUMNS.some((c) => c.key === k)),
    ...IMAGING_COLUMNS.map((c) => c.key as string).filter(
      (k) => !prefs.order.includes(k),
    ),
  ];
  const visibleCols = ordered
    .filter((k) => prefs.visible.includes(k))
    .map((k) => IMAGING_COLUMNS.find((c) => c.key === k))
    .filter((c): c is NonNullable<typeof c> => !!c);

  const columns: ColumnSpec<Study>[] = visibleCols.map((c) => ({
    key: c.key,
    header: c.label,
    width: c.width,
    sortable: true,
    cell: (s) => cellContent(c.key, s),
    cellClassName: CELL_CLASSES[c.key],
  }));

  return (
    <ResponsiveTable
      columns={columns}
      rows={items}
      getRowId={(s) => s.id}
      onRowClick={(s) => navigate(`/imaging/${s.id}`)}
      sort={{ key: sort, dir: order }}
      onSortChange={toggleSort}
      loading={loading}
      empty={
        <EmptyState
          icon={ImageIcon}
          title="No imaging studies found"
          description="Upload DICOM files or imaging reports and the studies will show up here."
        />
      }
      renderCard={(s) => (
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 min-w-0 text-sm font-medium">
              {modalityLabel(s.modality)}
              {s.body_part ? ` — ${niceCase(s.body_part)}` : ""}
            </p>
            <span className="shrink-0">
              <ReportBadge status={s.report_status} />
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[
              s.study_date,
              s.patient_name,
              `${s.num_series} series · ${s.num_images} images`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
    />
  );
}
