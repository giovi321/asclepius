"""Application configuration loaded from YAML + environment variables."""

import os
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8000


class DatabaseConfig(BaseModel):
    path: str = "/vault/asclepius.sqlite"


class VaultConfig(BaseModel):
    root_path: str = "/vault"
    inbox_path: str = "/vault/inbox"
    patients_path: str = "/vault/patients"
    unclassified_path: str = "/vault/unclassified"


class AuthConfig(BaseModel):
    secret_key: str = "change-me-in-production"
    session_ttl_hours: int = 720


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


class OcrConfig(BaseModel):
    engine: str = "tesseract"  # 'tesseract', 'tesseract_remote', 'google_vision'
    language: str = "eng+ita+deu"
    confidence_threshold: float = 0.7
    remote_url: str = ""  # URL for remote OCR server
    remote_api_key: str = ""
    cloud_ocr_enabled: bool = False
    google_vision_key: str = ""


class LlmConfig(BaseModel):
    provider: str = "ollama"
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "llama3.1"
    claude_api_key: str = ""
    claude_model: str = "claude-sonnet-4-20250514"
    extraction_timeout: int = 120


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
    if secret := os.environ.get("ASCLEPIUS_SECRET_KEY"):
        config.auth.secret_key = secret
    if vault_path := os.environ.get("ASCLEPIUS_VAULT_PATH"):
        config.vault.root_path = vault_path
        config.vault.inbox_path = f"{vault_path}/inbox"
        config.vault.patients_path = f"{vault_path}/patients"
        config.vault.unclassified_path = f"{vault_path}/unclassified"
        config.database.path = f"{vault_path}/asclepius.sqlite"
    if ollama_url := os.environ.get("ASCLEPIUS_OLLAMA_URL"):
        config.llm.ollama_base_url = ollama_url
    if api_key := os.environ.get("ASCLEPIUS_ANTHROPIC_API_KEY"):
        if api_key:
            config.llm.claude_api_key = api_key
    if vision_key := os.environ.get("ASCLEPIUS_GOOGLE_VISION_KEY"):
        if vision_key:
            config.ocr.google_vision_key = vision_key
            config.ocr.cloud_ocr_enabled = True

    return config


@lru_cache
def get_config() -> AppConfig:
    """Get cached application configuration."""
    return load_config()
