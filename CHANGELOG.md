# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-05-09

### Added
- OIDC: new `oidc.hide_password_login` setting. When enabled together with OIDC, the login page hides the username/password form so SSO is the only visible path. The `/api/auth/login` endpoint stays functional as a break-glass route if the IDP is unreachable.

### Fixed
- OIDC SSO login no longer crashes with `AttributeError: 'AsyncOAuth2Client' object has no attribute 'fetch_server_metadata'`. The discovery document is now fetched directly from `/.well-known/openid-configuration` via `httpx`.

## [1.0.0] - 2026-05-05

Initial public release.
