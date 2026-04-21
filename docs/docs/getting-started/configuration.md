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
  # Global defaults (used when no provider-level override is set)
  language: "eng"              # Tesseract language codes, + separated
  confidence_threshold: 0.7    # Below this, document marked as needs_review
  # Ordered provider list — tried in priority order for the OCR+LLM flow.
  providers:
    - id: "tesseract-1"
      type: "tesseract"        # tesseract | tesseract_remote | llm_vision | google_vision
      name: "Tesseract"
      enabled: true
      priority: 1
      language: "eng+ita+deu"

llm:
  extraction_timeout: 120          # Per-provider timeout (seconds)
  max_concurrent_requests: 2       # Parallel LLM calls across providers
  max_retries: 3                   # Retries on transient failures
  retry_backoff_seconds: [30, 60, 120]  # Wait between successive retries
  canonical_language: "English"    # Language for LLM-authored free-form text
  # Ordered provider list — tried in priority order.
  providers:
    - id: "ollama-1"
      type: "ollama"           # ollama | vllm | claude | openai
      name: "Ollama"
      enabled: true
      priority: 1
      base_url: "http://ollama:11434"
      model: "llama3.1"
      timeout: 120

vision:
  # Alternative to OCR + text-LLM: sends page images to a vision LLM that
  # returns both OCR text and structured extraction in one call.
  extraction_timeout: 600
  max_concurrent_requests: 2
  max_retries: 3
  retry_backoff_seconds: [30, 60, 120]
  providers:
    - id: "qwen25vl-1"
      type: "ollama"           # ollama | claude | openai
      name: "Qwen2.5-VL (local)"
      enabled: true
      priority: 1
      base_url: "http://ollama:11434"
      model: "qwen2.5vl:7b"
      timeout: 600

pipeline:
  watch_enabled: true                # Auto-process files dropped in inbox
  poll_interval_seconds: 5           # How often to check for new files
  retry_interval_seconds: 300        # Wait before retrying failed extractions
  max_retries: 3                     # Max retry attempts for failed documents
  default_flow: "ocr_llm"            # "ocr_llm" or "vision_llm" — which path new uploads use
```

## Providers and processing flows

Asclepius has two mutually exclusive extraction flows:

- **OCR + LLM** (`pipeline.default_flow: "ocr_llm"`): extract text with an OCR engine, then send the text to a language model for classification and structured extraction.
- **Vision-LLM** (`pipeline.default_flow: "vision_llm"`): send page images directly to a vision-capable LLM that returns both the transcribed text and the structured extraction in a single call.

Each flow has its own priority-ordered provider list:

| Flow          | Config section  | Supported types                                              | UI location                                                      |
|---------------|-----------------|--------------------------------------------------------------|------------------------------------------------------------------|
| OCR           | `ocr.providers` | `tesseract`, `tesseract_remote`, `llm_vision`, `google_vision` | Settings → Document Analysis → **OCR Providers**                 |
| Text LLM      | `llm.providers` | `ollama`, `vllm`, `claude`, `openai`                          | Settings → Document Analysis → **LLM Providers**                 |
| Vision LLM    | `vision.providers` | `ollama`, `claude`, `openai`                                | Settings → Document Analysis → **Vision-LLM Providers**          |

The pipeline tries providers in priority order; on failure it falls through to the next enabled one. A per-document override is available from the document detail page.

`pipeline.default_flow` only affects **new uploads**. Existing documents can be reprocessed with any of four modes (OCR+LLM, OCR only, LLM only, Vision-LLM) from the document detail page.

See [LLM & OCR Configuration](../admin-guide/llm-configuration.md) for full details, YAML examples, and recommended models.

### Legacy configuration

Older settings files used flat `llm.provider` / `ocr.engine` fields and a `vision_extraction` OCR provider type. Asclepius auto-migrates these at startup:

- Flat `llm.*` keys are folded into `llm.providers[]`.
- Any OCR provider entry with `type: vision_extraction` is moved into `vision.providers[]`.

The migrated file is re-written to disk on first run.

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
| `ASCLEPIUS_ENV` | `server.environment` (`development` or `production`) |
| `ASCLEPIUS_COOKIE_SECURE` | `auth.cookie_secure` (truthy value enables Secure cookies) |
| `ASCLEPIUS_CORS_ORIGINS` | `server.cors_origins` (comma-separated list) |
| `ASCLEPIUS_VAULT_PATH` | `vault.root_path` and all sub-paths |
| `ASCLEPIUS_DB_PATH` | `database.path` |
| `ASCLEPIUS_OLLAMA_URL` | `base_url` on the first `llm.providers` entry of type `ollama` (creates one if none exists) |
| `ASCLEPIUS_ANTHROPIC_API_KEY` | `api_key` on the first `llm.providers` entry of type `claude` (creates one if none exists) |
| `ASCLEPIUS_GOOGLE_VISION_KEY` | `ocr.google_vision_key` (also enables `cloud_ocr_enabled`) |
| `ASCLEPIUS_CONFIG_PATH` | Path to `settings.yaml` (default: `config/settings.yaml`) |
| `TZ` | Container timezone (default: `Europe/Zurich`) |
