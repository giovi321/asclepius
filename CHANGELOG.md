# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

A large internal refactor. Most of it is behaviour-preserving cleanup, but it
also closes several security holes and changes a few behaviours on purpose
(noted under Changed). The backend test suite and the frontend type-check/build
stayed green throughout.

### Security
- Medical events had no authorization at all. Every `/api/events` endpoint
  depended only on a valid session, so any logged-in account — including a
  viewer with no grant — could read, edit, and cascade-delete another patient's
  events and the documents linked to them. Every endpoint now checks patient
  access, the listing is scoped to the caller's patients, and deleting requires
  editor or owner.
- Backup and prompt endpoints were gated by login, not by role. A viewer-level
  account could download a full SQLite snapshot — every patient record, OTP, and
  password hash — through `GET /api/settings/backup` and the scheduled-backup
  endpoints, or rewrite the extraction prompts through `PUT`/`DELETE
  /api/settings/prompts`. These now require admin, enforced where the routers are
  mounted so a new handler cannot ship under-gated by accident. `GET
  /api/settings/logs` is admin-only for the same reason.
- More cross-tenant holes found during review: linking a document to an event
  never checked the document's patient (an IDOR that leaked the document's
  metadata back through the event view and could re-parent or cascade-delete
  another patient's file); `POST /documents/{id}/edit-with-ai`,
  `/generate-filename`, and the `/documents/{id}/link[s]` endpoints had no access
  check; the normalization "documents using this entry" listing returned every
  patient's filenames unscoped; and the normalization edit/merge/delete endpoints
  were open to any logged-in user (now editor or admin).
- Editing a patient's encounters or medications only required *some* grant on the
  patient, so a viewer could change them. Child-record writes now require editor
  or owner, matching the rule the rest of the document already used.
- Three error handlers (the two backup endpoints and the event-link handler)
  returned the raw exception text to the caller and logged nothing. They now log
  the traceback and return a generic message.

### Changed
- Background SQLite connections — the file watcher, pipeline workers, the prompt
  manager, and a few routes — were opened without the per-connection PRAGMAs, so
  `foreign_keys=ON` was never set and `ON DELETE CASCADE` silently did not fire.
  Deleting a document left its lab results, encounters, and other child rows
  orphaned. Every connection now goes through one helper that sets the PRAGMAs,
  with a test that fails if a raw connection reappears.
- The Claude provider now retries transient errors and honours JSON mode and
  per-request timeouts, like the Ollama and OpenAI providers. It previously made
  a single attempt and ignored those settings.
- A multi-page document now produces the same lab results, medications, and
  diagnoses regardless of which path processed it. The three merge strategies had
  drifted: the section path kept duplicate rows from overlapping page ranges, and
  the vision path dropped everything after the first page that had data. All three
  now concatenate and de-duplicate on the same keys.
- A custom classification or SQL-generation prompt set in Settings now applies on
  every path, including long (chunked) documents and the chat query. Those two
  ignored the override and used the built-in default.
- Admins can open imaging studies without an explicit grant on the patient,
  matching how every other module already treated admins.

### Internal
- Split the largest files into focused modules: `imaging/routes.py` (1121 lines),
  `share/service.py` (933), and the pipeline `extractor.py` (1161) on the backend,
  plus five oversized React pages/components on the frontend. Folded the
  duplicated authorization checks into one `authz` module, the per-provider LLM
  bodies into the base class, and the divergent vision image-IO and
  provider-resolution code into one place each.
- Added a backend characterization-test suite, and on the frontend an ESLint
  config and a Vitest harness (there were no frontend tests before). Both run in
  CI, and API responses on the main pages are now typed against the generated
  OpenAPI schema, so a backend field rename shows up as a frontend compile error.
- Removed dead code and four unused npm dependencies, deleted an orphaned
  `backend/Dockerfile`, and created the `idx_documents_event_date` index a schema
  comment had promised but never made.

### Fixed
- A region-translation timestamp rendered in the wrong timezone: a naive UTC value
  was parsed as local time. Backend timestamps now parse as UTC everywhere.
- The pipeline stage names disagreed across the three places they were shown
  (one view labelled a stage "Vision", another "Vision extraction"). They now come
  from one shared table.
- The diverged OCR-vs-vision image renderer could feed an Ollama vision model
  dimensions it rejected with a hard crash; both paths now use the same
  patch-aligned sizing.

## [1.3.0] - 2026-06-12

### Security
- Doctor-share surface: the doctor can no longer influence which OCR/LLM provider runs a translation. The `translate-region` (and deprecated `translate`) endpoints previously accepted `ocr_provider_id`/`llm_provider_id` in the request body; a hand-crafted request could route a patient's OCR'd region to any admin-enabled provider (e.g. a cloud LLM when the admin pinned a local one). Those fields are removed from the doctor request models — provider resolution is admin-only (per-share default → system default → first-enabled).
- Doctor document-detail endpoint now returns an explicit allow-list of fields instead of `doc.*` minus a denylist. The old shape leaked `insurance_company`, `insurance_policy`, billing, internal `tags`, the full un-watermarked `ocr_text`/`ocr_text_en` (a watermark bypass), `patient_slug`, and infra/model identifiers — and any future column would have leaked by default.

### Added
- Doctor shares: **add documents to an existing share** (`POST /api/shares/{id}/documents`). Build a share across several filter/search views — select a subset, click "Add these" on a share in the Share dialog, change the filter, and add the next subset to the same share. Same guard rails as creation (admin/owner only, every document must belong to the share's patient); revoked shares refuse additions and already-shared documents are skipped.
- Doctor shares: **permanently delete a share** (`DELETE /api/shares/{id}/purge`) via a new "Delete" action on the Shares dashboard. Removes the row plus its OTPs, sessions, queue entries, and audit history. Distinct from Revoke, which keeps the row flagged for the dashboard.

### Fixed
- Shares dashboard now LEFT JOINs users/patients when listing, so legacy/orphaned shares (whose creating user was deleted while FK enforcement was off — common for rows created before the revoke feature) appear in the list and can be purged instead of being silently invisible.

## [1.1.2] - 2026-05-09

### Added
- Settings page now hides admin-only tabs (Document Analysis, Pipeline, Language, Access & Identity, Backup, Logs) from non-admin users. Editors and viewers see only the "Table columns" tab. Direct navigation to an admin URL falls back to the default visible tab.
- `AuthContext` now exposes the current user's `role` so the UI can branch on it.

### Fixed
- The Users management tab now shows an "Admin access required" message instead of silently rendering empty when the listing endpoint returns 403. Admin gating in the Settings page is the primary defence; this is a fallback for direct URL access.

### Changed
- OIDC settings: the "Auto-create Users" description now spells out that auto-created users start with the 'editor' role and points to role sync / the Users tab for promotion to admin. This was not obvious before and led people to wonder why they couldn't manage settings after their first SSO login.

## [1.1.1] - 2026-05-09

### Fixed
- Settings: `ToggleField` no longer squashes the toggle when the description text wraps to multiple lines. Adds row gap and prevents the toggle button from being shrunk under flex layout. Affects every toggle on every settings tab.
- Settings: a failed save now shows the backend error detail in the toast description instead of silently displaying only "Failed to save settings", matching the error-surfacing pattern used elsewhere in the app.

## [1.1.0] - 2026-05-09

### Added
- OIDC: new `oidc.hide_password_login` setting. When enabled together with OIDC, the login page hides the username/password form so SSO is the only visible path. The `/api/auth/login` endpoint stays functional as a break-glass route if the IDP is unreachable.

### Fixed
- OIDC SSO login no longer crashes with `AttributeError: 'AsyncOAuth2Client' object has no attribute 'fetch_server_metadata'`. The discovery document is now fetched directly from `/.well-known/openid-configuration` via `httpx`.

## [1.0.0] - 2026-05-05

Initial public release.
