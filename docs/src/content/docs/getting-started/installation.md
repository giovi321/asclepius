---
title: "Installation"
---

:::danger[Do not expose Asclepius directly to the internet]
Asclepius is **not hardened for direct public-internet exposure**. The built-in authentication has no rate limiting, no MFA, and no account-lockout protection, it exists to make solo / LAN installs frictionless.

For any deployment that is reachable from outside a trusted network, or that has more than a single user, you **must** front Asclepius with one of:

- An **OIDC provider** such as [Authentik](https://goauthentik.io/), Keycloak, Auth0, or Google (recommended, see [User Management](../admin-guide/user-management.md)), and/or
- A **VPN** (WireGuard, Tailscale, …) or an **authenticating reverse proxy**.

The local username/password login should be treated as a single-user convenience, not a production auth system. Bind port `8070` to `127.0.0.1` or a private subnet, never `0.0.0.0` on a public host.

The one exception is the **doctor-share surface**. The bundled `asclepius-share` service (same image, `ASCLEPIUS_MODE=share`) only mounts `/api/share/*` and the `/share/...` SPA pages, returns 404 for every admin or patient route, and is the supported way to publish that surface over the public internet. See [Doctor shares → Publishing the share surface](../admin-guide/doctor-shares.md#publishing-the-share-surface-to-the-internet).
:::

## Prerequisites

- **Docker and Docker Compose** (v2+)
- **An LLM provider** -- either an [Ollama](https://ollama.ai/) instance running on your network, or a [Claude API](https://console.anthropic.com/) key

:::note[No bundled LLM]
Asclepius does **not** bundle an LLM server. You must provide your own Ollama instance or a Claude API key. This keeps the container lightweight and gives you full control over your LLM setup.

:::

## Docker Compose (Recommended)

```bash
git clone https://github.com/giovi321/asclepius.git
cd asclepius

# Create your configuration
cp config/settings.example.yaml config/settings.yaml
```

Edit `config/settings.yaml` to configure your LLM provider, OCR settings, and other options. See [Configuration](configuration.md) for a full reference.

```bash
# Start the application
docker compose up -d
```

This starts two services from the same image:

- **asclepius-core** -- the full application (admin, pipeline, settings, doctor-share admin) on port `8070` (mapped from container port `8000`). Keep this one on the LAN.
- **asclepius-share** -- the same image started with `ASCLEPIUS_MODE=share`. Mounts only the doctor-share routes (`/api/share/*` plus the `/share/...` SPA pages); every admin or patient route returns 404. Bind it to a public TLS proxy if you want outside doctors to reach a shared record. Default host port `8071`. See [Doctor shares → Publishing the share surface](../admin-guide/doctor-shares.md#publishing-the-share-surface-to-the-internet).

If you do not plan to expose share access to the internet, you can simply leave the share service running on `127.0.0.1:8071` (no harm done), or remove it from `docker-compose.yml`. The core service is fully functional on its own.

Each container includes:

- Python 3.12 + FastAPI backend
- Pre-built React frontend (served as static files)
- Tesseract OCR with English, Italian, German, French, and Spanish language packs

### Environment Variables

You can set environment variables in a `.env` file alongside `docker-compose.yml`, or directly in the compose file:

Application env vars are prefixed with `ASCLEPIUS_`. The `TZ` variable is a plain Linux timezone name consumed by the container.

| Variable | Description | Default |
|----------|-------------|---------|
| `ASCLEPIUS_SECRET_KEY` | Session signing key (change in production!) | `change-me-in-production` |
| `ASCLEPIUS_ANTHROPIC_API_KEY` | Populates the Claude credential/provider `api_key` if one exists | |
| `ASCLEPIUS_OLLAMA_URL` | Populates the Ollama credential/provider `base_url` if one exists | |
| `ASCLEPIUS_GOOGLE_VISION_KEY` | Populates `ocr.google_vision_key` and flips `cloud_ocr_enabled` on | |
| `ASCLEPIUS_COOKIE_SECURE` | Truthy value forces `Secure` cookies (set behind HTTPS) | `false` |
| `ASCLEPIUS_CORS_ORIGINS` | Comma-separated list of allowed CORS origins | |
| `ASCLEPIUS_VAULT_PATH` | Overrides `vault.root_path` and all sub-paths | `/vault` |
| `ASCLEPIUS_DB_PATH` | Overrides `database.path` | `/vault/asclepius.sqlite` |
| `ASCLEPIUS_CONFIG_PATH` | Path to `settings.yaml` | `config/settings.yaml` |
| `ASCLEPIUS_ENV` | `development` or `production` (affects log formatting) | `production` |
| `ASCLEPIUS_MODE` | `core` (full app) or `share` (public doctor-share surface only) | `core` |
| `ASCLEPIUS_PORT` | Host port for `asclepius-core` (LAN-only) | `8070` |
| `ASCLEPIUS_SHARE_PORT` | Host port for `asclepius-share` (publishable behind TLS) | `8071` |
| `TZ` | Container timezone (IANA timezone name) | `Europe/Zurich` |

Example `.env` file:

```env
ASCLEPIUS_SECRET_KEY=your-random-secret-key-at-least-32-chars
ASCLEPIUS_ANTHROPIC_API_KEY=sk-ant-api03-...
TZ=Europe/Zurich
```

Unprefixed names (`SECRET_KEY`, `ANTHROPIC_API_KEY`, etc.) are **not** read by the backend. If your orchestration tooling exposes those, map them to the `ASCLEPIUS_`-prefixed names in `docker-compose.yml` via `environment:` substitution.

### Connecting to Ollama

If you run Ollama on the same machine as Asclepius, add an Ollama entry to `llm.providers`:

```yaml
credentials:
  - id: "cred-ollama-main"
    name: "Ollama (host)"
    type: "ollama"
    base_url: "http://host.docker.internal:11434"   # Docker Desktop
    # base_url: "http://192.168.1.100:11434"         # Or use the host IP
    max_concurrent: 1

llm:
  providers:
    - id: "ollama-1"
      type: "ollama"
      name: "Qwen on Ollama"
      enabled: true
      priority: 1
      credential_id: "cred-ollama-main"
      model: "qwen2.5"
      timeout: 120
```

If Ollama runs on a different machine, use that machine's IP or hostname. Vision-LLM providers reference the **same** credential, see [LLM & OCR Configuration](../admin-guide/llm-configuration.md#vision-llm-providers) for the Vision-LLM flow.

### Volume Mounts

The default `docker-compose.yml` mounts two directories:

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./vault` | `/vault` | All documents, organized files, and the SQLite database |
| `./config` | `/config` | `settings.yaml` configuration file |

:::tip[Back up the vault]
The `vault/` directory contains all your documents and the SQLite database. Make sure to include it in your backup strategy. You can also download a database backup from the Settings page in the web UI.

:::

### First Launch, Setup Wizard

1. Open [http://localhost:8070](http://localhost:8070)
2. On first launch (no users in the database), a **setup wizard** appears
3. Create your admin account (username, password, display name)
4. Create your first patient profile, pre-filled with your display name, with optional date of birth and sex
5. After completing the wizard, you are automatically logged in and redirected to the dashboard

:::note[The wizard only appears once]
The setup wizard is shown only when no users exist in the database. After setup, you'll see the normal login page.

:::

## Manual Installation (Development)

For development, you can run the backend and frontend separately. See [Development Setup](../development/setup.md) for details.
