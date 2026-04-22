# Installation

## Prerequisites

- **Docker and Docker Compose** (v2+)
- **An LLM provider** -- either an [Ollama](https://ollama.ai/) instance running on your network, or a [Claude API](https://console.anthropic.com/) key

!!! note "No bundled LLM"
    Asclepius does **not** bundle an LLM server. You must provide your own Ollama instance or a Claude API key. This keeps the container lightweight and gives you full control over your LLM setup.

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

This starts a single service:

- **asclepius** -- the main application on port `8070` (mapped from container port `8000`)

The container includes:

- Python 3.12 + FastAPI backend
- Pre-built React frontend (served as static files)
- Tesseract OCR with English, Italian, German, French, and Spanish language packs

### Environment Variables

You can set environment variables in a `.env` file alongside `docker-compose.yml`, or directly in the compose file:

Application env vars are prefixed with `ASCLEPIUS_`. The `TZ` variable is a plain Linux timezone name consumed by the container.

| Variable | Description | Default |
|----------|-------------|---------|
| `ASCLEPIUS_SECRET_KEY` | Session signing key (change in production!) | `change-me-in-production` |
| `ASCLEPIUS_ANTHROPIC_API_KEY` | Populates the Claude credential/provider `api_key` if one exists | — |
| `ASCLEPIUS_OLLAMA_URL` | Populates the Ollama credential/provider `base_url` if one exists | — |
| `ASCLEPIUS_GOOGLE_VISION_KEY` | Populates `ocr.google_vision_key` and flips `cloud_ocr_enabled` on | — |
| `ASCLEPIUS_COOKIE_SECURE` | Truthy value forces `Secure` cookies (set behind HTTPS) | `false` |
| `ASCLEPIUS_CORS_ORIGINS` | Comma-separated list of allowed CORS origins | — |
| `ASCLEPIUS_VAULT_PATH` | Overrides `vault.root_path` and all sub-paths | `/vault` |
| `ASCLEPIUS_DB_PATH` | Overrides `database.path` | `/vault/asclepius.sqlite` |
| `ASCLEPIUS_CONFIG_PATH` | Path to `settings.yaml` | `config/settings.yaml` |
| `ASCLEPIUS_ENV` | `development` or `production` (affects log formatting) | `production` |
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

If Ollama runs on a different machine, use that machine's IP or hostname. Vision-LLM providers reference the **same** credential — see [LLM & OCR Configuration](../admin-guide/llm-configuration.md#vision-llm-providers) for the Vision-LLM flow.

### Volume Mounts

The default `docker-compose.yml` mounts two directories:

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./vault` | `/vault` | All documents, organized files, and the SQLite database |
| `./config` | `/config` | `settings.yaml` configuration file |

!!! tip "Back up the vault"
    The `vault/` directory contains all your documents and the SQLite database. Make sure to include it in your backup strategy. You can also download a database backup from the Settings page in the web UI.

### First Launch — Setup Wizard

1. Open [http://localhost:8070](http://localhost:8070)
2. On first launch (no users in the database), a **setup wizard** appears
3. Create your admin account (username, password, display name)
4. Create your first patient profile — pre-filled with your display name, with optional date of birth and sex
5. After completing the wizard, you are automatically logged in and redirected to the dashboard

!!! info "The wizard only appears once"
    The setup wizard is shown only when no users exist in the database. After setup, you'll see the normal login page.

## Manual Installation (Development)

For development, you can run the backend and frontend separately. See [Development Setup](../development/setup.md) for details.
