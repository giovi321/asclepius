"""Public surface of the Asclepius config package.

Everything callers used to import from ``asclepius.config`` (the old flat
module) is re-exported here so ``from asclepius.config import AppConfig,
get_config, LlmProviderEntry, ...`` keeps working.
"""

from .models import (
    DEFAULT_SECRET_PLACEHOLDER,
    AppConfig,
    AuthConfig,
    BackupConfig,
    CredentialEntry,
    DatabaseConfig,
    GeneralLlmConfig,
    LlmConfig,
    LlmProviderEntry,
    OcrConfig,
    OcrProviderEntry,
    OidcConfig,
    PipelineConfig,
    ServerConfig,
    ShareConfig,
    VaultConfig,
    VisionConfig,
    VisionLlmProviderEntry,
)
from .resolver import (
    generate_secret_key,
    get_active_llm_provider_config,
    get_active_ocr_provider_config,
    get_active_vision_provider_config,
    get_config,
    load_config,
    resolve_credential,
)
# Private helpers (prefixed with ``_``) remain importable via
# ``from asclepius.config.resolver import _first_enabled_llm`` etc; they are
# deliberately not part of this module's public surface.

__all__ = [
    "DEFAULT_SECRET_PLACEHOLDER",
    "AppConfig",
    "AuthConfig",
    "BackupConfig",
    "CredentialEntry",
    "DatabaseConfig",
    "GeneralLlmConfig",
    "LlmConfig",
    "LlmProviderEntry",
    "OcrConfig",
    "OcrProviderEntry",
    "OidcConfig",
    "PipelineConfig",
    "ServerConfig",
    "ShareConfig",
    "VaultConfig",
    "VisionConfig",
    "VisionLlmProviderEntry",
    "generate_secret_key",
    "get_active_llm_provider_config",
    "get_active_ocr_provider_config",
    "get_active_vision_provider_config",
    "get_config",
    "load_config",
    "resolve_credential",
]
