"""YAML loader, legacy-format migrations, and credential resolution."""

import logging
import os
import secrets as _secrets
import time
import uuid as _uuid
from functools import lru_cache
from pathlib import Path

import yaml

from .models import (
    DEFAULT_SECRET_PLACEHOLDER,
    AppConfig,
    CredentialEntry,
    LlmProviderEntry,
    OcrProviderEntry,
    VisionLlmProviderEntry,
)

logger = logging.getLogger(__name__)


_LEGACY_LLM_KEYS = ("provider", "ollama_base_url", "ollama_model", "claude_api_key", "claude_model")


def _migrate_legacy_llm_yaml(data: dict) -> bool:
    """Convert pre-0.6 flat ``llm.*`` keys into ``llm.providers[]`` in-place.

    Returns True if a migration was performed. Strips legacy keys whether or
    not they were migrated (they no longer exist on ``LlmConfig``).
    """
    llm = data.get("llm")
    if not isinstance(llm, dict):
        return False
    had_legacy = any(k in llm for k in _LEGACY_LLM_KEYS)
    migrated = False
    if not llm.get("providers") and had_legacy:
        provider = llm.get("provider", "ollama")
        timeout = llm.get("extraction_timeout", 120)
        providers: list[dict] = [
            {
                "id": "ollama-default",
                "type": "ollama",
                "name": "Ollama (Local)",
                "enabled": provider == "ollama",
                "priority": 1,
                "base_url": llm.get("ollama_base_url", "http://ollama:11434"),
                "model": llm.get("ollama_model", "llama3.1"),
                "timeout": timeout,
            }
        ]
        if llm.get("claude_api_key"):
            providers.append(
                {
                    "id": "claude-default",
                    "type": "claude",
                    "name": "Claude API",
                    "enabled": provider == "claude",
                    "priority": 2,
                    "api_key": llm["claude_api_key"],
                    "model": llm.get("claude_model", "claude-sonnet-4-20250514"),
                    "timeout": timeout,
                }
            )
        llm["providers"] = providers
        migrated = True
    for k in _LEGACY_LLM_KEYS:
        llm.pop(k, None)
    data["llm"] = llm
    return migrated


def _migrate_vision_extraction_ocr_yaml(data: dict) -> bool:
    """Move any ``ocr.providers`` entries with ``type == 'vision_extraction'``
    into ``vision.providers``. The vision flow is now a first-class sibling of
    OCR and LLM, so these entries no longer belong under OCR.

    Returns True if a migration was performed. The YAML is mutated in place —
    caller is responsible for persisting it.
    """
    ocr = data.get("ocr")
    if not isinstance(ocr, dict):
        return False
    ocr_providers = ocr.get("providers")
    if not isinstance(ocr_providers, list) or not ocr_providers:
        return False

    to_migrate = [
        p for p in ocr_providers if isinstance(p, dict) and p.get("type") == "vision_extraction"
    ]
    if not to_migrate:
        return False

    vision = data.setdefault("vision", {})
    vision_providers = vision.setdefault("providers", [])
    existing_ids = {p.get("id") for p in vision_providers if isinstance(p, dict)}

    for src in to_migrate:
        vp_type = src.get("llm_provider") or "claude"
        mapped = {
            "id": src.get("id", ""),
            "type": vp_type if vp_type in ("claude", "openai", "ollama") else "claude",
            "name": src.get("name", ""),
            "enabled": src.get("enabled", True),
            "priority": src.get("priority", len(vision_providers) + 1),
            "base_url": src.get("llm_base_url", ""),
            "model": src.get("llm_model", ""),
            "api_key": src.get("llm_api_key", ""),
            "timeout": 600,
        }
        if mapped["id"] in existing_ids:
            continue
        vision_providers.append(mapped)
        existing_ids.add(mapped["id"])

    ocr["providers"] = [
        p
        for p in ocr_providers
        if not (isinstance(p, dict) and p.get("type") == "vision_extraction")
    ]
    data["ocr"] = ocr
    data["vision"] = vision
    return True


def _persist_yaml(data: dict) -> None:
    """Write the raw YAML dict back to disk at ASCLEPIUS_CONFIG_PATH."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))


def _new_credential_id() -> str:
    """Stable short id for a freshly-created credential."""
    return f"cred-{_uuid.uuid4().hex[:12]}"


# Types that don't meaningfully use a base_url. Claude and Google Vision
# always hit their provider's fixed endpoint; an OpenAI credential may
# optionally override the base but normally uses the default OpenAI URL.
# We normalise the stored base_url to "" for these so the UI doesn't show
# a nonsensical URL (e.g. the default "http://ollama:11434" that bleeds
# through from LlmProviderEntry's default when the user left it untouched).
_BASELESS_CREDENTIAL_TYPES = {"claude", "google_vision"}


def _normalise_base_url(cred_type: str, base_url: str) -> str:
    """Strip a base_url that doesn't apply to the credential type."""
    if cred_type in _BASELESS_CREDENTIAL_TYPES:
        return ""
    return base_url or ""


def _ensure_credential(
    credentials: list[CredentialEntry],
    cred_type: str,
    base_url: str,
    api_key: str,
    *,
    suggested_name: str = "",
) -> CredentialEntry | None:
    """Find or create a credential for (type, base_url, api_key).

    Returns the credential, or ``None`` if all three inputs are empty (no
    credential needed for this entry).
    """
    if not cred_type and not base_url and not api_key:
        return None
    # Local tesseract (no remote URL, no API key) doesn't need a credential.
    if cred_type in ("tesseract",) and not base_url and not api_key:
        return None
    clean_url = _normalise_base_url(cred_type, base_url)
    key = (cred_type or "", clean_url, api_key or "")
    for c in credentials:
        if (c.type, c.base_url, c.api_key) == key:
            return c
    existing_of_type = sum(1 for c in credentials if c.type == cred_type)
    name = suggested_name or f"Auto-imported {cred_type}" + (
        f" {existing_of_type + 1}" if existing_of_type else ""
    )
    entry = CredentialEntry(
        id=_new_credential_id(),
        name=name,
        type=cred_type or "ollama",
        base_url=clean_url,
        api_key=api_key,
    )
    credentials.append(entry)
    return entry


def _migrate_credentials(config: AppConfig) -> bool:
    """Populate ``config.credentials`` by deduping the inline credentials on
    LLM / Vision / OCR provider entries.

    Idempotent: entries that already have a ``credential_id`` are left alone
    (their inline fields are kept as-is so older code paths keep working).

    Returns True if anything was added.
    """
    credentials = list(config.credentials)
    changed = False

    # Scrub stale base_urls off existing credentials that don't meaningfully
    # use one (Claude, Google Vision). Early versions of the migration
    # carried over LlmProviderEntry.base_url's default "http://ollama:11434"
    # even for Claude entries, producing "Sonnet - claude - http://ollama..."
    # rows that confused the UI.
    for c in credentials:
        clean = _normalise_base_url(c.type, c.base_url)
        if clean != c.base_url:
            c.base_url = clean
            changed = True

    # Seed retry settings from the legacy global on first pass. Once a
    # credential has a non-default retry policy (or the global was modified
    # to differ from the default), this copy doesn't overwrite it.
    global_retries = int(getattr(config.llm, "max_retries", 3) or 3)
    global_backoff = list(getattr(config.llm, "retry_backoff_seconds", []) or [])
    if not global_backoff:
        global_backoff = [30, 60, 120]
    for c in credentials:
        pristine = c.max_retries == 3 and list(c.retry_backoff_seconds) == [30, 60, 120]
        if pristine and (global_retries != 3 or global_backoff != [30, 60, 120]):
            c.max_retries = global_retries
            c.retry_backoff_seconds = list(global_backoff)
            changed = True

    for p in config.llm.providers:
        if p.credential_id:
            continue
        cred = _ensure_credential(
            credentials,
            p.type,
            p.base_url,
            p.api_key,
            suggested_name=p.name or f"Auto-imported {p.type}",
        )
        if cred is not None:
            p.credential_id = cred.id
            changed = True

    for p in config.vision.providers:
        if p.credential_id:
            continue
        cred = _ensure_credential(
            credentials,
            p.type,
            p.base_url,
            p.api_key,
            suggested_name=p.name or f"Auto-imported {p.type}",
        )
        if cred is not None:
            p.credential_id = cred.id
            changed = True

    for p in config.ocr.providers:
        if p.credential_id:
            continue
        cred: CredentialEntry | None = None
        if p.type == "tesseract_remote" and p.remote_url:
            cred = _ensure_credential(
                credentials,
                "tesseract_remote",
                p.remote_url,
                p.remote_api_key,
                suggested_name=p.name or "Auto-imported tesseract_remote",
            )
        elif p.type == "llm_vision" and (p.llm_base_url or p.llm_api_key):
            cred = _ensure_credential(
                credentials,
                p.llm_provider or "ollama",
                p.llm_base_url,
                p.llm_api_key,
                suggested_name=p.name or f"Auto-imported {p.llm_provider or 'ollama'}",
            )
        elif p.type == "google_vision" and p.google_vision_key:
            cred = _ensure_credential(
                credentials,
                "google_vision",
                "",
                p.google_vision_key,
                suggested_name=p.name or "Auto-imported google_vision",
            )
        if cred is not None:
            p.credential_id = cred.id
            changed = True

    # General LLM bootstrap: if unset but we have an enabled pipeline provider,
    # default to priority-1.
    if not config.llm.general.credential_id and config.llm.providers:
        first = _first_enabled_llm(config)
        if first is not None:
            cred = _ensure_credential(
                credentials,
                first.type,
                first.base_url,
                first.api_key,
                suggested_name=first.name or f"Auto-imported {first.type}",
            )
            if cred is not None:
                config.llm.general.credential_id = cred.id
                config.llm.general.type = first.type
                config.llm.general.model = first.model
                config.llm.general.timeout = first.timeout
                changed = True

    if changed or credentials != config.credentials:
        config.credentials = credentials
        return True
    return False


def resolve_credential(config: AppConfig, credential_id: str) -> CredentialEntry | None:
    """Look up a credential by id; None if not found or id is empty."""
    if not credential_id:
        return None
    for c in config.credentials:
        if c.id == credential_id:
            return c
    return None


def _first_enabled_llm(config: AppConfig) -> LlmProviderEntry | None:
    enabled = [p for p in config.llm.providers if p.enabled]
    if enabled:
        return min(enabled, key=lambda p: p.priority)
    return config.llm.providers[0] if config.llm.providers else None


def _apply_env_ollama_url(config: AppConfig, url: str) -> None:
    for p in config.llm.providers:
        if p.type == "ollama":
            p.base_url = url
            return
    config.llm.providers.append(
        LlmProviderEntry(
            id="ollama-env",
            type="ollama",
            name="Ollama (Local)",
            enabled=True,
            priority=len(config.llm.providers) + 1,
            base_url=url,
            model="llama3.1",
            timeout=config.llm.extraction_timeout,
        )
    )


def _apply_env_claude_key(config: AppConfig, key: str) -> None:
    for p in config.llm.providers:
        if p.type == "claude":
            p.api_key = key
            return
    config.llm.providers.append(
        LlmProviderEntry(
            id="claude-env",
            type="claude",
            name="Claude API",
            enabled=False,
            priority=len(config.llm.providers) + 1,
            api_key=key,
            model="claude-sonnet-4-20250514",
            timeout=config.llm.extraction_timeout,
        )
    )


def load_config() -> AppConfig:
    """Load configuration from YAML file with environment variable overrides."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")

    data = {}
    if Path(config_path).exists():
        with open(config_path) as f:
            data = yaml.safe_load(f) or {}

    migrated_llm = _migrate_legacy_llm_yaml(data)
    migrated_vision = _migrate_vision_extraction_ocr_yaml(data)

    config = AppConfig(**data)

    if migrated_llm:
        logger.warning(
            "settings.yaml used pre-0.6 flat llm.* fields; they were auto-migrated "
            "to llm.providers[]. Save settings from the webui to persist the new layout.",
        )
    if migrated_vision:
        try:
            _persist_yaml(data)
            logger.info(
                "Migrated vision_extraction OCR providers to vision.providers - YAML persisted.",
            )
        except Exception:
            logger.exception(
                "Failed to persist vision migration - in-memory migration still applied"
            )

    if env := os.environ.get("ASCLEPIUS_ENV"):
        config.server.environment = env
    if secret := os.environ.get("ASCLEPIUS_SECRET_KEY"):
        config.auth.secret_key = secret
    if cookie_secure := os.environ.get("ASCLEPIUS_COOKIE_SECURE"):
        config.auth.cookie_secure = cookie_secure.lower() in ("1", "true", "yes")
    if cors := os.environ.get("ASCLEPIUS_CORS_ORIGINS"):
        config.server.cors_origins = [o.strip() for o in cors.split(",") if o.strip()]
    if vault_path := os.environ.get("ASCLEPIUS_VAULT_PATH"):
        config.vault.root_path = vault_path
        config.vault.inbox_path = f"{vault_path}/inbox"
        config.vault.patients_path = f"{vault_path}/patients"
        config.vault.unclassified_path = f"{vault_path}/unclassified"
        # Rebase the backup directory when it still points at the legacy
        # hardcoded default. Without this, running the backup tries to
        # mkdir /vault and fails with EACCES because the container user
        # has no write access to the filesystem root.
        if config.backup.directory == "/vault/backups":
            config.backup.directory = f"{vault_path}/backups"
    if db_path := os.environ.get("ASCLEPIUS_DB_PATH"):
        config.database.path = db_path
    if ollama_url := os.environ.get("ASCLEPIUS_OLLAMA_URL"):
        _apply_env_ollama_url(config, ollama_url)
    if api_key := os.environ.get("ASCLEPIUS_ANTHROPIC_API_KEY"):
        _apply_env_claude_key(config, api_key)
    if vision_key := os.environ.get("ASCLEPIUS_GOOGLE_VISION_KEY"):
        if vision_key:
            config.ocr.google_vision_key = vision_key
            config.ocr.cloud_ocr_enabled = True
    if share_public_url := os.environ.get("ASCLEPIUS_SHARE_PUBLIC_URL"):
        config.share.public_base_url = share_public_url.rstrip("/")
    # SMTP password override: lets container deployments inject the secret
    # via env without it ever being written to settings.yaml. The web UI
    # PATCH path still works; if both are set, env wins on every restart.
    if smtp_password := os.environ.get("ASCLEPIUS_SMTP_PASSWORD"):
        config.smtp.password = smtp_password

    # Migrate legacy flat OCR config → provider list (pre-0.6 settings.yaml).
    if not config.ocr.providers:
        ocr_providers: list[OcrProviderEntry] = []
        ocr_providers.append(
            OcrProviderEntry(
                id="tesseract-default",
                type="tesseract",
                name="Tesseract (Local)",
                enabled=(config.ocr.engine == "tesseract"),
                priority=1,
                language=config.ocr.language,
                confidence_threshold=config.ocr.confidence_threshold,
            )
        )
        if config.ocr.remote_url:
            ocr_providers.append(
                OcrProviderEntry(
                    id="tesseract-remote-default",
                    type="tesseract_remote",
                    name="Tesseract (Remote)",
                    enabled=(config.ocr.engine == "tesseract_remote"),
                    priority=2,
                    remote_url=config.ocr.remote_url,
                    remote_api_key=config.ocr.remote_api_key,
                    language=config.ocr.language,
                )
            )
        if config.ocr.llm_vision_model or config.ocr.engine == "llm_vision":
            fallback_llm = _first_enabled_llm(config)
            ocr_providers.append(
                OcrProviderEntry(
                    id="llm-vision-default",
                    type="llm_vision",
                    name="LLM Vision OCR",
                    enabled=(config.ocr.engine == "llm_vision"),
                    priority=3 if config.ocr.remote_url else 2,
                    llm_provider=config.ocr.llm_vision_provider
                    or (fallback_llm.type if fallback_llm else "ollama"),
                    llm_model=config.ocr.llm_vision_model,
                    llm_base_url=config.ocr.llm_vision_ollama_url
                    or (fallback_llm.base_url if fallback_llm else ""),
                    llm_api_key="",
                )
            )
        if config.ocr.google_vision_key:
            ocr_providers.append(
                OcrProviderEntry(
                    id="google-vision-default",
                    type="google_vision",
                    name="Google Cloud Vision",
                    enabled=(config.ocr.engine == "google_vision"),
                    priority=len(ocr_providers) + 1,
                    google_vision_key=config.ocr.google_vision_key,
                )
            )
        config.ocr.providers = ocr_providers

    migrated_creds = _migrate_credentials(config)
    if migrated_creds:
        try:
            data.setdefault("llm", {})["providers"] = [p.model_dump() for p in config.llm.providers]
            data.setdefault("vision", {})["providers"] = [
                p.model_dump() for p in config.vision.providers
            ]
            data.setdefault("ocr", {})["providers"] = [p.model_dump() for p in config.ocr.providers]
            data["llm"]["general"] = config.llm.general.model_dump()
            data["credentials"] = [c.model_dump() for c in config.credentials]
            _persist_yaml(data)
            logger.info(
                "Credential migration: created %d credentials; YAML persisted.",
                len(config.credentials),
            )
        except Exception:
            logger.exception(
                "Failed to persist credential migration - in-memory migration still applied"
            )

    return config


def get_active_llm_provider_config(config: AppConfig, priority: int = 1) -> LlmProviderEntry | None:
    """Get the enabled LLM provider at the given priority rank (1-based)."""
    enabled = sorted(
        [p for p in config.llm.providers if p.enabled],
        key=lambda p: p.priority,
    )
    if 0 < priority <= len(enabled):
        return enabled[priority - 1]
    return None


def get_active_vision_provider_config(
    config: AppConfig, priority: int = 1
) -> VisionLlmProviderEntry | None:
    """Get the enabled Vision-LLM provider at the given priority rank (1-based)."""
    enabled = sorted(
        [p for p in config.vision.providers if p.enabled],
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
            '`python -c "import secrets; print(secrets.token_urlsafe(48))"`.'
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
def _load_cached_config() -> AppConfig:
    """Inner cached loader; ``get_config`` calls this after the
    mtime-throttled freshness check decides whether the cache is valid."""
    config = load_config()
    _validate_production_config(config)
    return config


# Cross-container hot-reload state.
#
# The doctor-share architecture runs the same image as two processes —
# the admin/core container handles settings PATCH (mutates its own
# in-memory config and writes settings.yaml), and the share container
# serves the public surface. Without a reload, the share container's
# ``lru_cache``'d config stays frozen at startup, so an SMTP setting
# enabled in the UI never reaches it and email-OTP request-otp calls
# return 502 ("SMTP is disabled").
#
# Fix: track the YAML's mtime and, when ``get_config`` is called more
# than ``_RELOAD_CHECK_INTERVAL_S`` after the last check, ``stat`` the
# file. If it has been modified since the last load, clear the cache so
# the next call rebuilds from disk. Throttling keeps the cost down on
# the hot path (one ``stat`` per 5 s per process at worst).
_RELOAD_CHECK_INTERVAL_S: float = 5.0
_last_check_at: float = 0.0
_known_mtime: float | None = None


def _config_path() -> Path:
    return Path(os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml"))


def get_config() -> AppConfig:
    """Get the cached application config, auto-reloading when the YAML
    on disk changes.

    The auto-reload exists for the split-mode deployment where the
    share container does not handle settings PATCH itself — without it,
    the share container would serve stale SMTP / share configuration
    until it was restarted.

    The mtime check is throttled to once per
    ``_RELOAD_CHECK_INTERVAL_S``; in steady state this is one ``stat``
    call per 5 s per process. PATCH-in-process callers see no change
    in behaviour: the handler mutates the in-memory config in place
    BEFORE writing the YAML, so even when the subsequent reload re-
    reads the file the values are identical.
    """
    global _last_check_at, _known_mtime
    now = time.monotonic()
    if now - _last_check_at >= _RELOAD_CHECK_INTERVAL_S:
        _last_check_at = now
        try:
            mtime = _config_path().stat().st_mtime
        except OSError:
            mtime = None
        if mtime is not None:
            if _known_mtime is None:
                _known_mtime = mtime
            elif mtime > _known_mtime:
                _load_cached_config.cache_clear()
                _known_mtime = mtime
    return _load_cached_config()


# Preserve the original ``get_config.cache_clear()`` surface that tests
# (and the rare reset-cache callsite) rely on. Resetting the mtime
# bookkeeping at the same time guarantees the next call rebuilds.
def _reset_config_cache() -> None:
    global _last_check_at, _known_mtime
    _load_cached_config.cache_clear()
    _last_check_at = 0.0
    _known_mtime = None


get_config.cache_clear = _reset_config_cache  # type: ignore[attr-defined]


def generate_secret_key() -> str:
    """Convenience wrapper for generating a fresh secret key."""
    return _secrets.token_urlsafe(48)
