/**
 * Barrel re-export for the per-record sections rendered on the Document
 * Detail / Imaging Detail pages. Each section now lives in its own file
 * under ``child-records/``; this module preserves the original import
 * surface (``@/components/document-detail/ChildRecordSections``) so callers
 * are unaffected by the split.
 */
export { EncountersSection } from "@/components/document-detail/child-records/EncountersSection";
export { MedicationsSection } from "@/components/document-detail/child-records/MedicationsSection";
export { VaccinationsSection } from "@/components/document-detail/child-records/VaccinationsSection";
export { DocumentSectionsList } from "@/components/document-detail/child-records/DocumentSectionsList";
export { ImagingStudiesSection } from "@/components/document-detail/child-records/ImagingStudiesSection";
