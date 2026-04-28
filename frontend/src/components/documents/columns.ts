export type ColumnKey =
  | "type"
  | "date"
  | "doctor"
  | "facility"
  | "patient"
  | "specialty"
  | "status"
  | "date_added";

export type SortKey = ColumnKey | "file";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  /** CSS width used in the table colgroup. */
  width: string;
}

export const COLUMNS: ColumnDef[] = [
  { key: "type", label: "Type", defaultVisible: true, width: "14%" },
  { key: "date", label: "Date", defaultVisible: true, width: "12%" },
  { key: "facility", label: "Facility", defaultVisible: true, width: "22%" },
  { key: "doctor", label: "Doctor", defaultVisible: false, width: "16%" },
  { key: "patient", label: "Patient", defaultVisible: false, width: "14%" },
  { key: "specialty", label: "Specialty", defaultVisible: false, width: "14%" },
  { key: "status", label: "Status", defaultVisible: true, width: "16%" },
  { key: "date_added", label: "Date added", defaultVisible: false, width: "14%" },
];

export const COLUMN_STORAGE_KEY = "asclepius_documents_columns";

/** Defaults consumed by useColumnPrefs (lib/columnPrefs.ts) so SettingsPage
 * and DocumentsPage agree on the ordering / visibility baseline. */
export const DOCUMENTS_DEFAULTS = {
  visible: COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key as string),
  order: COLUMNS.map((c) => c.key as string),
};

/**
 * Read the user's column choice from localStorage, falling back to the
 * defaults. Invalid / stale keys from older builds are filtered out.
 */
export function loadVisibleColumns(): Set<ColumnKey> {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const valid = new Set<ColumnKey>();
        for (const k of arr) {
          if (COLUMNS.some((c) => c.key === k)) valid.add(k as ColumnKey);
        }
        if (valid.size > 0) return valid;
      }
    }
  } catch {
    /* fall through */
  }
  return new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));
}

export const DOC_TYPES = [
  "bloodtest", "labtest_other", "prescription", "invoice", "receipt",
  "insurance_claim", "referral", "discharge", "specialist_report",
  "radiology_report", "surgical_report", "vaccination",
  "imaging_report", "other",
];
