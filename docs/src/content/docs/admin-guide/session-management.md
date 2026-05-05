---
title: "Session management"
---

Asclepius stores every login as a row in the `sessions` table. The cookie delivered to the browser is a signed opaque session id; the row is the source of truth, which means the server can list and revoke active logins at any time.

## The Sessions tab

**Settings → Sessions** (admin only) lists every session in the database. Each row shows:

| Column | Meaning |
| --- | --- |
| **User** | The account that owns the session |
| **Client** | Browser + OS parsed from the `User-Agent` header (hover for the full UA string) |
| **IP** | Remote address recorded at login, respects `X-Forwarded-For` when behind a reverse proxy |
| **Last active** | The most recent time a request was authenticated by this session (throttled to one update per minute) |
| **Created** | When the user logged in |
| **Expires** | When the signed cookie stops being accepted, set from `auth.session_ttl_hours` |
| **Status** | `active`, `current` (your own session), `revoked`, or `expired` |

Use the filter input to narrow by username, IP, or client string. Toggle **Include revoked / expired** to see historical sessions for audit.

## Revoking a session

Click **Revoke** on any active row. The server marks the row `revoked_at = now`; the next request that presents that cookie returns `401 Session revoked` and the frontend redirects to login.

- Revocation is **immediate** from the server's perspective, no waiting for the cookie TTL.
- Revoking **your own** session logs you out right away and sends you to the login screen. The UI prompts before doing this.
- Revocations are written to the audit log under the action `session.revoke` with the target user id and a `self` flag.

## When to revoke

- A user lost a device that still has a valid cookie
- A suspicious IP or User-Agent appears for a privileged account
- A password change, consider revoking all other sessions for that user so the old cookie stops working
- Before retiring an account

## How it works under the hood

- On login (password, OIDC, or first-run setup wizard) the backend generates a 256-bit random `session_id`, stores it with the user id / IP / User-Agent / expiry, and returns a signed cookie whose payload is just `{"sid": session_id}`.
- Every authenticated request unwraps the cookie, verifies the signature, looks the row up, and rejects if `revoked_at IS NOT NULL` or `expires_at` is in the past.
- `last_active_at` is touched at most once per minute to keep the Sessions page useful without amplifying write traffic.
- Logout revokes the current session server-side before clearing the cookie, so a stolen cookie is invalidated at the same moment the user clicks logout.

## Related settings

- `auth.session_ttl_hours` in `config/settings.yaml`, controls `expires_at`
- `auth.secret_key`, signs the cookie; rotating it invalidates every session in one step
- `auth.login_max_attempts` / `auth.login_window_seconds`, per-IP, per-username rate limit on password login
