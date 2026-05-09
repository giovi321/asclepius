# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
