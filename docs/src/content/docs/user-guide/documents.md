---
title: "Documents"
---

## Uploading documents

Two ingestion paths:

- **Web UI**, drag-and-drop onto the upload area or use the Upload button.
  Optionally pre-assign a patient via a fuzzy-search picker.
- **Inbox folder**, drop files into `vault/inbox/`. The watcher queues
  them automatically. To pre-assign a patient, place a `<filename>.patient_hint`
  sibling file containing the patient ID.

Supported formats: PDF, JPEG, PNG, TIFF, DICOM (.dcm), and DICOM zip
bundles (.zip). Zip uploads are extracted server-side: the DICM
preamble at byte 128 of every member is checked, true DICOM files are
auto-renamed to `.dcm`, and the rest (DICOMDIR / JPEG previews /
LOCKFILE / VERSION) is filed under `imaging-bundles/`. Default upload
cap is 1 GB. See [Imaging](/user-guide/imaging) for the full flow.

Documents appear in the list immediately with `pending` status; the pipeline
picks them up asynchronously.

## Document list

Shows documents for the selected patient, or all accessible documents when
no patient is selected.

### Sorting, columns, pagination

Columns are sortable (ascending / descending / unsorted) and togglable from
the **Columns** menu. Column choices persist per user. Pages of 20.

### Filtering

Excel-style multi-select dropdowns with search, combined with a free-text
query:

- **Type**, **Status**, **Specialty**, **Doctor**, **Facility**, multi-select
- **Date range**, from/to pickers
- **Search query**, full-text search across OCR text, filenames,
  summaries, and metadata

API parameters accept comma-separated values (e.g.
`?type=bloodtest,prescription&status=done,needs_review`).

### Persistence and sharing

Every filter and the current page are reflected in the URL, so back/forward
navigation restores state and filtered views are bookmarkable and
shareable: `?status=needs_review&type=prescription` is a valid deep link.

### Access scope

Non-admin users see documents for patients they have access to, plus any
documents they uploaded themselves. Admins see everything. Legacy rows
without `uploaded_by_user_id` stay admin-only until backfilled.

### Bulk actions

Selecting rows reveals a bulk action bar:

- **Delete**, one confirm, deletes all selected.
- **Reprocess ▾**, OCR + LLM, OCR only, or LLM only, matching the
  single-doc flow.
- **Regenerate filename**, AI filename generation for each doc; collisions
  are auto-disambiguated with `-2`, `-3`, ….

Actions run sequentially and report a single summary toast. Selection
clears automatically on filter / page / patient changes.

## Document list, row click

Clicking anywhere on a row opens the document detail page. The
checkbox column, the rename pencil, and the inline-rename input stop
event propagation so they keep their own behaviour.

## Document detail page

The left panel shows the PDF viewer for PDFs, an inline image for
JPEG / PNG / TIFF, or, for **imaging documents** (`doc_type =
'imaging_report'`, see [Imaging](/user-guide/imaging)), the same
report-PDF slot used on the imaging detail page. When the report is
attached, the PDF renders inline; when it is a placeholder, the slot
shows *Upload PDF* / *Pick existing PDF* buttons. The DICOM viewer
itself only lives on `/imaging/:studyId`; the document page header
gets an *Imaging view* button that jumps there. If the document is
missing on disk for any reason, the panel renders a clean
"file not available" empty state instead of a broken viewer (the
frontend HEAD-checks `/api/documents/{id}/file` before mounting the
viewer).

The right panel holds all extracted metadata with inline-editable
fields:

- **Type**, dropdown across the 25+ supported types
- **Dates**, document date, date issued, date of visit, date received
- **Doctor / Facility / Specialty**, searchable comboboxes with inline
  *+ Create new* when the typed text has no match. Selecting resolves
  through the alias-aware upsert, so merged entities are honored.
- **Summary**, English summary

A collapsible **Processing details** section shows OCR engine, OCR
confidence, and LLM provider/model.

### Pipeline stages

A **Pipeline stages** card on the document detail page renders the full
processing history for this document — every upload run plus every
reprocess, grouped by run. Each run card shows:

- **Kind badge** — *Upload run* (blue) or *Reprocess run* (purple).
- **Flow badge** — *Vision-LLM* (amber) or *OCR + LLM* (slate), so two
  reprocesses on the same doc with different flows are visually
  distinguishable at a glance.
- **Outcome pill** — *Completed*, *Failed*, *Cancelled*, *Running*, or
  *Skipped* (worst stage outcome wins so a run with one failed stage
  reads as failed).
- **Total duration** and start time.

Inside each run, the stages are rendered against a vertical rail with
status-coloured marker dots: green check on completed, red X on failed,
spinning blue loader on the active stage, amber ban on cancelled. Each
row shows the stage name, status, duration, page count where relevant
(`pages 1–49/49` for OCR), and the error message for failed stages.

The newest run sits on top. While this document is the active pipeline
job, a *Live* ping pill appears in the card header and the timeline
polls every 2.5 seconds so stages tick in as the worker advances.
Underlying data comes from `GET /api/documents/{id}/stages` and is
persisted across runs in the `document_stage_events` table.

### AI Edit

Apply natural-language instructions to the metadata, e.g. "Change the
doctor to Dr. Mueller" or "This is a prescription, not a specialist
report". The LLM updates only the relevant fields.

### Tags, notes, sections

Tags (comma-separated) and free-text notes are available. Multi-page
documents processed with page-level sectioning also show a sections panel
(section type, page range, brief summary).

### Extracted data

Structured extractions appear as tables below the metadata: lab results,
medications, encounters, vaccinations.

### Linked documents and medical events

Related documents can be linked with a relationship type, *invoice for*,
*report for*, *imaging for*, *follow up*, *related*. **Suggest Links** asks
the LLM to recommend related documents for the same patient. Documents can
be assigned to a medical event, with a **Suggest Event** affordance for LLM
suggestions.

## Reprocessing

The **Reprocess** dropdown re-runs processing on a document. Choose:

- **What to reprocess**, OCR + LLM, OCR only, LLM only, or Vision-LLM (the
  single-step vision flow).
- **Provider overrides**, pick a specific OCR, LLM, or Vision-LLM provider
  instead of the default (highest priority).

LLM / Vision-LLM reprocessing clears previously extracted metadata and
child records first, so you get a clean slate.

Useful for trying a different engine, moving a document onto the
Vision-LLM flow, re-running with a more capable model, or rescuing
documents marked "done" with empty results.

## Cancelling processing

The **Cancel** action aborts the in-flight LLM or OCR request immediately:
the asyncio task is hard-cancelled (raising `CancelledError` in whatever
`await` is in flight), the credential's concurrency slot is released, and
the processing chip disappears within a second. A cooperative flag is also
set as a fallback. The Delete action uses the same path, so deleting a
document mid-processing leaves no orphan requests running against the LLM
server.

## Deleting documents

Delete permanently removes the file on disk and all database records
(document + child tables via CASCADE). If the document is processing, it
is cancelled first.

Admins can delete any document. Editors and owners can delete documents
for accessible patients. Viewers cannot delete.

## Moving documents

Reassigning a document to a different patient moves the file on disk to
the new patient's directory and updates all child records. Only users with
the `owner` role can move documents.

## Moving files in the file browser

Files can also be relocated from the **Files** page (`/files`). Each
row has a *Move* action that calls `POST /api/vault/move`; the file is
renamed on disk and the matching `documents.file_path`,
`imaging_studies.folder_path`, and `imaging_series.folder_path` rows
are rewritten in lockstep so the document reference stays intact.
Useful when a file landed in the wrong date or event folder and you
want to fix it without breaking links to the document detail page.

Access scope is enforced on both endpoints: a user can only move a
file between two paths their role lets them see. Moves that would land
inside the source directory itself are rejected (no infinite-loop
folders).
