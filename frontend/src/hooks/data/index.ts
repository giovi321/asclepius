import { createResource } from "./createResource";

/**
 * Canonical normalization-table entries. Shape mirrors the
 * /api/normalization/<type> response: each row carries `id`,
 * `canonical_display`, and a handful of counters — callers generally
 * only read `id` and `canonical_display`.
 */
export interface NormEntry {
  id: number;
  canonical_code?: string | null;
  canonical_display: string;
  name?: string | null;
  slug?: string | null;
  alias_count?: number;
  unreviewed_count?: number;
}

export interface PatientSummary {
  id: number;
  slug: string;
  display_name: string;
  date_of_birth?: string | null;
  sex?: string | null;
}

export const useDoctors = createResource<NormEntry[]>("/normalization/doctors");
export const useFacilities = createResource<NormEntry[]>("/normalization/facilities");
export const useSpecialties = createResource<NormEntry[]>("/normalization/specialties");
export const useLabTests = createResource<NormEntry[]>("/normalization/lab_tests");
export const useDiagnoses = createResource<NormEntry[]>("/normalization/diagnoses");
export const useMedications = createResource<NormEntry[]>("/normalization/medications");
export const usePatients = createResource<PatientSummary[]>("/patients");
