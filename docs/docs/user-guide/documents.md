# Documents

## Uploading Documents

Drop files into `vault/inbox/` or use file sync tools (Syncthing, Nextcloud) to send files to the inbox.

Supported formats: PDF, JPEG, PNG, TIFF, DICOM (.dcm)

## Document List

The Documents page shows all processed documents with:

- **Filters:** patient, document type, date range, status
- **Search:** Full-text search across OCR text
- **Sorting:** By date (newest first)
- **Pagination:** 20 documents per page

## Document Detail

Click a document to see:

- **File viewer** — View the original PDF or image
- **Metadata** — Type, date, provider, language, OCR confidence, costs
- **Lab results** — Extracted test values with reference ranges
- **Encounters** — Diagnoses, findings, follow-up instructions
- **Medications** — Prescribed drugs with dosage and frequency
- **Vaccinations** — Vaccine records
- **OCR text** — Raw extracted text

## Actions

- **Reprocess** — Re-run OCR and LLM extraction on a document
- **Edit metadata** — Manually correct type, date, patient assignment, provider

## Document Types

| Code | Description |
|------|-------------|
| `bloodtest` | Blood test / lab results |
| `labtest_other` | Non-blood lab test |
| `prescription` | Prescription |
| `invoice` | Invoice / bill |
| `discharge` | Discharge letter |
| `specialist_report` | Specialist consultation |
| `radiology_report` | Radiology report |
| `vaccination` | Vaccination record |
| `imaging_dicom` | DICOM imaging study |
| ... | See full list in architecture spec |
