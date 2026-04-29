---
title: "Medical Imaging"
---

## Supported formats

- **DICOM** (.dcm, .dicom) — native medical imaging format from CT, MRI,
  X-ray, ultrasound, and other modalities
- **DICOM zip bundles** (.zip) — the format every imaging CD / hospital
  export ships in: extension-less DICOM frames (e.g. ``I1000000``), a
  ``DICOMDIR`` manifest, JPEG previews, and bookkeeping files. The
  extractor inspects byte 128 of every member for the ``DICM`` preamble
  and auto-renames true DICOM files to ``.dcm``; everything else is
  filed under ``imaging-bundles/`` and surfaced from the imaging detail
  page.
- **Radiology reports** (.pdf) — the doctor's narrative for a study.
  Uploaded separately or auto-attached to a study via the imaging detail
  page (see *Radiology reports* below).

The default upload cap is 1 GB so a realistic CT/MRI exam fits in one
request. Both ``application/zip`` and ``application/x-zip-compressed``
mimes are accepted.

## Pages and routing

- ``/imaging`` — list page modelled on ``/documents``: search across
  body part / facility / doctor / study description,
  modality filter, date range filter, *report status* filter
  (``placeholder`` vs ``attached``), sortable columns, paginated 20
  rows / page. Clicking anywhere on a row opens the detail page.
- ``/imaging/:studyId`` — detail page for one study. Layout:
  - **Header** with the modality + body part + study date, plus a
    *Document view* button (jumps to the parent document) and a
    *Delete* button.
  - **Editable summary** (the same component used on the document
    detail page).
  - **Full-width DICOM viewer** with the per-series breakdown +
    auxiliary bundle files + linked documents below it.
  - **Two-column grid** with the **report PDF slot** on the left
    (PDF viewer when a report is attached, *Upload PDF* / *Pick
    existing PDF* buttons when it isn't) and the document
    **MetadataEditor + EventSelector + NotesEditor + LinksSection**
    on the right — identical to ``/documents/:id``.

## DICOM viewer

The viewer renders one frame at a time as PNG (the backend converts
on-demand from the source DICOM). Interactions:

- **Frame navigation**: arrow keys, mouse wheel, prev/next buttons,
  slider.
- **Zoom**: ``Ctrl+wheel``, ``+`` / ``-`` keys, toolbar buttons. Range
  25%–800%. Double-click resets zoom + pan.
- **Pan**: middle-mouse-button or ``shift``+drag. ``0`` resets the view.
- **Contrast (MR only)**: when the modality is ``MR`` two paired
  controls appear for *Window center* and *Window width*. Each axis
  has a number input (precise typed value) plus a slider whose thumb
  reflects the *real* current value — the file's own
  ``WindowCenter`` / ``WindowWidth`` when on auto, or the user's
  override when manual. The slider range adapts around the auto
  value so dragging stays useful regardless of modality. Either
  axis can be moved independently — the missing axis falls back to
  the file's tag — and *Reset* clears both back to auto. The viewer
  also has an **Invert colours** toggle (sends ``?invert=1`` so the
  PNG comes back inverted post-windowing) and a **Metadata** button
  that opens a panel listing every DICOM header tag for the current
  frame, with a search filter.
- Other modalities use the file's stored windowing or a default
  min-max normalisation if none is present.

## Radiology reports

In v0.9.6 the data model was flipped so a clinician's mental model
matches the database: **the document is the report PDF, and the imaging
study is its child**. ``imaging_studies.document_id`` always points at
a row in ``documents``; that row is either a **real PDF report** or a
**placeholder** (``doc_type='imaging_report'``, ``file_path=''``)
waiting to be populated.

Two ways to attach a report from the empty-state slot:

- **Upload PDF** — multipart upload to ``POST /api/imaging/{id}/report``.
  PDF-only is enforced via libmagic. The PDF lands in the user's inbox,
  the standard pipeline (OCR + LLM extraction) processes it, and on
  completion the imaging study is repointed at the new document and
  the placeholder row is deleted. The same flow works from
  ``/documents/:id`` for an imaging document — the page renders the
  same shared *ReportSlot* component.
- **Pick existing PDF** — a slim search dialog over the patient's
  already-uploaded PDFs. Selecting calls
  ``POST /api/imaging/{id}/report`` with ``{"document_id": <id>}``.
  The placeholder is deleted; the chosen PDF document is repointed at
  this study.

Once a report is attached, ``imaging_studies.report_status`` flips to
``attached`` and the slot renders the PDF inline using the same
PdfViewer used on the documents page.

The attached state is no longer one-shot. The PDF viewer panel now
exposes:

- **Replace with PDF** — upload a different PDF; the imaging study
  is repointed at the new one once processing finishes. The previous
  PDF document stays alive (it's just no longer this study's parent).
- **Pick different PDF** — same shape as the empty-state picker but
  excludes the currently-attached document.
- **Detach** — calls ``DELETE /api/imaging/{id}/report``, which
  creates a fresh placeholder and repoints the study at it. The
  previously-attached PDF document is left in the documents list so
  the user can re-attach it (or anything else) later.

## Cross-links between documents and imaging

- On the imaging detail page (``/imaging/:studyId``) the header has a
  *Document view* button → ``/documents/{report_doc_id}``.
- On the document detail page (``/documents/:id``) any document that is
  the parent of an imaging study gets an *Imaging view* button in the
  header → ``/imaging/{study_id}``. This appears for both attached
  PDF reports and placeholders.
- A document opened directly that has no real file (placeholder) shows
  a clean empty-state card with an *Open in Imaging view* button
  instead of the generic file-missing message.

## DICOM ingestion (pipeline)

When a DICOM file (or zip bundle) lands in the inbox:

1. **Watcher** picks the file up and queues it for the pipeline worker.
2. **DICOM dispatch**: ``.dcm`` / ``.dicom`` files (or files renamed
   from extension-less zip members) skip OCR and go straight to
   ``process_dicom`` in ``backend/asclepius/pipeline/dicom_ingest.py``.
3. **Metadata extraction** via pydicom: PatientName,
   ReferringPhysicianName (both parsed from DICOM PN syntax —
   ``Family^Given^Middle^Prefix^Suffix`` becomes ``Given Family``
   with the title prefix dropped), StudyDate, Modality, BodyPart,
   StudyDescription, InstitutionName, AccessionNumber,
   StudyInstanceUID, SeriesInstanceUID, SeriesNumber.
4. **Patient match**: an explicit upload-form patient selection wins
   over heuristic matching against the parsed ``PatientName``.
5. **Doctor / facility upsert**: the parsed referring physician and
   institution name are upserted into the ``doctors`` and
   ``facilities`` tables; ``imaging_studies.doctor_id`` and
   ``.facility_id`` are linked to those FKs.
6. **Study folder**: frames are written to
   ``patients/{slug}/{year}/{study-folder}/series-N/`` (peer of regular
   document files — there is no ``imaging/`` middle segment in v0.9.6+).
7. **Document row**: the first frame creates a placeholder
   ``imaging_report`` row with ``file_path=''``; every subsequent frame
   finds it via the deterministic study hash and just bumps counters.
8. **Bundle members** (DICOMDIR, JPEG previews, etc.) are copied to
   ``patients/{slug}/imaging-bundles/{zip_stem}/`` and surfaced via
   ``GET /api/imaging/{id}/bundle-files``.

### Multi-file studies

Drop the whole exam at once — usually as a single ``.zip``. Frames
sharing a ``StudyInstanceUID`` are grouped into one study;
``SeriesInstanceUID`` (or ``SeriesNumber`` as fallback) groups frames
into series. Re-uploading the same study is idempotent: a frame that
already exists at its destination with the same byte size doesn't bump
``num_images`` again.

## Data model

### Imaging studies

| Field | Description |
|-------|-------------|
| `id` | Primary key |
| `document_id` | FK → ``documents.id``: the radiology report PDF (or placeholder when no PDF is attached yet) |
| `patient_id` | FK → ``patients.id`` |
| `doctor_id` | FK → ``doctors.id``. Mirrors the parent document via the ``imaging_studies_doctor_sync`` AFTER UPDATE trigger; never edited here directly. |
| `facility_id` | FK → ``facilities.id``. Mirrors the parent document via ``imaging_studies_facility_sync``. |
| `report_status` | ``placeholder`` (no PDF attached yet) \| ``attached`` (parent document is a real PDF) |
| `modality` | DICOM Modality tag — CT, MR, US, XR, MG, PT, … (editable from the imaging detail page; corrections are recorded in ``extraction_corrections``) |
| `body_part` | Anatomical region (editable) |
| `study_description` | Description from DICOM metadata (editable) |
| `accession_number` | Hospital / RIS accession number (editable) |
| `study_instance_uid` | DICOM Study Instance UID (read-only) |
| `num_series` | Number of series in this study |
| `num_images` | Total number of frames across all series |
| `folder_path` | Path to the study folder under the vault root |

> The study date lives on the parent ``documents.event_date`` (single
> source of truth for the timeline anchor). Pre-0.9.8 imaging_studies
> had a separate ``study_date`` column; it was dropped in v0.9.8.
>
> ``institution_name``, ``referring_physician`` and ``is_dicom`` were
> dropped in v0.9.7. Doctor + facility now come exclusively from the
> parent document; the dropped TEXT columns drifted in capitalisation
> and titles vs the canonical normalised entities.

### Editing imaging metadata

Modality, body part, study description and accession number are all
editable inline on the imaging detail page using the same UX as the
documents-side ``MetadataEditor`` — click the value, type the
correction, press Enter. The PATCH lands on
``/api/imaging/{id}/metadata`` and every accepted field is recorded
against the parent document in ``extraction_corrections`` (with
``doc_type='imaging_report'``) so the same correction-driven LLM
learning loop that documents use applies to imaging metadata too.

Date, doctor and facility are NOT shown on the imaging block — they
live on the parent document and are edited via that document's
``MetadataEditor`` (single source of truth; AFTER UPDATE triggers
keep ``imaging_studies.doctor_id`` / ``.facility_id`` in lockstep).

### Imaging series

| Field | Description |
|-------|-------------|
| `id` | Primary key |
| `study_id` | FK → ``imaging_studies.id`` |
| `series_number` | Series number within the study |
| `series_description` | Description from DICOM metadata |
| `modality` | Modality for this specific series |
| `num_images` | Number of frames in this series |
| `series_instance_uid` | DICOM Series Instance UID |
| `folder_path` | Path to the series subfolder |
