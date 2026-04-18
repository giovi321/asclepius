# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `CHANGELOG.md`, GitHub issue and pull-request templates.
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
- Docker image runs as a non-root `asclepius` user.

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
