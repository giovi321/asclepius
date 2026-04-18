# Security Policy

Asclepius stores personal health information (PHI). We take security
issues seriously and appreciate responsible disclosure.

## Supported versions

We provide security fixes for the latest released minor version on
`main`. Older versions are out of support — please upgrade.

| Version | Status                  |
|---------|-------------------------|
| 0.6.x   | :white_check_mark: Supported |
| < 0.6   | :x: End-of-life        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Instead, use one of the following private channels:

1. **Preferred:** [GitHub Security Advisories](https://github.com/giovi321/asclepius/security/advisories/new)
   — creates a private thread with the maintainers.
2. Email the maintainer at the address listed on the GitHub profile of
   [`giovi321`](https://github.com/giovi321). Include "Asclepius
   security" in the subject.

We aim to:

- acknowledge receipt within **72 hours**,
- provide an initial assessment within **7 days**,
- ship a fix or a concrete mitigation within **30 days** for high-severity
  issues (remote code execution, authentication bypass, PHI leak),
- credit you in the release notes if you wish.

If you need PGP encryption, let us know in the first message and we will
send a key out of band.

## What is in scope

All code under this repository, and the default Docker image produced by
the project `Dockerfile`. In particular, we care about:

- Authentication and session handling (`backend/asclepius/auth/`).
- Authorisation / row-level patient access
  (`backend/asclepius/patients/service.py`, every `require_role` and
  `check_patient_access` call site).
- File handling and path traversal (`backend/asclepius/documents/`,
  `backend/asclepius/util/paths.py`).
- LLM-generated SQL (`backend/asclepius/chat/service.py`).
- External provider integrations (OCR, LLM) — look for unvalidated
  responses being persisted or interpolated.

## What is out of scope

- Denial-of-service achievable only with privileged access (e.g. an
  authenticated admin deleting their own data).
- Issues requiring a compromised host, LAN attacker with TLS terminator
  access, or a malicious container runtime.
- Bugs in third-party dependencies — report those upstream first; we are
  happy to pin a version or coordinate a fix.
- Reports produced by automated scanners without a working proof of
  concept.

## Deployment hardening

The defaults aim to be safe, but self-hosters should also:

- **Always front the app with HTTPS.** Set
  `ASCLEPIUS_COOKIE_SECURE=1` (the default in production) and terminate
  TLS at a reverse proxy (Caddy, nginx, Traefik).
- **Generate a real `ASCLEPIUS_SECRET_KEY`.** The app refuses to start
  in production mode with the placeholder value.
- **Run the container as a non-root user** (the bundled image does this
  by default).
- **Back up the vault** (`/data/vault`) and the database
  (`/data/config/asclepius.sqlite`). SQLite backups are easiest with
  `sqlite3 asclepius.sqlite ".backup out.sqlite"`.
- **Consider encryption at rest.** The project does not enable SQLCipher
  by default; combine with LUKS / BitLocker / ZFS encryption on the host.
- **Limit external LLM use** if your threat model disallows sending PHI
  to third-party APIs. Keep provider priority on the local Ollama entry
  and disable Claude / OpenAI keys.

## Known limitations

- **Session revocation.** Session cookies are short signed blobs
  (`itsdangerous`). Logging out only clears the cookie on the client; a
  stolen token remains valid until its TTL (30 days by default) expires.
  Rotate `ASCLEPIUS_SECRET_KEY` to revoke all outstanding sessions at
  once.
- **Chat SQL.** The sanitiser is defence in depth, not a guarantee.
  Treat the LLM output as hostile input and review audits periodically.

Thanks for helping keep Asclepius and its users safe.
