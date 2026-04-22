# Security

Asclepius handles personal health info, so security bugs matter. If you find one, please report it privately — don't open a public issue.

## Threat model — read this first

**Asclepius is not safe to expose directly to the public internet.** The threat model assumes deployment on a trusted LAN, on a single-user workstation, or behind a VPN / authenticating reverse proxy. Specifically:

- The bundled username/password login is intentionally minimal. There is **no rate limiting, no account lockout, no MFA, no password-strength policy, and no brute-force protection** on `/api/auth/login`.
- Sessions are signed cookies with a configurable TTL. Logout revokes the server-side row, but there is no global "sign everyone out" button — the only way to invalidate every outstanding cookie is to rotate `ASCLEPIUS_SECRET_KEY`.
- There is no audit trail for failed logins, no email/2FA recovery flow, and no CAPTCHA.
- The application trusts that whatever can reach port `8070` is already authorized to attempt authentication.

**For anything beyond a single-user LAN install, you must front Asclepius with an OIDC provider** such as [Authentik](https://goauthentik.io/), [Keycloak](https://www.keycloak.org/), Auth0, or Google. The built-in local-password flow exists to make first-launch frictionless and for solo home use; it is not a substitute for a real identity provider. See [OIDC setup](https://giovi321.github.io/asclepius/admin-guide/user-management/) and consider disabling local logins entirely once OIDC is wired up.

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

- **Do not bind port `8070` to a public interface.** Keep it on `127.0.0.1` or a private subnet, and reach it via VPN (WireGuard, Tailscale, etc.) or a reverse proxy that enforces auth.
- **Use an OIDC provider** (Authentik, Keycloak, Auth0, Google) for any deployment with more than one user or any remote access. The built-in password login has no brute-force protection — fronting it with OIDC (and ideally disabling the local flow) is the recommended posture.
- Put the app behind HTTPS (Caddy, nginx, Traefik). Keep `ASCLEPIUS_COOKIE_SECURE=1` (the production default).
- Generate a real `ASCLEPIUS_SECRET_KEY` — the app won't start in production mode with the placeholder.
- Run the container as non-root (the bundled image already does).
- Back up the vault (`/data/vault`) and database (`/data/config/asclepius.sqlite`). Easiest SQLite backup: `sqlite3 asclepius.sqlite ".backup out.sqlite"`.
- Consider encryption at rest — SQLCipher isn't on by default, so layer LUKS / BitLocker / ZFS underneath.
- If you don't want PHI leaving your machine, keep provider priority on local Ollama and don't configure Claude / OpenAI keys.

## Known limitations

- **Session revocation.** Session cookies are signed blobs (`itsdangerous`). Logging out only clears the client cookie; a stolen token stays valid until its TTL (30 days default) expires. Rotate `ASCLEPIUS_SECRET_KEY` to kill all outstanding sessions.
- **Chat SQL.** The sanitiser is defence in depth, not a guarantee. Treat LLM output as hostile and review audits periodically.
