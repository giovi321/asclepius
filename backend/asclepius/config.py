"""Application configuration loaded from YAML + environment variables.

Configuration precedence (lowest → highest):

1. Defaults declared on the pydantic models below.
2. ``config/settings.yaml`` (or the path in ``ASCLEPIUS_CONFIG_PATH``).
3. Specific ``ASCLEPIUS_*`` environment variables handled in
   :func:`load_config`.

The resulting :class:`AppConfig` is cached via ``get_config()``.
"""

import logging
import os
import secrets as _secrets
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Well-known placeholder that MUST NOT ship to production. We reject it at
# startup when running in production mode.
DEFAULT_SECRET_PLACEHOLDER = "change-me-in-production"


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8000
    # "development" or "production". Production enables strict checks
    # (secret-key validation, Secure cookies, CSRF header requirement).
    environment: str = "production"
    # Origins allowed by CORS. Only used in development; in production the
    # API and frontend are served from the same origin so CORS is disabled.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:8070",
    ]
    # Max upload size in bytes (default 100 MB).
    max_upload_bytes: int = 100 * 1024 * 1024
    # Allowed MIME type prefixes for uploads (detected by python-magic).
    allowed_upload_mime_prefixes: list[str] = [
        "application/pdf",
        "image/",
        "application/dicom",
        "application/octet-stream",  # some DICOM files
    ]


class DatabaseConfig(BaseModel):
    path: str = "/vault/asclepius.sqlite"


class VaultConfig(BaseModel):
    root_path: str = "/vault"
    inbox_path: str = "/vault/inbox"
    patients_path: str = "/vault/patients"
    unclassified_path: str = "/vault/unclassified"


class AuthConfig(BaseModel):
    # HMAC-like signing key for session cookies and OIDC state tokens.
    # In production this MUST be replaced with a strong random value (see
    # ``AppConfig.require_secure_defaults``).
    secret_key: str = DEFAULT_SECRET_PLACEHOLDER
    session_ttl_hours: int = 720
    # Mark cookies as Secure (HTTPS-only). Auto-enabled in production; can be
    # overridden for local HTTP testing via ``ASCLEPIUS_COOKIE_SECURE``.
    cookie_secure: bool = True
    cookie_samesite: str = "lax"  # "lax" | "strict" | "none"
    # Minimum password length accepted by the setup wizard / password change.
    min_password_length: int = 12
    # Login rate limit: max failed attempts per window per IP+username.
    login_max_attempts: int = 5
    login_window_seconds: int = 300


class OidcConfig(BaseModel):
    enabled: bool = False
    provider_url: str = ""  # e.g. https://auth.example.com/application/o/asclepius/
    client_id: str = ""
    client_secret: str = ""
    scopes: str = "openid profile email"
    # Auto-create user on first OIDC login
    auto_create_user: bool = True
    # Claim to use as username
    username_claim: str = "preferred_username"
    # Claim to use as display name
    display_name_claim: str = "name"


class OcrProviderEntry(BaseModel):
    """A single OCR provider configuration."""
    id: str = ""
    type: str = "tesseract"  # tesseract, tesseract_remote, llm_vision, vision_extraction, google_vision
    name: str = ""
    enabled: bool = True
    priority: int = 1
    # Tesseract settings
    language: str = "eng"
    # Remote Tesseract settings
    remote_url: str = ""
    remote_api_key: str = ""
    # LLM Vision settings
    llm_provider: str = "ollama"  # ollama, claude, openai
    llm_model: str = ""
    llm_base_url: str = ""
    llm_api_key: str = ""
    # Google Vision settings
    google_vision_key: str = ""
    # Shared
    confidence_threshold: float = 0.7


class LlmProviderEntry(BaseModel):
    """A single LLM provider configuration."""
    id: str = ""
    type: str = "ollama"  # ollama, vllm, claude, openai
    name: str = ""
    enabled: bool = True
    priority: int = 1
    base_url: str = "http://ollama:11434"
    model: str = "llama3.1"
    api_key: str = ""
    timeout: int = 120


class OcrConfig(BaseModel):
    # Legacy flat fields (kept for backward compatibility during migration)
    engine: str = "tesseract"
    language: str = "eng"
    confidence_threshold: float = 0.7
    remote_url: str = ""
    remote_api_key: str = ""
    cloud_ocr_enabled: bool = False
    google_vision_key: str = ""
    llm_vision_provider: str = ""
    llm_vision_model: str = ""
    llm_vision_ollama_url: str = ""
    # New: ordered provider list
    providers: list[OcrProviderEntry] = []


class LlmConfig(BaseModel):
    # Legacy flat fields (kept for backward compatibility during migration)
    provider: str = "ollama"
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "llama3.1"
    claude_api_key: str = ""
    claude_model: str = "claude-sonnet-4-20250514"
    extraction_timeout: int = 120
    # New: ordered provider list
    providers: list[LlmProviderEntry] = []


class PipelineConfig(BaseModel):
    watch_enabled: bool = True
    poll_interval_seconds: int = 5
    retry_interval_seconds: int = 300
    max_retries: int = 3


class AppConfig(BaseModel):
    server: ServerConfig = ServerConfig()
    database: DatabaseConfig = DatabaseConfig()
    vault: VaultConfig = VaultConfig()
    auth: AuthConfig = AuthConfig()
    oidc: OidcConfig = OidcConfig()
    ocr: OcrConfig = OcrConfig()
    llm: LlmConfig = LlmConfig()
    pipeline: PipelineConfig = PipelineConfig()


def load_config() -> AppConfig:
    """Load configuration from YAML file with environment variable overrides."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")

    data = {}
    if Path(config_path).exists():
        with open(config_path) as f:
            data = yaml.safe_load(f) or {}

    config = AppConfig(**data)

    # Environment variable overrides
    if env := os.environ.get("ASCLEPIUS_ENV"):
        config.server.environment = env
    if secret := os.environ.get("ASCLEPIUS_SECRET_KEY"):
        config.auth.secret_key = secret
    if cookie_secure := os.environ.get("ASCLEPIUS_COOKIE_SECURE"):
        config.auth.cookie_secure = cookie_secure.lower() in ("1", "true", "yes")
    if cors := os.environ.get("ASCLEPIUS_CORS_ORIGINS"):
        # Comma-separated list, e.g. "https://app.example.com,https://staging…"
        config.server.cors_origins = [o.strip() for o in cors.split(",") if o.strip()]
    if vault_path := os.environ.get("ASCLEPIUS_VAULT_PATH"):
        config.vault.root_path = vault_path
        config.vault.inbox_path = f"{vault_path}/inbox"
        config.vault.patients_path = f"{vault_path}/patients"
        config.vault.unclassified_path = f"{vault_path}/unclassified"
    if db_path := os.environ.get("ASCLEPIUS_DB_PATH"):
        config.database.path = db_path
    if ollama_url := os.environ.get("ASCLEPIUS_OLLAMA_URL"):
        config.llm.ollama_base_url = ollama_url
    if api_key := os.environ.get("ASCLEPIUS_ANTHROPIC_API_KEY"):
        if api_key:
            config.llm.claude_api_key = api_key
    if vision_key := os.environ.get("ASCLEPIUS_GOOGLE_VISION_KEY"):
        if vision_key:
            config.ocr.google_vision_key = vision_key
            config.ocr.cloud_ocr_enabled = True

    # Migrate legacy flat LLM / OCR config → provider list. These blocks exist
    # only to keep pre-0.6 settings.yaml files working; new deployments should
    # configure ``llm.providers`` / ``ocr.providers`` directly. Plan to delete
    # this code once 0.7 ships (see CHANGELOG).
    _used_legacy = False
    if not config.llm.providers:
        _used_legacy = True
        providers: list[LlmProviderEntry] = []
        # Always add Ollama as default
        providers.append(LlmProviderEntry(
            id="ollama-default",
            type="ollama",
            name="Ollama (Local)",
            enabled=(config.llm.provider == "ollama"),
            priority=1,
            base_url=config.llm.ollama_base_url,
            model=config.llm.ollama_model,
            timeout=config.llm.extraction_timeout,
        ))
        # Add Claude if key is set
        if config.llm.claude_api_key:
            providers.append(LlmProviderEntry(
                id="claude-default",
                type="claude",
                name="Claude API",
                enabled=(config.llm.provider == "claude"),
                priority=2,
                api_key=config.llm.claude_api_key,
                model=config.llm.claude_model,
                timeout=config.llm.extraction_timeout,
            ))
        config.llm.providers = providers

    # Migrate legacy flat OCR config → provider list (see deprecation note above)
    if not config.ocr.providers:
        _used_legacy = True
        ocr_providers: list[OcrProviderEntry] = []
        ocr_providers.append(OcrProviderEntry(
            id="tesseract-default",
            type="tesseract",
            name="Tesseract (Local)",
            enabled=(config.ocr.engine == "tesseract"),
            priority=1,
            language=config.ocr.language,
            confidence_threshold=config.ocr.confidence_threshold,
        ))
        if config.ocr.remote_url:
            ocr_providers.append(OcrProviderEntry(
                id="tesseract-remote-default",
                type="tesseract_remote",
                name="Tesseract (Remote)",
                enabled=(config.ocr.engine == "tesseract_remote"),
                priority=2,
                remote_url=config.ocr.remote_url,
                remote_api_key=config.ocr.remote_api_key,
                language=config.ocr.language,
            ))
        if config.ocr.llm_vision_model or config.ocr.engine == "llm_vision":
            ocr_providers.append(OcrProviderEntry(
                id="llm-vision-default",
                type="llm_vision",
                name="LLM Vision OCR",
                enabled=(config.ocr.engine == "llm_vision"),
                priority=3 if config.ocr.remote_url else 2,
                llm_provider=config.ocr.llm_vision_provider or config.llm.provider,
                llm_model=config.ocr.llm_vision_model,
                llm_base_url=config.ocr.llm_vision_ollama_url or config.llm.ollama_base_url,
                llm_api_key=config.llm.claude_api_key if (config.ocr.llm_vision_provider == "claude") else "",
            ))
        if config.ocr.google_vision_key:
            ocr_providers.append(OcrProviderEntry(
                id="google-vision-default",
                type="google_vision",
                name="Google Cloud Vision",
                enabled=(config.ocr.engine == "google_vision"),
                priority=len(ocr_providers) + 1,
                google_vision_key=config.ocr.google_vision_key,
            ))
        config.ocr.providers = ocr_providers

    if _used_legacy:
        logger.warning(
            "settings.yaml still uses the flat llm/ocr layout; migrate to "
            "the `providers` list before 0.7 (this auto-migration will be removed).",
        )

    return config


def get_active_llm_provider_config(config: AppConfig, priority: int = 1) -> LlmProviderEntry | None:
    """Get the enabled LLM provider at the given priority rank (1-based).

    Priority 1 = highest priority enabled provider, 2 = next, etc.
    """
    enabled = sorted(
        [p for p in config.llm.providers if p.enabled],
        key=lambda p: p.priority,
    )
    if 0 < priority <= len(enabled):
        return enabled[priority - 1]
    return None


def get_active_ocr_provider_config(config: AppConfig, priority: int = 1) -> OcrProviderEntry | None:
    """Get the enabled OCR provider at the given priority rank (1-based)."""
    enabled = sorted(
        [p for p in config.ocr.providers if p.enabled],
        key=lambda p: p.priority,
    )
    if 0 < priority <= len(enabled):
        return enabled[priority - 1]
    return None


def _validate_production_config(config: AppConfig) -> None:
    """Refuse to run in production with insecure defaults.

    Checked invariants:
    - Secret key is not the placeholder and is at least 32 bytes.
    - Secure cookies are enabled (HTTPS assumed behind a reverse proxy).

    In development we only log warnings so local ``uvicorn --reload`` stays
    friction-free.
    """
    is_prod = config.server.environment.lower() == "production"
    problems: list[str] = []

    if config.auth.secret_key == DEFAULT_SECRET_PLACEHOLDER:
        problems.append(
            "ASCLEPIUS_SECRET_KEY is still the placeholder; generate one with "
            "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"`."
        )
    elif len(config.auth.secret_key) < 32:
        problems.append("ASCLEPIUS_SECRET_KEY must be at least 32 characters.")

    if is_prod and not config.auth.cookie_secure:
        problems.append(
            "cookie_secure is False in production; front the app with HTTPS "
            "and set ASCLEPIUS_COOKIE_SECURE=1."
        )

    if problems:
        msg = "Insecure configuration detected:\n  - " + "\n  - ".join(problems)
        if is_prod:
            raise RuntimeError(msg)
        logger.warning(msg)


@lru_cache
def get_config() -> AppConfig:
    """Get cached application configuration.

    Validates the production configuration on first access; a misconfigured
    production deployment will fail fast here instead of silently signing
    cookies with a well-known key.
    """
    config = load_config()
    _validate_production_config(config)
    return config


def generate_secret_key() -> str:
    """Convenience wrapper for generating a fresh secret key."""
    return _secrets.token_urlsafe(48)
