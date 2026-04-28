# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.12] - 2026-04-28 - graceful sphinx: major bug-fix sweep

### Fixed

- **Specialty merge** no longer fails with `foreign key constraint failed`.
  ``norm_specialties`` is referenced from ``documents.norm_specialty_id`` and
  ``doctors.norm_specialty_id`` as well as ``encounters``; the merge ref-table
  list only walked encounters, leaving the other two un-migrated rows
  pointing at the source row at delete time.
- **Lab/blood-test dates** now reliably inherit the parent document's
  ``event_date`` when the LLM emits a malformed or placeholder
  ``test_date``. Strings that don't parse as ISO ``YYYY-MM-DD`` drop to
  ``None`` so the fallback fires, and a post-insert sweep covers the edge
  case where the document's date is stamped after the lab loop runs.
- **Facility names** keep acronym tokens (``ASST``, ``AOU``, ``IRCCS``)
  instead of getting title-cased into ``Asst Milano``. Doctor names still
  go through the existing title-case + ``Dr.``/``Prof.`` mapping.
- **Specialty edits from the doc view** now actually update the displayed
  value. The PATCH handler resolves the new free-text to a
  ``norm_specialties`` id (alias / fuzzy match / auto-create) so the
  detail-view join reflects the change instead of looking like a no-op.
- **MRI viewer center/width sliders** now do something. The PNG renderer
  used to clip pixels to the window, then re-normalise the *clipped*
  array's own min/max to 0-255 — i.e. the user's window was always
  stretched back to full dynamic range, so the slider was a no-op for
  valid windows and produced all-black/all-white when the window fell
  outside the data range. The fix maps the window bounds directly to
  [0, 255]. RescaleSlope/RescaleIntercept (Modality LUT) is now applied
  before windowing so CT and rescaled MR data don't get double-shifted.
- **MRI viewer zoom** is sharper. A new ``upscale=N`` (1-4) param
  bicubic-resamples the PNG server-side; the viewer asks for 2x past
  ~1.5x zoom and 4x past ~3x, replacing the CSS-only scale path that
  produced obvious pixelation.
- **DICOM zip ingestion** picks up frames that lack the standard
  128-byte preamble (raw Implicit VR Little Endian streams from some
  vendors — that's why a 7-series export only landed 3 series before).
  ``DICOMDIR`` is special-cased to the bundle path, never the frame
  path. Series grouping uses the source folder name as a tiebreaker
  when ``SeriesInstanceUID`` is missing, so multiple series with
  overlapping ``SeriesNumber=1`` no longer collapse into one row.
- **Top-bar processing chip** closes the gap during fast-burst pipelines
  (DICOM zips, batch uploads). Polling is now adaptive — 1.5s while
  busy, 5s when idle — so the chip flickers off less often between
  files.

### Added

- **Editable encounters** — ``PATCH /api/encounters/{id}`` accepts
  ``diagnosis_original`` (resolves to ``norm_diagnosis_id``),
  ``diagnosis_code``, ``specialty_original`` (resolves to
  ``norm_specialty_id``), ``notes``, and ``findings``. Each accepted
  field is logged against the parent document in
  ``extraction_corrections`` so the few-shot retriever picks up the
  correction next time we re-process a similar doc.
- **Editable medications** — ``PATCH /api/medications/{id}`` accepts
  ``active_ingredient_original`` (resolves to ``norm_medication_id``),
  ``brand_name``, ``dosage``, ``form``, ``frequency``, ``duration``,
  ``quantity``. Same correction-logging pattern as encounters.
- **Doc-view rename UX** — when editing a doctor / facility / specialty
  on the document detail page, typing a name that isn't already a
  canonical entry pops a two-button confirm: **Fix this document only**
  (logs a correction; leaves the canonical row alone) vs **Rename
  everywhere** (calls the normalization rename endpoint so every linked
  document follows). Defaults to doc-only and the picker stays out of
  the way when the typed value matches an existing entry.
- **Per-user table column preferences** — ``user_view_prefs`` table +
  ``GET/PUT /api/settings/view-prefs/{view_key}`` carry column
  visibility and ordering per user, so the choice follows the user
  across devices instead of getting trapped in localStorage. New
  Settings → Table columns tab edits Documents and Imaging columns;
  the Documents page migrates the legacy localStorage entry up to the
  server on first run. Lab Results uses a grouped layout (not a flat
  column list) and is excluded for now.
- **Per-file upload errors** — when a bulk upload includes failed files,
  the result panel now exposes a "Show details" toggle listing the
  failed filename + reason. No more "10 uploaded, 1 failed" with
  zero clue which one.
- **Recommended LLM stack** documented as a four-tier setup: Chandra
  (OCR primary) + Tesseract (OCR fallback) + Qwen 2.5 14B (text LLM) +
  Claude Haiku (cloud fallback). The admin-guide LLM page now spells
  out the exact provider wiring.

### Changed

- **Encounters card** drops the redundant per-encounter date row (the
  document's ``event_date`` is the single source of truth shown in the
  metadata panel). The diagnosis renders as a heading-style block with
  inline edit instead of a plain key/value row.
- **Medications card** moves from a static table to one editable block
  per row, mirroring the encounters layout.
- **Event create form** has visible "Start date" / "End date" labels
  with a "leave empty if ongoing" hint; the inert HTML placeholders
  are gone.
- **LLM/OCR semaphore semantics** documented: ``max_concurrent`` is the
  absolute cap on inflight calls per credential, shared across LLM,
  Vision, and OCR purposes. Top-bar chips suffix ``(queued)`` when a
  call is waiting on the semaphore so the dual chips no longer read as
  parallel calls. (No behaviour change — this was already the
  underlying enforcement.)

## [0.9.11] - 2026-04-28 - upload double-click guard

### Fixed

- Double-clicking the upload button no longer queues the same file
  twice. The handler now uses a synchronous ref-based re-entry guard
  alongside the existing ``uploading`` state flag.

## [0.9.10] - 2026-04-28 - vault picker + inbox sweep dedupe

### Changed

- The vault file picker on the document detail page (used by the
  broken-file recovery flow) now matches the file browser's layout and
  navigation behaviour.
- Inbox sweep removes duplicate UID-less DICOM files when the same zip
  is re-uploaded; the watcher logs the path relative to the inbox
  root so duplicate-zip diagnostics are readable.

## [0.9.9] - 2026-04-28 - imaging viewer + bundle files + linked report

### Fixed

- Imaging viewer: assorted bundle-file, casing, and date display fixes;
  the linked-report row in the imaging detail page surfaces correctly.

## [0.9.8] - 2026-04-28 - editable imaging metadata + broken-file recovery

### Added

- ``PATCH /api/imaging/{id}/metadata`` for inline edits of imaging-
  specific fields (``modality``, ``body_part``, ``study_description``,
  ``accession_number``). Every accepted field is recorded against the
  parent document in ``extraction_corrections`` (with
  ``doc_type='imaging_report'``) so the same correction-driven
  few-shot learning that documents use applies to imaging metadata.
  Doctor / facility / event_date / patient are still edited only via
  ``PATCH /api/documents/{id}`` so the two endpoints can't drift.
- ImagingStudiesSection now renders editable rows (modality →
  EditableSelect with the readable label map; body_part / description /
  accession → EditableField) backed by an ``apiPath`` override the
  shared helpers gained.
- ``GET /api/documents/{id}/find-candidates`` — walks the vault for
  files whose basename matches the document's ``original_filename``
  and returns vault-relative paths. Used by the document detail page
  to recover from a broken ``file_path``.
- ``POST /api/documents/{id}/relink`` — repoint an existing document
  at a different vault file. Updates ``file_path`` + ``file_size`` only;
  does not re-run the pipeline.
- ``POST /api/documents/{id}/replace-file`` — multipart upload of a
  replacement file. Lands in the organised destination
  (``patients/{slug}/{year}/...`` based on ``event_date``), updates
  ``file_path``. Extension is locked to the original.
- DocumentViewer's missing-file empty state now auto-scans on mount,
  auto-relinks when there's exactly one match, and offers a candidate
  list, a "Pick file from vault" picker, and an "Upload replacement"
  button when the auto-scan finds 0 or >1 matches.

### Changed

- The shared ``EditableField`` and ``EditableSelect`` helpers gained
  an optional ``apiPath`` prop so callers can target endpoints other
  than the default ``/documents/{docId}``. ImagingStudiesSection uses
  it to PATCH ``/imaging/{studyId}/metadata``.

### Removed

- ``imaging_studies.study_date`` column. It duplicated
  ``documents.event_date`` (the canonical timeline anchor used by every
  other table and the timeline view) and the two drifted on user
  edits. Migration backfills any non-null ``study_date`` onto the
  parent's ``event_date`` first, then drops the column. UI / API now
  expose the value via the document join (``d.event_date as
  study_date`` aliasing) so the imaging list still sorts and filters
  on it.

## [0.9.7] - 2026-04-27 - imaging consistency + migration cleanup

### Added

- `POST /api/vault/move` — relocate a file or directory in the vault and
  rewrite ``documents.file_path`` / ``imaging_studies.folder_path`` /
  ``imaging_series.folder_path`` in lockstep so document references
  stay intact. Surfaced as a *Move* action on every row in the file
  browser.
- `HEAD /api/documents/{id}/file` — frontend probe so the document
  detail page can show a clean "file not available" empty state when
  the underlying file is missing on disk, instead of a broken pdf.js /
  ``<img>`` viewer.
- Shared `ReportSlot` component (front-end) used by both the imaging
  detail page and the imaging-flavoured document detail page so the
  upload-PDF / pick-existing-PDF UX is identical from either entry
  point.

### Changed

- Documents list: clicking anywhere on a row now opens the document
  (was: only the filename Link). Bulk-select checkbox + inline rename
  pencil + rename input still stop event propagation.
- Imaging detail page: full-width DICOM viewer (was constrained to one
  column of a 2-column grid; cross-sectional modalities had no room).
  Layout is now header → summary → full-width
  ``ImagingStudiesSection`` → 2-column grid (report PDF slot ‖
  metadata stack).
- Document detail page (imaging documents): the embedded DICOM viewer
  + bundle list are gone. The page renders the same report-PDF slot
  ImagingDetailPage uses; the DICOM viewer lives only on
  ``/imaging/:id``. The header gains an *Imaging view* cross-link.
- Imaging metadata block no longer shows *Institution* and *Referring*
  rows. Doctor and Facility are exclusively rendered via
  MetadataEditor on the parent document — single source of truth.
- ``db/init.py`` shrank from ~1490 lines to ~570. Every pre-0.9
  ALTER TABLE migration was deleted; the schema is baked into
  ``schema.sql`` and a fresh install runs no migrations at all. What
  remains is the 0.9.5 → 0.9.7 imaging ladder, each step a clearly-
  named per-version function. Anyone upgrading from before 0.9 needs
  to start from a clean database.
- ``schema.sql`` gained the ``sessions`` table + indexes (was created
  only by the migration code).

### Removed

- ``imaging_studies.institution_name`` (duplicated ``facility_id`` →
  ``facilities.name`` and drifted in capitalisation / titles).
- ``imaging_studies.referring_physician`` (duplicated ``doctor_id`` →
  ``doctors.name`` with the messy raw DICOM PN form vs the cleaned
  canonical name).
- ``imaging_studies.is_dicom`` (always 1; never read).
- All pre-0.9 migrations: ``process_at`` / ``error_message`` /
  ``role`` / ``sessions`` / ``ocr_page_cache`` / ``audit_log`` /
  ``doctor_aliases`` / ``canonical_code,canonical_display`` /
  ``date_visit``→``event_date`` unification / kebab-case sweep / etc.
  Use the bundled ``schema.sql`` for fresh installs.

## [0.9.6] - 2026-04-27 - imaging is a child of the radiology report

### Added

- `POST /api/imaging/{id}/report` — attach a radiology PDF to a study
  either by linking an existing document (``?document_id=N``) or by
  uploading a fresh PDF (multipart ``file=``). PDF-only is enforced via
  libmagic. Uploaded reports flow through the standard pipeline; an
  ``.imaging_study_hint`` sidecar tells ``process_file`` to repoint the
  study at the new document and delete the placeholder on completion.
- New route ``/imaging/:studyId`` (was: single-page
  selection-mutates-right-column with no URL change). The list page
  lives at ``/imaging`` and is modelled on ``/documents``: search,
  modality / report-status / date filters, sortable columns,
  pagination.
- Cross-link buttons: the imaging detail header has a *Document view*
  button → ``/documents/{report_doc_id}``; the document detail header
  has an *Imaging view* button → ``/imaging/{study_id}`` for any
  document that is the parent of an imaging study. Symmetric.
- ``imaging_studies.report_status`` (`placeholder` | `attached`) —
  denormalised flag so list queries don't have to join + stat.

### Changed

- **Data model flip**: an imaging study is now a child of a radiology
  REPORT document, not the other way round. ``imaging_studies.document_id``
  points at a ``documents`` row whose ``doc_type`` is
  ``imaging_report`` — either a real PDF the user attached or a
  placeholder (``file_path=''``) waiting to be populated. Every legacy
  ``doc_type='imaging_dicom'`` row is migrated to a placeholder
  ``imaging_report`` so existing studies show up correctly in the
  list.
- Imaging document type list (front-end ``DOC_TYPE_OPTIONS``,
  ``columns.ts`` ``DOC_TYPES``, ``MetadataEditor``,
  ``TimelinePage`` badge) updated: ``imaging_dicom`` →
  ``imaging_report``.

## [0.9.5] - 2026-04-27 - DICOM zip uploads + imaging consistency

### Added

- DICOM zip upload support. The upload endpoint now accepts
  ``application/zip`` (and ``.zip`` suffix), extracts every member
  server-side, peeks byte 128–131 for the ``DICM`` preamble, and
  auto-renames true DICOM files to ``.dcm`` (extension-less hospital
  exports like ``I1000000`` work). Non-DICOM members (DICOMDIR, JPEG
  previews, LOCKFILE, VERSION) get a ``.bin`` extension + a
  ``.zip_member`` sidecar and are filed under
  ``patients/{slug}/imaging-bundles/{zip_stem}/``. Default upload cap
  raised to 1 GB. Zip-bomb expansion is capped via
  ``server.max_zip_uncompressed_bytes``.
- ``GET /api/imaging/{id}/bundle-files`` and
  ``/bundle-file/{name}`` to surface auxiliary zip members (DICOMDIR,
  JPEG previews) on the imaging detail page.
- ``GET /api/imaging/{id}/links`` + POST/DELETE — link arbitrary
  documents (e.g. a separate radiology PDF) to a study via the
  existing ``document_links`` table.
- Imaging study list/detail endpoints enriched with patient,
  doctor, facility names from the parent ``documents`` join.
- Frame endpoint ``GET /api/imaging/{id}/series/{sid}/frame/{i}``
  accepts ``?wc=`` and ``?ww=`` query params for window-center /
  window-width override (used by the MR contrast sliders in the
  viewer).
- Patient access checks on ``list_frames`` / ``get_frame``
  (regression: an authenticated user could fetch any patient's DICOM
  by guessing study/series IDs).
- DICOM Person Name parser: ``Family^Given^Middle^Prefix^Suffix``
  becomes ``Given Family``; the existing ``strip_doctor_title``
  removes the title prefix. Used for both PatientName and
  ReferringPhysicianName at ingest, so doctor and patient matching
  hit the canonical normalisation pipeline.
- DICOM viewer: zoom (Ctrl+wheel, +/- keys, toolbar buttons), pan
  (middle-button or shift+drag), reset (double-click or ``0``), MR-
  only contrast sliders (window-center, window-width). Removed the
  unused ``@cornerstonejs/core`` + ``dicom-image-loader`` imports
  (~1.3 MB JS savings).

### Changed

- One DICOM bundle = one imaging study = one document row. The
  pre-0.9.5 ingest created ``N`` documents per frame (35 for an
  ultrasound) plus extra rows for bundle files. Now a deterministic
  hash of ``StudyInstanceUID`` keys the parent row and subsequent
  frames reuse it. Re-uploading the same study is idempotent — frames
  already on disk at the destination size don't bump ``num_images``
  again. Migration collapses pre-0.9.5 data: keeps the canonical row,
  drops per-frame and per-bundle-file dupes.
- Vault layout simplified: imaging studies live directly under the
  year folder (``patients/{slug}/{year}/{study-folder}/``) instead of
  inside an extra ``imaging/`` segment. A study folder is now a peer
  of a regular PDF. Migration moves on-disk folders + rewrites
  ``imaging_studies.folder_path``, ``imaging_series.folder_path``, and
  ``documents.file_path``.
- Inbox sub-folders use the patient slug (``inbox/alex-smith/``) when
  the upload knows the patient; ``user-<id>/`` is the fallback for
  uploads with no patient. A ``.user_hint`` sidecar always carries the
  uploader id. Empty inbox folders are swept after every successful
  pipeline tick.
- Imaging series merging: a NULL ``series_instance_uid`` no longer
  spawns one row per frame (was: ``WHERE x = NULL`` never matched in
  SQL). Falls back to ``(study_id, series_number)`` grouping.
  ``num_series`` on the parent study is bumped only on the first frame
  of a brand-new series (not on every frame of an existing one).
- DICOM frames now record ``file_hash`` + ``file_size`` on their
  documents row (was: 0 / unset; re-uploads inflated counters and
  documents rows).
- Topbar pipeline status: queue depth + queued-files list are now
  populated (was: only decremented; counter stuck at 0). MetricsStrip
  always renders an "idle" chip when the worker is idle, so the
  topbar isn't blank between processing ticks.

### Removed

- Per-frame and per-bundle-file ``documents`` rows (collapsed into
  one per study).

## [0.9.0] - 2026-04-22 - refactor

Major refactor release. No user-visible behavior changes planned, but the
internal layout changes significantly.

### Changed

- Backend module splits: `settings/routes.py`, `pipeline/extractor.py`,
  `config.py`, and `chat/service.py` broken into focused sub-modules.
- Pipeline globals (`pipeline_status`, `cancelled_docs`, `_running_tasks`)
  wrapped in a single `PipelineState` dataclass.
- Normalization alias lookup consolidated into
  `normalization/alias_lookup.py`.
- DB schema: dropped denormalized `documents.doctor_name` and
  `documents.facility_name`; readers now JOIN doctors / facilities.
- DB schema: unified `date_visit` / `date_issued` / `doc_date` into
  `event_date` (canonical timeline anchor) and `issued_date`
  (administrative). Migration copies forward with the historic priority
  rule and rebuilds the FTS5 index.
- Encounters / imaging_studies `doctor_id` / `facility_id` now stay in
  lockstep with the parent document via AFTER UPDATE triggers; the
  periodic re-sync migration is gone.
- LLM prompts moved from a monolithic `llm/prompts.py` (876 LOC) into
  per-prompt YAML files under `llm/prompts_data/` with a thin loader
  that preserves the legacy module-level constants.
- Frontend: shared API types generated from the FastAPI OpenAPI spec.
  Request payloads in `types.ts` now re-export from the generated
  `api/schema.ts`. Regenerate with `python backend/scripts/export_openapi.py`
  then `npm --prefix frontend run gen:api`.
- Frontend: shared data hooks under `hooks/data/` (useDoctors,
  useFacilities, useSpecialties, usePatients, …) cache results
  per-session. `DocumentsPage` migrated off three per-page refetches.
- Frontend: every routed page wrapped in its own `ErrorBoundary`.
- Backend: 4xx/5xx responses on `/api/*` now write a row to `audit_log`.
- Frontend: four mega-components split into focused sub-components:
  - `ProvidersTab` (612 -> 251 LOC) split into CredentialDialog,
    CredentialCard, AttachedModelRow, ModelForm, shared types.
  - `DocumentDetailPage` (826 -> 208 LOC) split into DocumentViewer,
    ReprocessMenu, MetadataEditor, NotesEditor, AiEditForm, LinksSection,
    and child-record sections.
  - `DocumentsPage` (869 -> 379 LOC) split into DocumentFilters,
    BulkActionsBar, DocumentTable, InlineRenameCell, shared column defs.
  - `NormalizationTab` (917 -> 495 LOC) split into NormalizationToolbar,
    AutoMergePanel, LinkedDocumentsModal, BatchMergeBar, NormalizationRow,
    shared types.

### Removed

- Trivial UI walkthrough sections from user-guide docs (timeline,
  documents, medical-events, imaging, normalization, chat, first-steps).

## [Unreleased]

### Added

- Knowledge-base layer for normalization auto-merge. Bundled
  `bundled_config/knowledge/{medications,diagnoses,lab_tests}.json` (ATC,
  ICD-10, LOINC; ~5 MB total, generated from CC0 Wikidata). Auto-merge now
  resolves entries to external codes BEFORE calling the LLM — same-code
  entries become high-confidence deterministic proposals
  (`source: "knowledge_base"`, `confidence: "high"`) and the LLM only sees
  the residual. Doctors / facilities / specialties have no public reference
  and fall through to the existing LLM path. Stdlib-only build scripts
  under `scripts/build_knowledge/` regenerate the JSON from Wikidata SPARQL.
- `NOTICE` file at the repo root, providing the LOINC short-license
  attribution required by Section 10 of the LOINC license (covers both
  the new `bundled_config/knowledge/lab_tests.json` and the pre-existing
  `config/seeds/lab_tests.json`, which had been shipping LOINC codes
  without explicit attribution). Also documents Wikidata (CC0), ATC, and
  ICD-10 sources. README and the user-guide normalization page now link
  to it.
- `build_lab_tests.py` reads optional official LOINC inputs:
  `loinc.csv` (LoincTableCore — overrides EN labels with the
  `LONG_COMMON_NAME` field) and `loinc_{it,fr,de,es}.csv` (LOINC
  Linguistic Variants — adds per-language aliases). The overlay is
  enrich-only, so the file stays at ~550 KB instead of ballooning to
  the full ~109k LOINC codes. The shipped `lab_tests.json` now uses
  official LOINC display names for all 469 codes that overlap with
  the LOINC Table, with native Italian / French / German / Spanish
  translations from the LOINC Linguistic Variants. Both inputs are
  gitignored so registered LOINC distributions stay local.
- `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, GitHub issue and
  pull-request templates.
- GitHub Actions CI (`.github/workflows/ci.yml`), CodeQL
  (`codeql.yml`) and Dependabot (`.github/dependabot.yml`) configuration.
- `asclepius.util.paths` module exposing `safe_vault_join` and
  `safe_filename` helpers; every upload / rename / serve path now routes
  through them.
- `asclepius.middleware` with security headers, CSRF protection and a
  request body size cap.
- `asclepius.auth.cookies` central cookie writer (Secure / HttpOnly /
  SameSite all enforced consistently).
- Login rate limiter keyed by `(client_ip, username)`.
- `ASCLEPIUS_ENV`, `ASCLEPIUS_COOKIE_SECURE`, `ASCLEPIUS_CORS_ORIGINS`
  environment variables.

### Changed

- Auto-merge robustness: the `chat()` interface on every LLM provider gained
  an opt-in `json_mode` flag (Ollama `format=json`, OpenAI
  `response_format=json_object`; Anthropic relies on the system prompt).
  Auto-merge passes `json_mode=True` so qwen-class models stop wrapping JSON
  in prose. The proposal parser also tolerates the common `merge_groups`
  schema drift and logs the raw response on parse failure.
- The first user created by the setup wizard is now always `role='admin'`.
- Passwords are SHA-256-prehashed before bcrypt to avoid the 72-byte
  truncation. Legacy hashes continue to verify.
- Production deployments refuse to start with the placeholder
  `ASCLEPIUS_SECRET_KEY` or with `cookie_secure=false`.
- The LLM-generated SQL sanitiser strips comments, blocks `sqlite_*`
  introspection, forbids additional keywords (`VACUUM`, `REINDEX`,
  `ANALYZE`, `EXPLAIN`) and skips the SQL path for non-admin users
  without a selected patient.
- PDF rotation, rename, cancel, reprocess and update endpoints now
  require write access (admin / uploader / editor-or-owner on the patient).
- Docker image runs as a non-root `asclepius` user. A small entrypoint
  (`docker/entrypoint.sh`) starts as root, aligns the in-container
  UID/GID with `PUID`/`PGID`, repairs ownership of the bind-mounted
  `/data` tree, then `gosu`-drops to the unprivileged user. Prevents
  the "attempt to write a readonly database" failure on first run.

### Removed

- Unused `ensure_admin_exists` helper (default `admin/admin` account) that
  could have shipped if the setup wizard was bypassed.
- Dangerous filesystem fallback (`vault_root.rglob(filename)`) in the
  document file server.

### Security

- Fixed path-traversal primitives in the upload handler, the document
  file server, the SPA catch-all route, and the rename endpoint.
- Added CSRF protection via a required `X-Requested-With` header.
- Added a content-size limit middleware to bound request memory use.
- Added default security headers (CSP, HSTS in production, frame-ancestors,
  referrer policy, permissions policy).

## [0.6] — 2026-03

Initial public cut. See git history for per-feature detail.
