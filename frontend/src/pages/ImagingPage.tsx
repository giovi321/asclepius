import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import {
  Image as ImageIcon,
  Search,
  ChevronUp,
  ChevronDown,
  FileText,
  FileX2,
} from "lucide-react";
import FileUpload from "@/components/FileUpload";
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
} from "@/components/imaging/columns";
const COLUMNS: { key: string; label: string; width: string }[] =
  IMAGING_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    width: c.width,
  }));

const PAGE_SIZE = 20;

/**
 * Imaging list page. Mirrors DocumentsPage's shape: search + filter chips,
 * sortable columns, paginated results, upload zone at the top. Selecting a
 * row navigates to /imaging/:studyId for the detail view.
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search body part, facility, doctor, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background pl-10 pr-3 py-2 text-sm"
          />
        </div>
        <select
          value={modalityFilter}
          onChange={(e) => setModalityFilter(e.target.value)}
          className="rounded-md border bg-background px-2 py-2 text-sm"
        >
          <option value="">All types</option>
          {Object.entries(MODALITY_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label} ({code})
            </option>
          ))}
        </select>
        <select
          value={reportStatusFilter}
          onChange={(e) => setReportStatusFilter(e.target.value as any)}
          className="rounded-md border bg-background px-2 py-2 text-sm"
        >
          <option value="">All reports</option>
          <option value="attached">Report attached</option>
          <option value="placeholder">Report pending</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-md border bg-background px-2 py-2 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-md border bg-background px-2 py-2 text-sm"
        />
        <button
          onClick={() => setShowUpload((v) => !v)}
          className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          {showUpload ? "Hide upload" : "Upload"}
        </button>
      </div>

      {/* Table — column visibility/order is driven by the Settings page
          (Table columns tab). We resolve the user's prefs once here and
          render each column key by name so visibility and reordering both
          work without the body falling out of sync with the headers. */}
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
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SortIcon = ({ active, dir }: { active: boolean; dir: "asc" | "desc" }) =>
  !active ? null : dir === "asc" ? (
    <ChevronUp className="h-3 w-3 inline" />
  ) : (
    <ChevronDown className="h-3 w-3 inline" />
  );

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
    ...prefs.order.filter((k) => COLUMNS.some((c) => c.key === k)),
    ...COLUMNS.map((c) => c.key).filter((k) => !prefs.order.includes(k)),
  ];
  const visibleCols = ordered
    .filter((k) => prefs.visible.includes(k))
    .map((k) => COLUMNS.find((c) => c.key === k))
    .filter((c): c is NonNullable<typeof c> => !!c);

  const renderCell = (key: string, s: Study) => {
    switch (key) {
      case "modality":
        return (
          <td key={key} className="px-3 py-2">
            {modalityLabel(s.modality)}
          </td>
        );
      case "body_part":
        return (
          <td key={key} className="px-3 py-2 text-muted-foreground">
            {niceCase(s.body_part) || "Unknown"}
          </td>
        );
      case "study_date":
        return (
          <td
            key={key}
            className="px-3 py-2 text-muted-foreground tabular-nums"
          >
            {s.study_date || ""}
          </td>
        );
      case "facility":
        return (
          <td key={key} className="px-3 py-2 text-muted-foreground truncate">
            {s.facility_name || ""}
          </td>
        );
      case "doctor":
        return (
          <td key={key} className="px-3 py-2 text-muted-foreground truncate">
            {s.doctor_name || ""}
          </td>
        );
      case "report_status":
        return (
          <td key={key} className="px-3 py-2">
            {s.report_status === "attached" ? (
              <span className="inline-flex items-center gap-1 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5">
                <FileText className="h-3 w-3" /> Attached
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5">
                <FileX2 className="h-3 w-3" /> Pending
              </span>
            )}
          </td>
        );
      case "date_added":
        return (
          <td
            key={key}
            className="px-3 py-2 text-muted-foreground tabular-nums"
          >
            {s.date_added ? s.date_added.slice(0, 10) : "—"}
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <colgroup>
          {visibleCols.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead className="bg-muted/30">
          <tr className="border-b">
            {visibleCols.map((c) => (
              <th
                key={c.key}
                className="text-left font-medium px-3 py-2 cursor-pointer select-none hover:bg-accent/30"
                onClick={() => toggleSort(c.key)}
              >
                {c.label} <SortIcon active={sort === c.key} dir={order} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={visibleCols.length}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                Loading...
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td
                colSpan={visibleCols.length}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                <ImageIcon className="h-6 w-6 mx-auto mb-2" />
                No imaging studies found
              </td>
            </tr>
          ) : (
            items.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/imaging/${s.id}`)}
                className="border-b cursor-pointer hover:bg-accent/30 transition-colors"
              >
                {visibleCols.map((c) => renderCell(c.key, s))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
