# Authentication

Asclepius uses session-based authentication with signed cookies. All API endpoints (except login, setup, and health check) require a valid session.

## First-Time Setup

On a fresh installation (no users in the database), the `/api/setup/status` endpoint returns `{"needs_setup": true}`. The frontend detects this and redirects to the setup wizard, which calls `/api/setup/complete` to create the first admin user and patient. This endpoint only works when no users exist — it returns `400` once setup is complete.

## Session Authentication

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

- `httponly: true` -- not accessible from JavaScript
- `samesite: lax` -- CSRF protection
- `path: /`

The cookie contains a signed token (via itsdangerous `URLSafeTimedSerializer`) with the user ID. The session is valid for `auth.session_ttl_hours` (default: 720 hours / 30 days).

### Logout

```
POST /api/auth/logout
```

Deletes the session cookie.

### Get Current User

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
      "slug": "giovanni-crapelli",
      "display_name": "Giovanni Crapelli",
      "role": "owner"
    }
  ]
}
```

Returns the current user with their accessible patients and roles.

## OIDC Authentication

When OIDC is enabled, an additional authentication flow is available:

### Check OIDC Status

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

### Initiate OIDC Login

```
GET /api/auth/oidc/login
```

Redirects the browser to the OIDC provider's authorization endpoint. A signed state cookie is set for CSRF protection.

### OIDC Callback

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

## Error Responses

| Status | Meaning |
|--------|---------|
| `401 Unauthorized` | No valid session cookie, or session expired |
| `403 Forbidden` | Authenticated but no access to the requested patient |
| `409 Conflict` | Username already exists (when creating users) |
