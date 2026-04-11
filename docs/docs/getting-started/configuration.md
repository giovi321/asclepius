# Configuration

All settings are defined in `config/settings.yaml`. Environment variables can override specific values. Settings can also be changed at runtime from the web UI under **Settings**.

## Full Configuration Reference

```yaml
server:
  host: "0.0.0.0"         # Bind address
  port: 8000               # Internal port (container)

database:
  path: "/vault/asclepius.sqlite"  # SQLite database path

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
  language: "eng+ita+deu"     # Tesseract language codes, + separated
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

## LLM Provider

Choose between Ollama (self-hosted) and Claude API:

=== "Ollama"

    ```yaml
    llm:
      provider: "ollama"
      ollama_base_url: "http://your-ollama-host:11434"
      ollama_model: "llama3.1"
      extraction_timeout: 120
    ```

    Make sure the model is pulled on your Ollama instance:
    ```bash
    ollama pull llama3.1
    ```

=== "Claude API"

    ```yaml
    llm:
      provider: "claude"
      claude_api_key: "sk-ant-..."
      claude_model: "claude-sonnet-4-20250514"
      extraction_timeout: 120
    ```

    Or set via environment variable: `ANTHROPIC_API_KEY=sk-ant-...`

## OCR Engines

Asclepius supports four OCR engines:

=== "Tesseract (Local)"

    The default engine. Runs locally inside the container. Good for most documents.

    ```yaml
    ocr:
      engine: "tesseract"
      language: "eng+ita+deu"
      confidence_threshold: 0.7
    ```

=== "Tesseract Remote"

    Send files to an external Tesseract server. Useful for offloading OCR to a more powerful machine.

    ```yaml
    ocr:
      engine: "tesseract_remote"
      remote_url: "http://ocr-server:8080/ocr"
      remote_api_key: "optional-api-key"
      language: "eng+ita+deu"
    ```

    Falls back to local Tesseract if the remote server is unreachable.

=== "LLM Vision"

    Sends page images directly to an LLM with vision capability. Best accuracy for messy or handwritten documents.

    ```yaml
    ocr:
      engine: "llm_vision"
      llm_vision_provider: "ollama"     # or "claude"
      llm_vision_model: "llava:13b"     # or any vision-capable model
      llm_vision_ollama_url: ""         # empty = use main Ollama URL
    ```

    You can use a **different** model and even a different Ollama server for OCR than for extraction. This lets you run a specialized vision model (like Chandra OCR) for reading documents while using a general-purpose model (like llama3.1) for data extraction.

    !!! tip "Chandra OCR"
        For best OCR quality, use `fredrezones55/chandra-ocr-2` as the vision model. It produces structured HTML output with semantic labels, which significantly improves extraction accuracy.

=== "Google Cloud Vision"

    Uses Google Cloud Vision API for OCR. Requires an API key.

    ```yaml
    ocr:
      engine: "google_vision"
      google_vision_key: "AIza..."
    ```

    Or set via environment variable: `GOOGLE_VISION_KEY=AIza...`

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
| `ASCLEPIUS_OLLAMA_URL` | `llm.ollama_base_url` |
| `ASCLEPIUS_ANTHROPIC_API_KEY` | `llm.claude_api_key` |
| `ASCLEPIUS_GOOGLE_VISION_KEY` | `ocr.google_vision_key` (also enables `cloud_ocr_enabled`) |
| `ASCLEPIUS_CONFIG_PATH` | Path to `settings.yaml` (default: `config/settings.yaml`) |
