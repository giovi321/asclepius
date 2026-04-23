import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/api/client";
import type { SortKey } from "@/components/documents/columns";

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
const readInt = (sp: URLSearchParams, key: string, fallback: number): number => {
  const v = sp.get(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export interface UseDocumentListOpts {
  patientId?: number | null;
  limit?: number;
}

export interface UseDocumentListResult {
  items: any[];
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
  setItems: React.Dispatch<React.SetStateAction<any[]>>;
}

export function useDocumentList(opts: UseDocumentListOpts = {}): UseDocumentListResult {
  const { patientId, limit = 20 } = opts;
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFiltersState] = useState<DocumentListFilters>(() => ({
    search: readStr(searchParams, "q"),
    typeFilter: readList(searchParams, "type"),
    statusFilter: readList(searchParams, "status"),
    specialtyFilter: readList(searchParams, "specialty"),
    doctorFilter: readList(searchParams, "doctor_id"),
    facilityFilter: readList(searchParams, "facility_id"),
    dateFrom: readStr(searchParams, "date_from"),
    dateTo: readStr(searchParams, "date_to"),
  }));
  const [page, setPage] = useState(() => readInt(searchParams, "page", 0));
  const [sort, setSort] = useState<DocumentListSort>({ sortBy: null, sortOrder: "desc" });

  const [items, setItems] = useState<any[]>([]);
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
      const naturalDesc = key === "date" || key === "date_added" || key === "status";
      const naturalOrder: "asc" | "desc" = naturalDesc ? "desc" : "asc";
      if (prev.sortBy !== key) return { sortBy: key, sortOrder: naturalOrder };
      if (prev.sortOrder === naturalOrder) {
        return { sortBy: key, sortOrder: naturalOrder === "asc" ? "desc" : "asc" };
      }
      return { sortBy: null, sortOrder: naturalOrder };
    });
  }, []);

  // Mirror filter/sort/page state back to the URL so back-navigation from
  // a document detail page restores the exact view.
  useEffect(() => {
    const next = new URLSearchParams();
    if (filters.search) next.set("q", filters.search);
    if (filters.typeFilter.length) next.set("type", filters.typeFilter.join(","));
    if (filters.statusFilter.length) next.set("status", filters.statusFilter.join(","));
    if (filters.specialtyFilter.length) next.set("specialty", filters.specialtyFilter.join(","));
    if (filters.doctorFilter.length) next.set("doctor_id", filters.doctorFilter.join(","));
    if (filters.facilityFilter.length) next.set("facility_id", filters.facilityFilter.join(","));
    if (filters.dateFrom) next.set("date_from", filters.dateFrom);
    if (filters.dateTo) next.set("date_to", filters.dateTo);
    if (page) next.set("page", String(page));
    setSearchParams(next, { replace: true });
  }, [filters, page, setSearchParams]);

  const buildParams = useCallback((): Record<string, any> => {
    const params: Record<string, any> = { limit, offset: page * limit };
    if (patientId) params.patient_id = patientId;
    if (filters.search) params.q = filters.search;
    if (filters.typeFilter.length) params.type = filters.typeFilter.join(",");
    if (filters.statusFilter.length) params.status = filters.statusFilter.join(",");
    if (filters.specialtyFilter.length) params.specialty = filters.specialtyFilter.join(",");
    if (filters.doctorFilter.length) params.doctor_id = filters.doctorFilter.join(",");
    if (filters.facilityFilter.length) params.facility_id = filters.facilityFilter.join(",");
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
    api.get("/documents", { params: buildParams() }).then((res: any) => {
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
      setLoading(false);
    });
  }, [buildParams]);

  const reload = useCallback(async () => {
    const res = await api.get("/documents", { params: buildParamsRef.current() });
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
