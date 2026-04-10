# User Management

## Default Admin

On first startup, Asclepius creates a default admin user:

- **Username:** `admin`
- **Password:** `admin`

Change this password immediately in production.

## User-Patient Access Model

Asclepius uses a multi-user, multi-patient access model:

- Each **user** can access multiple **patients**
- Each **patient** can be accessed by multiple **users**
- Access roles: `owner` (full control) or `viewer` (read-only)

When a user creates a patient, they automatically get `owner` access.

## Managing Users

Currently, user management is done via the API or directly in the database:

```bash
# Create a user via API (requires admin session)
curl -X POST http://localhost:8070/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

User management UI is planned for a future release.

## Password Security

- Passwords are hashed with **bcrypt** (cost factor 12)
- Sessions use signed cookies via **itsdangerous**
- Session TTL is configurable (default: 30 days)
