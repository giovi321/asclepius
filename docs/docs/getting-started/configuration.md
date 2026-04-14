# Configuration

All settings are defined in `config/settings.yaml`. Environment variables can override specific values. Settings can also be changed at runtime from the web UI under **Settings**.

## Full Configuration Reference

```yaml
server:
  host: "0.0.0.0"         # Bind address
  port: 8000               # Internal port (container)

database:
  path: "asclepius.sqlite"         # SQLite database path

vault:
  root_path: "/vault"              # Root directory for all files
  inbox_path: "/vault/inbox"       # Drop files here for processing
  patients_path: "/vault/patients" # Organized patient files
  unclassified_path: "/vault/unclassified"  # Docs without a patient

auth:
  secret_key: "change-me-in-production"  # Session signing key
  session_ttl_hours: 720                 # Session lifetime (30 days)

# OIDC / SSO (Authentik, Keycloak, etc.)
oidc:
  enabled: false
  provider_url: ""            # e.g. https://auth.example.com/application/o/asclepius/
  client_id: ""
  client_secret: ""
  scopes: "openid profile email"
  auto_create_user: true      # Create user on first OIDC login
  username_claim: "preferred_username"  # OIDC claim for username
  display_name_claim: "name"           # OIDC claim for display name

ocr:
  engine: "tesseract"         # tesseract, tesseract_remote, llm_vision, google_vision
  language: "eng"              # Tesseract language codes, + separated
  confidence_threshold: 0.7   # Below this, document marked as needs_review
  remote_url: ""              # URL for remote Tesseract server
  remote_api_key: ""          # API key for remote Tesseract server
  cloud_ocr_enabled: false    # Enable Google Cloud Vision fallback
  google_vision_key: ""       # Google Cloud Vision API key
  # LLM Vision OCR (when engine = llm_vision)
  llm_vision_provider: ""     # 'ollama' or 'claude' (empty = use main llm.provider)
  llm_vision_model: ""        # e.g. 'llava:13b', 'llama3.2-vision' (empty = use main llm model)
  llm_vision_ollama_url: ""   # Ollama URL for vision model (empty = use llm.ollama_base_url)

llm:
  provider: "ollama"          # "ollama" or "claude"
  ollama_base_url: "http://ollama:11434"
  ollama_model: "llama3.1"
  claude_api_key: ""
  claude_model: "claude-sonnet-4-20250514"
  extraction_timeout: 120     # Seconds before LLM call times out

pipeline:
  watch_enabled: true          # Auto-process files dropped in inbox
  poll_interval_seconds: 5     # How often to check for new files
  retry_interval_seconds: 300  # Wait before retrying failed extractions
  max_retries: 3               # Max retry attempts for failed documents
```

## LLM & OCR Providers

Asclepius uses a **multi-provider priority system**. You can configure multiple LLM and OCR providers, enable/disable each one, and set their priority order. The pipeline uses the highest-priority enabled provider. You can escalate to the next provider from the document detail page if results are unsatisfactory.

**Supported LLM providers:** Ollama, vLLM, Claude API, OpenAI API

**Supported OCR providers:** Tesseract (local), Tesseract (remote), LLM Vision, Google Cloud Vision

All providers are configured from the web UI: **Settings** > **Document Analysis** > **LLM Providers** / **OCR Providers**.

See [LLM & OCR Configuration](../admin-guide/llm-configuration.md) for full details, YAML examples, and recommended models.

### Quick Setup

The simplest configuration: one Ollama instance for both LLM and OCR.

```yaml
llm:
  providers:
    - id: "ollama-1"
      type: "ollama"
      name: "Ollama"
      enabled: true
      priority: 1
      base_url: "http://ollama:11434"
      model: "llama3.1"
      timeout: 120

ocr:
  providers:
    - id: "tesseract-1"
      type: "tesseract"
      name: "Tesseract"
      enabled: true
      priority: 1
      language: "eng+ita+deu"
```

### Legacy Configuration

The old flat `llm.provider` / `ocr.engine` format still works. Asclepius auto-migrates it to the new provider list on startup.

## OCR Languages

Tesseract language codes are `+` separated. The Docker image includes these language packs:

| Code | Language |
|------|----------|
| `eng` | English |
| `ita` | Italian |
| `deu` | German |
| `fra` | French |
| `spa` | Spanish |

To add more languages, extend the `Dockerfile` with additional `tesseract-ocr-*` packages.

## OIDC / SSO

To enable single sign-on with Authentik, Keycloak, or another OIDC provider:

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

See [User Management](../admin-guide/user-management.md) for details on configuring SSO.

## Security

!!! warning "Change the secret key"
    Always change `auth.secret_key` in production. Use a random string of at least 32 characters.

Generate a secure key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Environment Variable Overrides

These environment variables override `settings.yaml` values:

| Variable | Overrides |
|----------|-----------|
| `ASCLEPIUS_SECRET_KEY` | `auth.secret_key` |
| `ASCLEPIUS_VAULT_PATH` | `vault.root_path` and all sub-paths + `database.path` |
| `ASCLEPIUS_DATA_PATH` | Separate path for database and config data |
| `ASCLEPIUS_DB_PATH` | `database.path` |
| `ASCLEPIUS_OLLAMA_URL` | `llm.ollama_base_url` |
| `ASCLEPIUS_ANTHROPIC_API_KEY` | `llm.claude_api_key` |
| `ASCLEPIUS_GOOGLE_VISION_KEY` | `ocr.google_vision_key` (also enables `cloud_ocr_enabled`) |
| `ASCLEPIUS_CONFIG_PATH` | Path to `settings.yaml` (default: `config/settings.yaml`) |
