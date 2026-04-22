# User Management

## First-Time Setup

On the very first launch — when no users exist in the database — Asclepius shows a **setup wizard** that creates:

1. Your **admin account** (username, password, display name)
2. Your **first patient profile** (pre-filled from your display name, fully editable)

The wizard automatically logs you in after completion. It only appears once.

## Local Authentication

Asclepius uses session-based authentication:

- Passwords are hashed with **bcrypt**
- Sessions are **server-side** — the cookie carries a signed session id that maps to a row in the `sessions` table. See [Session Management](session-management.md) for listing and revoking active logins.
- Session lifetime is configurable via `auth.session_ttl_hours` (default: 720 hours / 30 days)

## Managing Users

### Creating Users

1. Go to **Settings** > **Users**
2. Click **Add User**
3. Enter username, password, and optional display name
4. Click **Create**

### Editing Users

- Change a user's display name or password from the Users list
- Users cannot delete themselves

### Deleting Users

Deleting a user removes:

- The user account
- All patient access grants for that user
- Chat history is preserved (orphaned)

## Patient Access Control

Each user must be explicitly granted access to each patient:

### Roles

| Role | Permissions |
|------|------------|
| `owner` | Full access: view, edit, delete documents, reassign patients, manage events |
| `viewer` | Read-only access to the patient's documents and data |

### Granting Access

1. Go to **Settings → Users**
2. Click the user's row to open the **Access** modal
3. Pick a role (`owner` or `viewer`) from the role dropdown
4. Tick the patients you want the user to access — the list is **multi-select**, so you can add or revoke multiple patients at once
5. Click **Save**

!!! note "Setup wizard grants owner access"
    The setup wizard automatically grants the first user `owner` access to the first patient.

### Revoking Access

Open the same Access modal, untick the patients you want to revoke, and save. Admins can also end a user's active sessions from **Settings → Sessions** — listing every active session (user, IP, user-agent, last-seen, expiry) with a per-row **Revoke** button.

## OIDC / SSO

Asclepius supports single sign-on via OpenID Connect (OIDC), compatible with:

- **Authentik**
- **Keycloak**
- **Any OIDC-compliant provider**

### Configuration

```yaml
oidc:
  enabled: true
  provider_url: "https://auth.example.com/application/o/asclepius/"
  client_id: "your-client-id"
  client_secret: "your-client-secret"
  scopes: "openid profile email"
  auto_create_user: true
  username_claim: "preferred_username"
  display_name_claim: "name"
```

All OIDC settings can also be changed from **Settings** > **OIDC/SSO** in the web UI.

### How OIDC Works

1. User clicks "Sign in with SSO" on the login page
2. Browser redirects to the OIDC provider's authorization endpoint
3. User authenticates with the provider
4. Provider redirects back with an authorization code
5. Asclepius exchanges the code for tokens and retrieves user info
6. If the user exists, a session is created
7. If the user does not exist and `auto_create_user` is enabled, a new user is created with a random password (OIDC users do not use password login)

### OIDC Claims

| Setting | Default | Description |
|---------|---------|-------------|
| `username_claim` | `preferred_username` | OIDC claim to use as the username |
| `display_name_claim` | `name` | OIDC claim to use as the display name |

### Setting Up Authentik

1. Create a new OAuth2/OpenID Provider in Authentik
2. Set the redirect URI to `https://your-asclepius-url/api/auth/oidc/callback`
3. Note the client ID and client secret
4. Set `provider_url` to your Authentik application URL (e.g., `https://auth.example.com/application/o/asclepius/`)

### Setting Up Keycloak

1. Create a new client in your Keycloak realm
2. Set the valid redirect URI to `https://your-asclepius-url/api/auth/oidc/callback`
3. Note the client ID and client secret
4. Set `provider_url` to your Keycloak realm URL (e.g., `https://keycloak.example.com/realms/master`)

### Notes

- OIDC users still need patient access grants (these are not managed by the OIDC provider)
- The display name is updated from OIDC claims on each login
- OIDC state is verified via signed cookies for CSRF protection
- Local login remains available even when OIDC is enabled
