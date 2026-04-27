"""Pydantic schemas for every section of the Asclepius config file.

Pure data definitions — no I/O, no globals, no env reading. All of that
lives in :mod:`asclepius.config.resolver`.
"""

from pydantic import BaseModel

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
    # Max upload size in bytes (default 1 GB). DICOM studies routinely
    # exceed 100 MB; raising the default lets a single zip carrying a full
    # CT/MRI/US exam land in one request.
    max_upload_bytes: int = 1024 * 1024 * 1024
    # Allowed MIME type prefixes for uploads (detected by python-magic).
    allowed_upload_mime_prefixes: list[str] = [
        "application/pdf",
        "image/",
        "application/dicom",
        "application/octet-stream",  # some DICOM files
        "application/zip",
        "application/x-zip-compressed",
    ]
    # Max combined uncompressed size of a single zip upload, in bytes.
    # Defends against zip-bomb DoS by capping expansion before extraction
    # writes any member to disk.
    max_zip_uncompressed_bytes: int = 4 * 1024 * 1024 * 1024


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

    # Role / group synchronisation. When ``sync_roles`` is true, the local
    # ``users.role`` is (re-)computed on every OIDC login from the groups or
    # roles the provider asserts in ``roles_claim``. This keeps the admin
    # cohort managed centrally in Authentik / Keycloak instead of getting
    # out of sync in the local DB.
    sync_roles: bool = False
    # Dotted path into the userinfo payload that holds the list of roles /
    # groups. Works for Authentik's default ``groups``, and for
    # Keycloak-style ``realm_access.roles`` (nested list).
    roles_claim: str = "groups"
    # Names of OIDC roles/groups that map to each local role. First match
    # wins in the order admin → editor → viewer. Case-sensitive.
    admin_roles: list[str] = []
    editor_roles: list[str] = []
    viewer_roles: list[str] = []
    # Local role granted when sync is on and no mapping matches.
    default_role: str = "viewer"


class CredentialEntry(BaseModel):
    """A shared connection/credential definition referenced by provider entries.

    One credential can be reused by multiple LLM/Vision/OCR entries (e.g. two
    models on the same Ollama server, or several models on the same OpenAI
    account). Edit the credential once and every referencing entry picks up
    the change.

    ``max_concurrent`` is the concurrency cap for this connection — all
    models sharing this credential share the same queue, matching how the
    physical resource actually behaves (one Ollama server has a fixed
    parallelism limit regardless of which model is loaded).
    """
    id: str = ""
    name: str = ""
    # ollama | vllm | claude | openai | google_vision | tesseract_remote
    type: str = "ollama"
    base_url: str = ""
    api_key: str = ""
    max_concurrent: int = 2
    # Retry policy for transient failures (timeouts, connection errors).
    # Moved from the global LlmConfig / VisionConfig so different endpoints
    # can have different policies (Claude's 429 behaviour is not the same as
    # Ollama timeouts).
    max_retries: int = 3
    retry_backoff_seconds: list[int] = [30, 60, 120]


class OcrProviderEntry(BaseModel):
    """A single OCR provider configuration."""
    id: str = ""
    type: str = "tesseract"  # tesseract, tesseract_remote, llm_vision, google_vision
    name: str = ""
    enabled: bool = True
    priority: int = 1
    # Shared connection (tesseract_remote, google_vision, llm_vision). Empty
    # for local Tesseract, which has no credentials.
    credential_id: str = ""
    # Tesseract settings
    language: str = "eng"
    # Remote Tesseract settings (legacy — prefer credential_id for new entries)
    remote_url: str = ""
    remote_api_key: str = ""
    # LLM Vision settings (llm_provider is the underlying type;
    # llm_model is the model name. credential_id supplies base_url + api_key.)
    llm_provider: str = "ollama"  # ollama, claude, openai
    llm_model: str = ""
    llm_base_url: str = ""
    llm_api_key: str = ""
    # Google Vision settings (legacy — prefer credential_id)
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
    # Shared connection — when set, base_url/api_key are derived from it and
    # the concurrency cap comes from the credential's ``max_concurrent``.
    credential_id: str = ""
    base_url: str = "http://ollama:11434"
    model: str = "llama3.1"
    api_key: str = ""
    timeout: int = 120


class VisionLlmProviderEntry(BaseModel):
    """A single Vision-LLM provider configuration.

    Vision-LLM providers receive page images directly and return both the
    OCR'd text AND the structured classification/extraction in a single call,
    as an alternative to the OCR + text-LLM pipeline.
    """
    id: str = ""
    type: str = "claude"  # claude, openai, ollama
    name: str = ""
    enabled: bool = True
    priority: int = 1
    credential_id: str = ""
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    timeout: int = 600


class GeneralLlmConfig(BaseModel):
    """Single model used for everything that isn't the document-analysis pipeline.

    Covers chat, auto-merge, auto-rename, link suggestion, event extraction,
    and document-edit AI. When ``credential_id`` is empty, those endpoints
    return 503. The concurrency cap comes from the credential.
    """
    credential_id: str = ""
    type: str = "ollama"  # same vocabulary as LlmProviderEntry.type
    model: str = ""
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
    # Max concurrent vision-OCR page requests across the whole process. The
    # backing Ollama / OpenAI server typically runs one vision inference at
    # a time per model, so firing parallel reprocesses just builds a queue
    # that trips read timeouts — serialise locally instead.
    # ``1`` = fully serialised (default, safest for self-hosted Ollama).
    max_concurrent_vision_requests: int = 1
    # New: ordered provider list
    providers: list[OcrProviderEntry] = []


class LlmConfig(BaseModel):
    extraction_timeout: int = 120
    # Max concurrent LLM requests across all providers. Prevents flooding a
    # single Ollama/vLLM instance when the pipeline reprocesses multiple
    # documents in parallel. 1 = fully serialized.
    max_concurrent_requests: int = 2
    # Max output tokens for the extraction call. Lab panels with 20+ results
    # routinely exceed the old hard-coded 4k ceiling and the LLM truncates
    # mid-JSON. 16k covers typical panels with headroom; raise further in
    # settings.yaml if outlier documents hit the ceiling.
    extraction_max_output_tokens: int = 16384
    # Max output tokens for the classification call. Classification output
    # is small (doc_type, patient, dates, summary), so 4k is generous.
    classification_max_output_tokens: int = 4096
    # Retry behavior for transient failures (ReadTimeout, ConnectError) on
    # Ollama. The number of attempts is ``max_retries + 1`` — the first
    # attempt plus the retries. ``retry_backoff_seconds`` lists the sleep
    # between successive attempts; if shorter than ``max_retries``, the last
    # value is reused.
    max_retries: int = 3
    retry_backoff_seconds: list[int] = [30, 60, 120]
    # Ordered provider list — tried in priority order.
    providers: list[LlmProviderEntry] = []
    # Canonical output language — every free-form text field produced by the
    # LLM (summaries, canonical names, findings, notes, etc.) is forced into
    # this language via a prepended directive on every prompt. Defaults to
    # English to keep the historical behaviour.
    canonical_language: str = "English"
    # General-purpose LLM (non-pipeline). See GeneralLlmConfig.
    general: GeneralLlmConfig = GeneralLlmConfig()


class VisionConfig(BaseModel):
    """Vision-LLM flow configuration — alternative to OCR + text-LLM."""
    extraction_timeout: int = 600
    max_concurrent_requests: int = 2
    max_retries: int = 3
    retry_backoff_seconds: list[int] = [30, 60, 120]
    # Ordered provider list — tried in priority order.
    providers: list[VisionLlmProviderEntry] = []


class PipelineConfig(BaseModel):
    watch_enabled: bool = True
    poll_interval_seconds: int = 5
    retry_interval_seconds: int = 300
    max_retries: int = 3
    # Which extraction flow new uploads use by default: "ocr_llm" runs OCR
    # then a text LLM; "vision_llm" sends page images to a vision LLM for
    # single-step OCR+extraction. Per-document reprocess overrides this.
    default_flow: str = "ocr_llm"


class BackupConfig(BaseModel):
    """One scheduled backup job.

    The user picks what to include (database, vault, or both) via the two
    boolean flags. Retention is a single policy: keep the last N files OR
    everything newer than N days, not both.
    """
    directory: str = "/vault/backups"
    enabled: bool = False
    include_database: bool = True
    include_vault: bool = False
    schedule: str = "daily"           # "hourly" | "daily" | "weekly"
    retention_mode: str = "count"     # "count" | "days"
    retention_value: int = 7


class AppConfig(BaseModel):
    server: ServerConfig = ServerConfig()
    database: DatabaseConfig = DatabaseConfig()
    vault: VaultConfig = VaultConfig()
    auth: AuthConfig = AuthConfig()
    oidc: OidcConfig = OidcConfig()
    ocr: OcrConfig = OcrConfig()
    llm: LlmConfig = LlmConfig()
    vision: VisionConfig = VisionConfig()
    pipeline: PipelineConfig = PipelineConfig()
    backup: BackupConfig = BackupConfig()
    # Shared credentials referenced by LLM / Vision / OCR provider entries.
    credentials: list[CredentialEntry] = []
