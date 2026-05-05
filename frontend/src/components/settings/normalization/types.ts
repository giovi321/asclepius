export const NORM_TYPES = [
  "lab_tests",
  "specialties",
  "diagnoses",
  "medications",
  "doctors",
  "facilities",
] as const;

export type NormType = (typeof NORM_TYPES)[number];
export const DEFAULT_NORM: NormType = "lab_tests";

export function isNormType(v: string | undefined): v is NormType {
  return !!v && (NORM_TYPES as readonly string[]).includes(v);
}

export interface NormItem {
  id: number;
  canonical_code?: string | null;
  canonical_display: string;
  name?: string | null;
  alias_count?: number;
  unreviewed_count?: number;
}
