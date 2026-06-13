import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/api/client";
import type { SortKey } from "@/components/documents/columns";
import type { Document, ListResponse } from "@/types";

export interface DocumentListFilters {
  search: string;
  typeFilter: string[];
  statusFilter: string[];
  specialtyFilter: string[];
  doctorFilter: string[];
  facilityFilter: string[];
  dateFrom: string;
  dateTo: string;
}

export interface DocumentListSort {
  sortBy: SortKey | null;
  sortOrder: "asc" | "desc";
}

const EMPTY_FILTERS: DocumentListFilters = {
  search: "",
  typeFilter: [],
  statusFilter: [],
  specialtyFilter: [],
  doctorFilter: [],
  facilityFilter: [],
  dateFrom: "",
  dateTo: "",
};

const readList = (sp: URLSearchParams, key: string): string[] => {
  const v = sp.get(key);
  return v ? v.split(",").filter(Boolean) : [];
};
const readStr = (sp: URLSearchParams, key: string): string => sp.get(key) || "";
const readInt = (
  sp: URLSearchParams,
  key: string,
  fallback: number,
): number => {
  const v = sp.get(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// sessionStorage-backed cache so filters / sort / page survive navigation
// to the document detail page and back via the sidebar link (which
// navigates to bare /documents with no query string). The URL still wins
// when present so direct deep-links keep working as before.
const STORAGE_KEY = "asclepius.docList.state.v1";

interface StoredState {
  filters: DocumentListFilters;
  sort: DocumentListSort;
  page: number;
}

function readStoredState(): StoredState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as StoredState;
  } catch {
    return null;
  }
}

function writeStoredState(state: StoredState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode — best-effort only */
  }
}

function readSort(sp: URLSearchParams): DocumentListSort | null {
  const sortBy = sp.get("sort") as SortKey | null;
  if (!sortBy) return null;
  const orderRaw = sp.get("order");
  const sortOrder: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
  return { sortBy, sortOrder };
}

function urlHasListState(sp: URLSearchParams): boolean {
  // Any of the keys we persist counts as "the URL is steering the view";
  // when none are present we restore from sessionStorage so the user
  // doesn't lose context just by clicking the sidebar.
  return [
    "q",
    "type",
    "status",
    "specialty",
    "doctor_id",
    "facility_id",
    "date_from",
    "date_to",
    "page",
    "sort",
    "order",
  ].some((k) => sp.has(k));
}

export interface UseDocumentListOpts {
  patientId?: number | null;
  limit?: number;
}

export interface UseDocumentListResult {
  items: Document[];
  total: number;
  loading: boolean;
  filters: DocumentListFilters;
  setFilters: (patch: Partial<DocumentListFilters>) => void;
  clearFilters: () => void;
  sort: DocumentListSort;
  setSort: (s: DocumentListSort) => void;
  toggleSort: (key: SortKey) => void;
  page: number;
  setPage: (p: number) => void;
  reload: () => Promise<void>;
  setItems: React.Dispatch<React.SetStateAction<Document[]>>;
}

export function useDocumentList(
  opts: UseDocumentListOpts = {},
): UseDocumentListResult {
  const { patientId, limit = 20 } = opts;
  const [searchParams, setSearchParams] = useSearchParams();

  // Init priority: URL params > sessionStorage > defaults. URL wins so
  // deep-links and browser-back keep working unchanged; the storage
  // fallback covers sidebar navigation back to bare /documents.
  const initial = (() => {
    if (urlHasListState(searchParams)) {
      return {
        filters: {
          search: readStr(searchParams, "q"),
          typeFilter: readList(searchParams, "type"),
          statusFilter: readList(searchParams, "status"),
          specialtyFilter: readList(searchParams, "specialty"),
          doctorFilter: readList(searchParams, "doctor_id"),
          facilityFilter: readList(searchParams, "facility_id"),
          dateFrom: readStr(searchParams, "date_from"),
          dateTo: readStr(searchParams, "date_to"),
        } as DocumentListFilters,
        page: readInt(searchParams, "page", 0),
        sort: readSort(searchParams) ?? {
          sortBy: null as SortKey | null,
          sortOrder: "desc" as const,
        },
      };
    }
    const stored = readStoredState();
    if (stored) return stored;
    return {
      filters: EMPTY_FILTERS,
      page: 0,
      sort: { sortBy: null as SortKey | null, sortOrder: "desc" as const },
    };
  })();

  const [filters, setFiltersState] = useState<DocumentListFilters>(
    initial.filters,
  );
  const [page, setPage] = useState(initial.page);
  const [sort, setSort] = useState<DocumentListSort>(initial.sort);

  const [items, setItems] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const setFilters = useCallback((patch: Partial<DocumentListFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(EMPTY_FILTERS);
    setPage(0);
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setPage(0);
    setSort((prev) => {
      const naturalDesc =
        key === "date" || key === "date_added" || key === "status";
      const naturalOrder: "asc" | "desc" = naturalDesc ? "desc" : "asc";
      if (prev.sortBy !== key) return { sortBy: key, sortOrder: naturalOrder };
      if (prev.sortOrder === naturalOrder) {
        return {
          sortBy: key,
          sortOrder: naturalOrder === "asc" ? "desc" : "asc",
        };
      }
      return { sortBy: null, sortOrder: naturalOrder };
    });
  }, []);

  // Mirror filter/sort/page state back to the URL (so deep-links + browser
  // back work) AND to sessionStorage (so sidebar navigation back to bare
  // /documents restores the previous view, which URL alone can't do).
  useEffect(() => {
    const next = new URLSearchParams();
    if (filters.search) next.set("q", filters.search);
    if (filters.typeFilter.length)
      next.set("type", filters.typeFilter.join(","));
    if (filters.statusFilter.length)
      next.set("status", filters.statusFilter.join(","));
    if (filters.specialtyFilter.length)
      next.set("specialty", filters.specialtyFilter.join(","));
    if (filters.doctorFilter.length)
      next.set("doctor_id", filters.doctorFilter.join(","));
    if (filters.facilityFilter.length)
      next.set("facility_id", filters.facilityFilter.join(","));
    if (filters.dateFrom) next.set("date_from", filters.dateFrom);
    if (filters.dateTo) next.set("date_to", filters.dateTo);
    if (page) next.set("page", String(page));
    if (sort.sortBy) {
      next.set("sort", sort.sortBy);
      next.set("order", sort.sortOrder);
    }
    setSearchParams(next, { replace: true });
    writeStoredState({ filters, sort, page });
  }, [filters, sort, page, setSearchParams]);

  const buildParams = useCallback((): Record<string, any> => {
    const params: Record<string, any> = { limit, offset: page * limit };
    if (patientId) params.patient_id = patientId;
    if (filters.search) params.q = filters.search;
    if (filters.typeFilter.length) params.type = filters.typeFilter.join(",");
    if (filters.statusFilter.length)
      params.status = filters.statusFilter.join(",");
    if (filters.specialtyFilter.length)
      params.specialty = filters.specialtyFilter.join(",");
    if (filters.doctorFilter.length)
      params.doctor_id = filters.doctorFilter.join(",");
    if (filters.facilityFilter.length)
      params.facility_id = filters.facilityFilter.join(",");
    if (filters.dateFrom) params.date_from = filters.dateFrom;
    if (filters.dateTo) params.date_to = filters.dateTo;
    if (sort.sortBy) {
      params.sort = sort.sortBy;
      params.order = sort.sortOrder;
    }
    return params;
  }, [filters, page, limit, patientId, sort]);

  // Stable ref so `reload()` can fire without depending on every filter change.
  const buildParamsRef = useRef(buildParams);
  buildParamsRef.current = buildParams;

  useEffect(() => {
    setLoading(true);
    api
      .get<ListResponse<Document>>("/documents", { params: buildParams() })
      .then((res) => {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
        setLoading(false);
      });
  }, [buildParams]);

  const reload = useCallback(async () => {
    const res = await api.get<ListResponse<Document>>("/documents", {
      params: buildParamsRef.current(),
    });
    setItems(res.data.items || []);
    setTotal(res.data.total || 0);
  }, []);

  return {
    items,
    total,
    loading,
    filters,
    setFilters,
    clearFilters,
    sort,
    setSort,
    toggleSort,
    page,
    setPage,
    reload,
    setItems,
  };
}
