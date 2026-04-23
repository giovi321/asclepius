# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Removed

- Trivial UI walkthrough sections from user-guide docs (timeline,
  documents, medical-events, imaging, normalization, chat, first-steps).

### Deferred

- Splits of the four remaining mega-components (`NormalizationTab`,
  `DocumentDetailPage`, `DocumentsPage`, `ProvidersTab`). The shared
  hooks + ErrorBoundary + generated types are in place so these can be
  tackled incrementally without further plumbing.

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
