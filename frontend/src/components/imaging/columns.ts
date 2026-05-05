/** Column registry for the Imaging list view. Mirrors
 * components/documents/columns.ts so SettingsPage can drive both with
 * the same code path (useColumnPrefs + the shared ColumnPrefsSection). */

export type ImagingColumnKey =
  | "modality"
  | "body_part"
  | "study_date"
  | "facility"
  | "doctor"
  | "report_status"
  | "date_added";

export interface ImagingColumnDef {
  key: ImagingColumnKey;
  label: string;
  defaultVisible: boolean;
  width: string;
}

export const IMAGING_COLUMNS: ImagingColumnDef[] = [
  { key: "modality", label: "Type", defaultVisible: true, width: "12%" },
  { key: "body_part", label: "Body part", defaultVisible: true, width: "16%" },
  { key: "study_date", label: "Date", defaultVisible: true, width: "10%" },
  { key: "facility", label: "Facility", defaultVisible: true, width: "20%" },
  { key: "doctor", label: "Doctor", defaultVisible: false, width: "16%" },
  { key: "report_status", label: "Report", defaultVisible: true, width: "12%" },
  { key: "date_added", label: "Added", defaultVisible: false, width: "10%" },
];

export const IMAGING_DEFAULTS = {
  visible: IMAGING_COLUMNS.filter((c) => c.defaultVisible).map(
    (c) => c.key as string,
  ),
  order: IMAGING_COLUMNS.map((c) => c.key as string),
};
