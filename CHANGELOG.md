# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- `build_lab_tests.py` accepts an optional `loinc.csv` overlay (registered
  LOINC distribution) — when present, its `LONG_COMMON_NAME` and
  `SHORTNAME` fields take precedence over Wikidata labels, satisfying the
  LOINC display-name requirement for deployments needing strict
  compliance.
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
