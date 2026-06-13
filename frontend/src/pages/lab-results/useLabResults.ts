import { useEffect, useState } from "react";
import api from "@/api/client";
import type { ListResponse, Patient } from "@/types";
import type { LabRow } from "./types";

/**
 * Owns the lab-results data the LabResultsPage renders: the main result
 * set, the orphan list (results pointing at a now-deleted document), the
 * loading flag, and the ``load`` refetch. Extracted verbatim from the page
 * — same fetch, same params, same error handling, same effect deps.
 *
 * ``setOrphans`` is returned so the page's per-row orphan delete handlers
 * can prune the list optimistically (matching the original behaviour).
 */
export function useLabResults(selectedPatient: Patient | null, search: string) {
  const [results, setResults] = useState<LabRow[]>([]);
  const [orphans, setOrphans] = useState<LabRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!selectedPatient) {
      setResults([]);
      setOrphans([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params: Record<string, any> = {
      patient_id: selectedPatient.id,
      limit: 500,
    };
    if (search) params.test_name = search;
    try {
      const [res, orphRes] = await Promise.all([
        api.get<ListResponse<LabRow>>("/lab-results", { params }),
        api.get<ListResponse<LabRow>>("/lab-results/orphans", {
          params: { patient_id: selectedPatient.id },
        }),
      ]);
      setResults(res.data.items || []);
      setOrphans(orphRes.data.items || []);
    } catch {
      setResults([]);
      setOrphans([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [selectedPatient, search]);

  return { results, orphans, setOrphans, loading, load };
}
