# Security

Asclepius handles personal health info, so security bugs matter. If you find one, please report it privately — don't open a public issue.

## How to report

Open a private advisory from the repo's [Security tab](https://github.com/giovi321/asclepius/security) ("Report a vulnerability").

I'll try to reply within a few days and fix real issues as fast as I can. Happy to credit you in the release notes if you want.

## What I care about

- Authentication and sessions (`backend/asclepius/auth/`)
- Patient access control (`backend/asclepius/patients/service.py` and every `require_role` / `check_patient_access` call site)
- File handling and path traversal (`backend/asclepius/documents/`, `backend/asclepius/util/paths.py`)
- LLM-generated SQL (`backend/asclepius/chat/service.py`)
- External provider integrations (OCR, LLM) — unvalidated responses getting persisted or interpolated

## Not really in scope

- Denial-of-service that needs admin access in the first place
- Attacks that assume a compromised host or LAN-level TLS interception
- Bugs in third-party dependencies — report those upstream; I'm happy to pin versions or coordinate a fix
- Automated scanner output with no working proof of concept

## If you self-host

A few things worth doing:

- Put the app behind HTTPS (Caddy, nginx, Traefik). Keep `ASCLEPIUS_COOKIE_SECURE=1` (the production default).
- Generate a real `ASCLEPIUS_SECRET_KEY` — the app won't start in production mode with the placeholder.
- Run the container as non-root (the bundled image already does).
- Back up the vault (`/data/vault`) and database (`/data/config/asclepius.sqlite`). Easiest SQLite backup: `sqlite3 asclepius.sqlite ".backup out.sqlite"`.
- Consider encryption at rest — SQLCipher isn't on by default, so layer LUKS / BitLocker / ZFS underneath.
- If you don't want PHI leaving your machine, keep provider priority on local Ollama and don't configure Claude / OpenAI keys.

## Known limitations

- **Session revocation.** Session cookies are signed blobs (`itsdangerous`). Logging out only clears the client cookie; a stolen token stays valid until its TTL (30 days default) expires. Rotate `ASCLEPIUS_SECRET_KEY` to kill all outstanding sessions.
- **Chat SQL.** The sanitiser is defence in depth, not a guarantee. Treat LLM output as hostile and review audits periodically.
