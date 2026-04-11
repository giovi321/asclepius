# Documents

## Uploading Documents

### Via the Web UI

1. Go to **Documents** in the sidebar
2. Click **Upload** or drag-and-drop files onto the upload area
3. Optionally select a patient to pre-assign the document
4. Supported formats: **PDF**, **JPEG**, **PNG**, **TIFF**, **DICOM** (.dcm)

When uploading via the UI, a database record is created immediately so the document appears in the list right away with a `pending` status. The pipeline picks it up for processing automatically.

### Via the Inbox Folder

Drop files directly into `vault/inbox/`. The file watcher detects new files and queues them for processing. To pre-assign a patient, create a hint file alongside the document:

```
vault/inbox/document.pdf
vault/inbox/document.pdf.patient_hint    # Contains just the patient ID, e.g. "3"
```

## Document List

The Documents page shows all documents for the selected patient (or all accessible documents if no patient is selected).

### Filtering

Filter documents by:

- **Document type** (bloodtest, prescription, specialist_report, etc.)
- **Date range** (from/to)
- **Status** (pending, processing, done, failed, needs_review, cancelled)
- **Specialty**
- **Doctor**
- **Facility**
- **Search query** (full-text search across OCR text and metadata)

### Pagination

Documents are loaded in pages of 50. Use the pagination controls at the bottom to navigate.

## Document Detail Page

Click any document to open the detail view with:

### PDF Viewer

The left panel shows the PDF in an embedded viewer. For DICOM studies, the imaging viewer is shown instead.

### Metadata Panel

The right panel shows all extracted metadata, all fields are **inline-editable** -- click any field to edit:

- **Document type** -- dropdown with all supported types
- **Dates** -- document date, date issued, date of visit, date received
- **Doctor** -- extracted doctor name (linked to doctors table)
- **Facility** -- extracted facility name (linked to facilities table)
- **Specialty** -- medical specialty
- **Summary** -- English summary of the document content

### AI Edit

Click the **AI Edit** button to modify metadata using natural language instructions. Examples:

- "Change the doctor to Dr. Bianchi"
- "Set the date to March 15, 2024"
- "This is a prescription, not a specialist report"
- "The facility is Ospedale Civico"

The LLM interprets your instruction and updates only the relevant fields.

### Tags and Notes

- **Tags** -- comma-separated tags for custom categorization
- **Notes** -- free text notes visible on the document

### Document Sections

For multi-page documents that were processed with page-level sectioning, the sections panel shows:

- Section type (lab results, clinical notes, discharge summary, etc.)
- Page range (e.g., pages 3-5)
- Brief summary of each section

### Extracted Data Tables

Below the metadata, tables show all extracted structured data:

- **Lab Results** -- test name, value, unit, reference range, abnormal flag
- **Medications** -- name, dosage, form, frequency, duration
- **Encounters** -- diagnosis, findings, follow-up date and instructions
- **Vaccinations** -- vaccine name, manufacturer, lot number, dose

### Linked Documents

Link related documents together:

- **Invoice for** -- link an invoice to the medical document it covers
- **Report for** -- link a report to a related procedure
- **Imaging for** -- link imaging results to a clinical report
- **Follow up** -- link follow-up documents
- **Related** -- general relationship

Use **Suggest Links** to have the LLM recommend related documents for the same patient.

### Medical Event

Assign the document to a medical event, or use **Suggest Event** for AI-powered event matching.

## Reprocessing

Click **Reprocess** to re-run LLM extraction on a document. This:

1. Clears all existing extracted data (lab results, encounters, medications, etc.)
2. Re-runs the OCR if no text is present
3. Runs the full two-phase LLM extraction again
4. Does **not** move the file -- the path stays the same

## Cancelling Processing

For documents currently being processed, click **Cancel** to stop processing. The pipeline checks for cancellation between each step.

## Deleting Documents

Click **Delete** to permanently remove a document:

- The file is deleted from disk
- All database records (document + child tables) are removed via CASCADE
- If the document was being processed, it is cancelled first

Only users with the `owner` role on the patient can delete documents.

## Moving Documents

To reassign a document to a different patient:

1. Open the document detail page
2. Change the patient assignment
3. The file is moved on disk to the new patient's directory
4. All child records (lab results, encounters, etc.) are updated

Only users with the `owner` role can move documents.
