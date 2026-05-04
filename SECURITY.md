# Security

Asclepius handles personal health information, so security bugs matter. If you find one, please report it privately rather than opening a public issue.

## This is personal-use software

Asclepius is a side project, written for one person at a time managing their own family's records. It is not a hardened multi-tenant medical system, and the threat model is "you on your laptop or home network." The whole codebase, including authentication, has been built around that single-user assumption.

If you let strangers reach the application, several things stop being safe:

- **Local login has no brute-force protection.** No rate limiting, no account lockout, no MFA, no password-strength policy, no CAPTCHA on `/api/auth/login`. Anyone who can reach port `8070` can hammer it.
- **The chat feature is a prompt-injection target.** Every answer is grounded by letting the LLM author a SQLite `SELECT` against your medical database. The query is sanitised to a bounded read-only subset, but the sanitiser is defence in depth, not a guarantee. A malicious prompt smuggled into a document, an OCR result, or a chat message can convince the LLM to write a query that reads patient data it should not, or to leak that data through its reply text.
- **SQL injection is a real concern if untrusted users can chat.** The chat tool-call hands SQL straight to SQLite. If an attacker can reach the chat endpoint, they have a foothold to coerce queries against any table the application has read access to. Treat chat access as equivalent to database read access.
- **OCR text and document content is hostile input.** Files dropped in the inbox can carry adversarial instructions aimed at the extraction or chat prompts. The pipeline does not sandbox prompt content beyond truncation. If you ingest documents from untrusted sources, assume they may try to exfiltrate data through the LLM.
- **Sessions are signed cookies, not server-revocable tokens.** Logout clears the cookie locally. Rotating `ASCLEPIUS_SECRET_KEY` is the only way to invalidate every outstanding cookie.

For anything beyond a single user on a trusted LAN, you must front Asclepius with an OIDC provider such as [Authentik](https://goauthentik.io/), [Keycloak](https://www.keycloak.org/), Auth0, or Google. The built-in local-password flow exists to make first launch frictionless and for solo home use. It is not a substitute for a real identity provider. See [OIDC setup](https://giovi321.github.io/asclepius/admin-guide/user-management/) and consider disabling local logins entirely once OIDC is wired up.

**Do not bind port `8070` to a public interface.** Keep it on `127.0.0.1` or a private subnet, and reach it via VPN (WireGuard, Tailscale, etc.) or a reverse proxy that enforces auth.

## Exposing only doctor shares to the internet

If you need outside doctors to reach a curated subset of records over the public internet, run the bundled `asclepius-share` container instead of opening port `8070`. It is the same image started with `ASCLEPIUS_MODE=share`, mounts only `/api/share/*` and the `/share/...` SPA pages, and returns `404` for every admin or patient route. The inbox watcher and backup scheduler do not run there (only the core container watches the shared inbox); the share container does run a local pipeline worker so doctor translate jobs are drained in-process.

What this gives you:

- **No admin login on the public port.** `/api/auth/login` is not mounted, so the LAN-only username/password flow is unreachable from the internet even if someone guesses your credentials.
- **No patient enumeration.** `/api/patients`, `/api/documents`, `/api/shares` (admin), `/api/pipeline`, `/api/settings`, `/api/vault`, `/api/setup`, and friends all return `404`. Token creation stays on the core container.
- **Tighter SPA surface.** `/admin`, `/login`, `/patients`, etc. return `404` from the share container; only `/`, `/share`, and `/share/...` serve the SPA shell.
- **One audit trail.** Both containers write to the same SQLite database, so every OTP request, doctor view, and translate from the public port shows up in the regular admin audit panel.

What it does not change:

- **Sessions still rely on `ASCLEPIUS_SECRET_KEY`.** The two containers must share the same key (the bundled compose file already wires this up). Treat the share container's environment as sensitive: it holds the secret key and any LLM/OCR API keys needed for region translation.
- **Both containers write the SQLite database.** The connection helper sets `PRAGMA busy_timeout=5000` to ride out cross-process lock contention; backups and `VACUUM` should still happen during a quiet window.
- **Set `ASCLEPIUS_SHARE_PUBLIC_URL` on the core container** to pin every generated share link to the public doctor host. Without it, the link the admin copies inherits the admin's LAN hostname and the doctor cannot reach it.
- **`X-Forwarded-Proto` from your reverse proxy must be honored.** The image launches uvicorn with `--proxy-headers`, and `FORWARDED_ALLOW_IPS` defaults to `*`. Tighten it to the proxy's IP if anything else can reach the container, and make sure your proxy actually sets `X-Forwarded-Proto: https` so cookies, audit IPs, and URL generation see the right scheme.
- **The doctor-share threat model is unchanged.** Token discovery, OTP brute-force, watermark spoofing, and the existing rate-limit caps are all the same; see [Doctor shares](https://giovi321.github.io/asclepius/admin-guide/doctor-shares/) for that surface's security analysis.

Bind `asclepius-share`'s host port (default `8071`) behind your TLS reverse proxy and leave `asclepius-core` on `127.0.0.1`. Do **not** mount the public port directly without TLS termination, and do **not** bypass `ASCLEPIUS_COOKIE_SECURE=1` on the share container.

## How to report

Open a private advisory from the repo's [Security tab](https://github.com/giovi321/asclepius/security) ("Report a vulnerability").

I will try to reply within a few days and fix real issues as fast as I can. Happy to credit you in the release notes if you want.

## What I care about

- Authentication and sessions (`backend/asclepius/auth/`)
- Patient access control (`backend/asclepius/patients/service.py` and every `require_role` / `check_patient_access` call site)
- File handling and path traversal (`backend/asclepius/documents/`, `backend/asclepius/util/paths.py`)
- LLM-generated SQL and prompt-injection paths (`backend/asclepius/chat/service.py`, OCR text handling, classification and extraction prompts)
- External provider integrations (OCR, LLM): unvalidated responses getting persisted or interpolated

## Not really in scope

- Denial-of-service that needs admin access in the first place
- Attacks that assume a compromised host or LAN-level TLS interception
- Bugs in third-party dependencies. Report those upstream; I am happy to pin versions or coordinate a fix.
- Automated scanner output with no working proof of concept
- Risks that only appear when the application is exposed to untrusted users without OIDC, since that deployment is explicitly unsupported

## If you self-host

A few things worth doing:

- **Use an OIDC provider** (Authentik, Keycloak, Auth0, Google) for any deployment with more than one user or any remote access. The built-in password login has no brute-force protection. Fronting it with OIDC and ideally disabling the local flow is the recommended posture.
- Put the app behind HTTPS (Caddy, nginx, Traefik). Keep `ASCLEPIUS_COOKIE_SECURE=1` (the production default).
- Generate a real `ASCLEPIUS_SECRET_KEY`. The app will not start in production mode with the placeholder.
- Run the container as non-root (the bundled image already does).
- Back up the vault (`/data/vault`) and database (`/data/config/asclepius.sqlite`). Easiest SQLite backup: `sqlite3 asclepius.sqlite ".backup out.sqlite"`.
- Consider encryption at rest. SQLCipher is not on by default, so layer LUKS, BitLocker, or ZFS underneath.
- If you do not want PHI leaving your machine, keep provider priority on local Ollama and do not configure Claude or OpenAI keys.
- Only ingest documents you trust. Files from strangers can carry prompt-injection payloads aimed at the extraction or chat prompts.

## Known limitations

- **Session revocation.** Session cookies are signed blobs (`itsdangerous`). Logging out only clears the client cookie; a stolen token stays valid until its TTL (30 days default) expires. Rotate `ASCLEPIUS_SECRET_KEY` to kill all outstanding sessions.
- **Chat SQL.** The sanitiser is defence in depth, not a guarantee. Treat LLM output as hostile and review audits periodically.
- **Prompt injection.** Document content, OCR results, and user chat messages all flow into LLM prompts. There is no robust isolation between trusted instructions and untrusted content.
