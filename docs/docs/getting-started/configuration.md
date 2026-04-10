# Configuration

All settings are defined in `config/settings.yaml`. Environment variables can override specific values.

## Full Configuration Reference

```yaml
server:
  host: "0.0.0.0"
  port: 8000

database:
  path: "/vault/asclepius.sqlite"

vault:
  root_path: "/vault"
  inbox_path: "/vault/inbox"
  patients_path: "/vault/patients"
  unclassified_path: "/vault/unclassified"

auth:
  secret_key: "change-me-in-production"
  session_ttl_hours: 720  # 30 days

ocr:
  engine: "tesseract"
  language: "eng+ita+deu"  # Tesseract language codes, + separated
  confidence_threshold: 0.7  # Below this, mark as needs_review
  cloud_ocr_enabled: false
  google_vision_key: ""

llm:
  provider: "ollama"  # "ollama" or "claude"
  ollama_base_url: "http://ollama:11434"
  ollama_model: "llama3.1"
  claude_api_key: ""
  claude_model: "claude-sonnet-4-20250514"
  extraction_timeout: 120  # seconds

pipeline:
  watch_enabled: true
  poll_interval_seconds: 5
  retry_interval_seconds: 300
  max_retries: 3
```

## LLM Provider

Choose between local (Ollama) and cloud (Claude API):

=== "Ollama (Local)"

    ```yaml
    llm:
      provider: "ollama"
      ollama_base_url: "http://ollama:11434"
      ollama_model: "llama3.1"
    ```

    Pull the model first: `docker compose exec ollama ollama pull llama3.1`

=== "Claude API"

    ```yaml
    llm:
      provider: "claude"
      claude_api_key: "sk-ant-..."
      claude_model: "claude-sonnet-4-20250514"
    ```

    Or set via environment: `ANTHROPIC_API_KEY=sk-ant-...`

## OCR Languages

Tesseract language codes are `+` separated. Common codes:

| Code | Language |
|------|----------|
| `eng` | English |
| `ita` | Italian |
| `deu` | German |
| `fra` | French |
| `spa` | Spanish |

Install additional language packs in the Docker image by editing `backend/Dockerfile`.

## Security

!!! warning "Change the secret key"
    Always change `auth.secret_key` in production. Use a random string of at least 32 characters.

Generate a secure key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```
