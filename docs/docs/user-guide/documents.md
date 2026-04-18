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

Documents can be filtered using **Excel-style multi-select dropdowns** with search. Each filter supports selecting multiple values simultaneously:

- **Document type** (bloodtest, prescription, specialist_report, etc.) -- multi-select with search
- **Status** (pending, processing, done, failed, needs_review, cancelled) -- multi-select
- **Specialty** -- multi-select with search, populated from extracted specialties
- **Doctor** -- multi-select with search, populated from the doctors table
- **Facility** -- multi-select with search, populated from the facilities table
- **Date range** (from/to date pickers)
- **Search query** (full-text search across OCR text, filenames, summaries, and metadata)

Each dropdown supports:

- **Search within options** -- type to filter the option list
- **Select all / Clear** -- bulk select or deselect all options
- **Add search results to selection** -- when searching, add all matching results to your current selection
- **Badge count** -- shows how many values are selected
- **Clear all filters** button -- resets all active filters at once

All filter parameters support comma-separated multi-values in the API (e.g., `?type=bloodtest,prescription&status=done,needs_review`).

### Pagination

Documents are loaded in pages of 20. Use the Previous/Next controls at the bottom to navigate.

### Filter + search persistence

Every active filter — search query, doc type, status, specialty, doctor, facility, date range, and the current page — is mirrored into the URL query string. Open a document, hit browser Back, and you land on the exact same filter state you were in. The URL is also bookmarkable and shareable: `?status=needs_review&type=prescription` is a valid deep-link into the filtered view.

### Access scope

Non-admin users see only documents for patients they have access to, plus any documents they uploaded themselves (even unclassified ones). Admins see everything. Legacy rows that pre-date the per-user attribution column stay admin-only until their `uploaded_by_user_id` is backfilled.

### Bulk Actions

Tick the checkbox on any row (or the header checkbox to select every visible document on the current page). When at least one row is selected, a subdued action bar appears above the table:

- **Delete** -- remove every selected document. One confirm prompt up front.
- **Reprocess ▾** -- drops a small menu for *OCR + LLM*, *OCR only*, or *LLM only*, matching the single-doc reprocess flow.
- **Regenerate filename** -- runs AI filename generation on each selected doc and renames the file on disk and in the DB. On collisions (related docs often produce the same AI slug), the rename endpoint auto-disambiguates by appending `-2`, `-3`, … to the stem.
- **Clear** -- deselect everything.

Each bulk action runs sequentially and reports a single toast at the end: *"Delete: 18/20 done, 2 failed — #3: reason • #7: reason"*. Selection clears automatically when you change filters, page, or patient.

## Document Detail Page

Click any document to open the detail view with:

### PDF Viewer

The left panel shows the PDF in an embedded viewer. For DICOM studies, the imaging viewer is shown instead.

### Metadata Panel

The right panel shows all extracted metadata, all fields are **inline-editable** -- click any field to edit:

- **Document type** -- dropdown selector with all 25+ supported types
- **Dates** -- document date, date issued, date of visit, date received
- **Doctor** -- searchable combobox over the existing doctors list, with a **+ Create new** row when the typed text has no exact match. Selecting an existing entry (or creating one inline) also sets the document's `doctor_id` so it's not a dangling text-only value. Goes through the alias-aware upsert, so if you merged two doctors earlier, typing the old name will correctly resolve to the merged target.
- **Facility** -- same searchable combobox + inline-create over the facilities list.
- **Specialty** -- same combobox over existing specialties. Saves as text on the document (specialty IDs are linked later by the extractor).
- **Summary** -- English summary of the document content

A collapsible **Processing details** section shows technical metadata: OCR engine name, OCR confidence score, and the LLM provider/model used for extraction.

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

Click the **Reprocess** dropdown button to re-run processing on a document. A popover lets you choose:

- **What to reprocess:**
    - **OCR + LLM** -- full reprocess (re-extract text and re-run LLM analysis)
    - **OCR only** -- re-extract text without re-running LLM
    - **LLM only** -- re-run LLM analysis using existing OCR text
- **OCR Provider** (when OCR is included) -- select which OCR provider to use by name, or leave as default (highest priority)
- **LLM Provider** (when LLM is included) -- select which LLM provider to use by name, or leave as default (highest priority)

When reprocessing with LLM, all previously extracted metadata (document type, dates, doctor, facility, summary, etc.) and child records (lab results, medications, encounters, etc.) are **cleared before re-extraction**, ensuring a clean slate rather than stale data persisting.

This is useful for:

- Trying a different OCR engine (e.g., switching from Tesseract to Chandra for better quality)
- Re-running extraction with a more capable LLM model
- Fixing documents that were marked "done" with empty results

## Cancelling Processing

For documents currently being processed, click **Cancel** to stop processing. The pipeline checks for cancellation between each step.

## Deleting Documents

Click **Delete** to permanently remove a document:

- The file is deleted from disk
- All database records (document + child tables) are removed via CASCADE
- If the document was being processed, it is cancelled first

Admins can delete any document. Editors and owners can delete documents for patients they have access to. Viewers cannot delete documents.

## Moving Documents

To reassign a document to a different patient:

1. Open the document detail page
2. Change the patient assignment
3. The file is moved on disk to the new patient's directory
4. All child records (lab results, encounters, etc.) are updated

Only users with the `owner` role can move documents.
