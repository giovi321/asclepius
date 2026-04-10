# Authentication

Asclepius uses session-based authentication with signed cookies.

## Login

```
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin"
}
```

**Response:** `200 OK` with user info and a `asclepius_session` cookie.

```json
{
  "id": 1,
  "username": "admin",
  "display_name": "Administrator"
}
```

## Current User

```
GET /api/auth/me
Cookie: asclepius_session=...
```

**Response:** `200 OK` with user info and accessible patients.

```json
{
  "id": 1,
  "username": "admin",
  "display_name": "Administrator",
  "patients": [
    {"id": 1, "slug": "giovanni-crapelli", "display_name": "Giovanni Crapelli", "role": "owner"}
  ]
}
```

## Logout

```
POST /api/auth/logout
Cookie: asclepius_session=...
```

**Response:** `200 OK`, clears the session cookie.

## Session Details

- Cookie name: `asclepius_session`
- HttpOnly: yes
- SameSite: Lax
- Signed with: `itsdangerous.URLSafeTimedSerializer`
- TTL: configurable (default 30 days)
- Hashing: bcrypt

## Error Responses

| Status | Meaning |
|--------|---------|
| `401` | Not authenticated or session expired |
| `403` | Authenticated but no access to the requested resource |
