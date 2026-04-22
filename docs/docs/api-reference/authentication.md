# Authentication

Asclepius uses session-based authentication with signed cookies. All API endpoints (except login, setup, and health check) require a valid session.

## First-time setup

On a fresh installation (no users in the database), the `/api/setup/status` endpoint returns `{"needs_setup": true}`. The frontend detects this and redirects to the setup wizard, which calls `/api/setup/complete` to create the first admin user and patient. This endpoint only works when no users exist — it returns `400` once setup is complete.

## Session authentication

### Login

```
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin"
}
```

**Response:**

```json
{
  "id": 1,
  "username": "admin",
  "display_name": "Admin"
}
```

On success, a signed session cookie (`asclepius_session`) is set with:

- `httponly: true` — not accessible from JavaScript
- `samesite: lax` — CSRF protection
- `path: /`

The cookie carries a signed opaque **session id** (via itsdangerous `URLSafeTimedSerializer`). The session id maps to a row in the `sessions` table that stores the owning user, IP, User-Agent, `last_active_at`, and `expires_at`. Admins can list and revoke active sessions from **Settings → Sessions** or via the endpoints below. The session is valid for `auth.session_ttl_hours` (default: 720 hours / 30 days) unless revoked earlier.

### Logout

```
POST /api/auth/logout
```

Revokes the current session server-side (sets `revoked_at = now` on its `sessions` row) and clears the cookie. A stolen cookie is invalidated immediately.

### Get current user

```
GET /api/auth/me
```

**Response:**

```json
{
  "id": 1,
  "username": "admin",
  "display_name": "Admin",
  "patients": [
    {
      "id": 1,
      "slug": "alex-smith",
      "display_name": "Alex Smith",
      "role": "owner"
    }
  ]
}
```

Returns the current user with their accessible patients and roles.

## OIDC authentication

When OIDC is enabled, an additional authentication flow is available:

### Check OIDC status

```
GET /api/auth/oidc/enabled
```

**Response:**

```json
{
  "enabled": true,
  "provider_url": "https://auth.example.com/application/o/asclepius/"
}
```

### Initiate OIDC login

```
GET /api/auth/oidc/login
```

Redirects the browser to the OIDC provider's authorization endpoint. A signed state cookie is set for CSRF protection.

### OIDC callback

```
GET /api/auth/oidc/callback?code=...&state=...
```

Handles the OIDC provider's callback:

1. Verifies the state parameter against the signed cookie
2. Exchanges the authorization code for tokens
3. Retrieves user info from the provider
4. Creates or updates the local user
5. Sets a session cookie
6. Redirects to the application root (`/`)

## Authorization

After authentication, access to patient data is controlled by the `user_patient_access` table:

- Each user must be explicitly granted access to each patient
- Roles: `owner` (full access) or `viewer` (read-only)
- All document and patient endpoints check access before returning data
- Users without access to a patient receive a `403 Forbidden` response

## Session management (admin)

Admins can enumerate and revoke every active session.

### List sessions

```
GET /api/settings/sessions?include_revoked=false
```

**Response:**

```json
{
  "items": [
    {
      "session_id": "abc...",
      "user_id": 1,
      "username": "admin",
      "display_name": "Admin",
      "role": "admin",
      "created_at": "2026-04-21T09:12:03",
      "last_active_at": "2026-04-21T14:47:18",
      "expires_at": "2026-05-21T09:12:03",
      "ip_address": "192.168.1.42",
      "user_agent": "Mozilla/5.0 ...",
      "revoked_at": null,
      "is_current": true
    }
  ]
}
```

By default only non-revoked, non-expired sessions are returned. Pass `include_revoked=true` to include historical rows for audit.

### Revoke a session

```
DELETE /api/settings/sessions/{session_id}
```

Marks the session revoked. The owning user is signed out on their next request. Revoking your own session returns `200` and the frontend redirects to login. An audit-log entry is written under the action `session.revoke`.

## Error responses

| Status | Meaning |
|--------|---------|
| `401 Unauthorized` | No valid session cookie, session expired, or session revoked |
| `403 Forbidden` | Authenticated but no access to the requested patient |
| `409 Conflict` | Username already exists (when creating users) |
