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

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Session signing key (change in production!) | `change-me-in-production` |
| `ANTHROPIC_API_KEY` | Claude API key (optional, for Claude LLM provider) | -- |
| `GOOGLE_VISION_KEY` | Google Cloud Vision API key (optional) | -- |
| `TZ` | Container timezone (IANA timezone name) | `Europe/Zurich` |

Example `.env` file:

```env
SECRET_KEY=your-random-secret-key-at-least-32-chars
ANTHROPIC_API_KEY=sk-ant-api03-...
TZ=Europe/Zurich
```

### Connecting to Ollama

If you run Ollama on the same machine as Asclepius, add an Ollama entry to `llm.providers`:

```yaml
llm:
  providers:
    - id: "ollama-1"
      type: "ollama"
      name: "Ollama (Local)"
      enabled: true
      priority: 1
      base_url: "http://host.docker.internal:11434"  # Docker Desktop
      # base_url: "http://192.168.1.100:11434"       # Or use the host IP
      model: "llama3.1"
      timeout: 120
```

If Ollama runs on a different machine, use that machine's IP or hostname. The same `base_url` / `model` fields are used for `vision.providers` entries — see [LLM & OCR Configuration](../admin-guide/llm-configuration.md#vision-llm-providers) for the Vision-LLM flow.

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
4. Create your first patient profile — pre-filled with your display name, but fully editable (date of birth, sex, blood type, allergies, contact info, insurance)
5. After completing the wizard, you are automatically logged in and redirected to the dashboard

!!! info "The wizard only appears once"
    The setup wizard is shown only when no users exist in the database. After setup, you'll see the normal login page.

## Manual Installation (Development)

For development, you can run the backend and frontend separately. See [Development Setup](../development/setup.md) for details.
