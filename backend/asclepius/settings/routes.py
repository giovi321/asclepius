"""Settings router — thin aggregator for the split sub-routers.

The per-topic handlers live in:
  - logs_routes.py        (GET /logs)
  - backup_routes.py      (audit log, on-demand + scheduled backups)
  - prompts_routes.py     (prompt registry)
  - provider_routes.py    (LLM / OCR / Vision providers, credentials, tests)
  - users_routes.py       (users, patient access, sessions)

This module keeps only the top-level ``GET /`` and ``PATCH /`` endpoints that
return / mutate the flat settings blob, plus the mapping that glues
``SettingsUpdate`` fields to YAML keys and in-memory config paths.
"""

import os
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import aiosqlite
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.auth.session import get_current_user, require_role
from asclepius.config import get_config
from asclepius.db.connection import get_db

from .backup_routes import _backup_state_block
from .backup_routes import router as backup_router
from .logs_routes import router as logs_router
from .prompts_routes import router as prompts_router
from .provider_routes import router as provider_router
from .users_routes import router as users_router
from .view_prefs_routes import router as view_prefs_router

router = APIRouter()
router.include_router(logs_router)
router.include_router(backup_router)
router.include_router(prompts_router)
router.include_router(provider_router)
router.include_router(users_router)
router.include_router(view_prefs_router)


# --- Top-level settings blob ---


@router.get("")
async def get_settings(current_user: dict = Depends(get_current_user)):
    config = get_config()
    return {
        "llm": {
            "extraction_timeout": config.llm.extraction_timeout,
            "max_concurrent_requests": config.llm.max_concurrent_requests,
            "max_retries": config.llm.max_retries,
            "retry_backoff_seconds": list(config.llm.retry_backoff_seconds),
            "provider_count": len([p for p in config.llm.providers if p.enabled]),
            "canonical_language": config.llm.canonical_language,
            "translation_target_language": config.llm.translation_target_language,
            "translation_allowed_languages": list(config.llm.translation_allowed_languages),
        },
        "ocr": {
            "engine": config.ocr.engine,
            "language": config.ocr.language,
            "confidence_threshold": config.ocr.confidence_threshold,
            "cloud_ocr_enabled": config.ocr.cloud_ocr_enabled,
            "remote_url": config.ocr.remote_url,
            "has_remote_api_key": bool(config.ocr.remote_api_key),
            "llm_vision_provider": config.ocr.llm_vision_provider,
            "llm_vision_model": config.ocr.llm_vision_model,
            "llm_vision_ollama_url": config.ocr.llm_vision_ollama_url,
            "has_google_vision_key": bool(config.ocr.google_vision_key),
            "provider_count": len([p for p in config.ocr.providers if p.enabled]),
        },
        "pipeline": {
            "watch_enabled": config.pipeline.watch_enabled,
            "poll_interval_seconds": config.pipeline.poll_interval_seconds,
            "retry_interval_seconds": config.pipeline.retry_interval_seconds,
            "max_retries": config.pipeline.max_retries,
            "default_flow": config.pipeline.default_flow,
        },
        "vision": {
            "extraction_timeout": config.vision.extraction_timeout,
            "max_concurrent_requests": config.vision.max_concurrent_requests,
            "max_retries": config.vision.max_retries,
            "retry_backoff_seconds": list(config.vision.retry_backoff_seconds),
            "provider_count": len([p for p in config.vision.providers if p.enabled]),
        },
        "auth": {
            "session_ttl_hours": config.auth.session_ttl_hours,
        },
        "oidc": {
            "enabled": config.oidc.enabled,
            "provider_url": config.oidc.provider_url,
            "client_id": config.oidc.client_id,
            "has_client_secret": bool(config.oidc.client_secret),
            "scopes": config.oidc.scopes,
            "auto_create_user": config.oidc.auto_create_user,
            "username_claim": config.oidc.username_claim,
            "display_name_claim": config.oidc.display_name_claim,
            "sync_roles": config.oidc.sync_roles,
            "roles_claim": config.oidc.roles_claim,
            "admin_roles": list(config.oidc.admin_roles),
            "editor_roles": list(config.oidc.editor_roles),
            "viewer_roles": list(config.oidc.viewer_roles),
            "default_role": config.oidc.default_role,
            "hide_password_login": config.oidc.hide_password_login,
        },
        "vault": {
            "root_path": config.vault.root_path,
            "inbox_path": config.vault.inbox_path,
        },
        "backup": _backup_state_block(config),
    }


class SettingsUpdate(BaseModel):
    # LLM
    extraction_timeout: int | None = None
    llm_max_concurrent_requests: int | None = None
    llm_max_retries: int | None = None
    llm_retry_backoff_seconds: list[int] | None = None
    canonical_language: str | None = None
    translation_target_language: str | None = None
    translation_allowed_languages: list[str] | None = None
    # OCR
    ocr_engine: str | None = None
    ocr_language: str | None = None
    ocr_confidence_threshold: float | None = None
    cloud_ocr_enabled: bool | None = None
    ocr_remote_url: str | None = None
    ocr_remote_api_key: str | None = None
    llm_vision_provider: str | None = None
    llm_vision_model: str | None = None
    llm_vision_ollama_url: str | None = None
    google_vision_key: str | None = None
    ocr_max_concurrent_vision_requests: int | None = None
    # Pipeline
    pipeline_watch_enabled: bool | None = None
    pipeline_poll_interval: int | None = None
    pipeline_retry_interval: int | None = None
    pipeline_max_retries: int | None = None
    pipeline_default_flow: str | None = None
    # Vision-LLM
    vision_extraction_timeout: int | None = None
    vision_max_concurrent_requests: int | None = None
    vision_max_retries: int | None = None
    vision_retry_backoff_seconds: list[int] | None = None
    # Auth
    session_ttl_hours: int | None = None
    # OIDC
    oidc_enabled: bool | None = None
    oidc_provider_url: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    oidc_scopes: str | None = None
    oidc_auto_create_user: bool | None = None
    oidc_username_claim: str | None = None
    oidc_display_name_claim: str | None = None
    oidc_sync_roles: bool | None = None
    oidc_roles_claim: str | None = None
    oidc_admin_roles: list[str] | None = None
    oidc_editor_roles: list[str] | None = None
    oidc_viewer_roles: list[str] | None = None
    oidc_default_role: str | None = None
    oidc_hide_password_login: bool | None = None
    # Backup scheduler
    backup_enabled: bool | None = None
    backup_include_database: bool | None = None
    backup_include_vault: bool | None = None
    backup_schedule: str | None = None
    backup_retention_mode: str | None = None
    backup_retention_value: int | None = None


# Languages the translation flows can target. Kept in sync with the
# frontend Language settings tab. Only members of this set may appear in
# ``llm.translation_allowed_languages``.
KNOWN_TRANSLATION_LANGUAGES = (
    "English",
    "Italian",
    "German",
    "French",
    "Spanish",
    "Russian",
)


# Mapping: API field -> (yaml_section, yaml_key, config_dotpath)
_SETTINGS_MAP = {
    "extraction_timeout": ("llm", "extraction_timeout", "llm.extraction_timeout"),
    "llm_max_concurrent_requests": (
        "llm",
        "max_concurrent_requests",
        "llm.max_concurrent_requests",
    ),
    "llm_max_retries": ("llm", "max_retries", "llm.max_retries"),
    "llm_retry_backoff_seconds": ("llm", "retry_backoff_seconds", "llm.retry_backoff_seconds"),
    "canonical_language": ("llm", "canonical_language", "llm.canonical_language"),
    "translation_target_language": (
        "llm",
        "translation_target_language",
        "llm.translation_target_language",
    ),
    "translation_allowed_languages": (
        "llm",
        "translation_allowed_languages",
        "llm.translation_allowed_languages",
    ),
    "ocr_engine": ("ocr", "engine", "ocr.engine"),
    "ocr_language": ("ocr", "language", "ocr.language"),
    "ocr_confidence_threshold": ("ocr", "confidence_threshold", "ocr.confidence_threshold"),
    "cloud_ocr_enabled": ("ocr", "cloud_ocr_enabled", "ocr.cloud_ocr_enabled"),
    "ocr_remote_url": ("ocr", "remote_url", "ocr.remote_url"),
    "ocr_remote_api_key": ("ocr", "remote_api_key", "ocr.remote_api_key"),
    "llm_vision_provider": ("ocr", "llm_vision_provider", "ocr.llm_vision_provider"),
    "llm_vision_model": ("ocr", "llm_vision_model", "ocr.llm_vision_model"),
    "llm_vision_ollama_url": ("ocr", "llm_vision_ollama_url", "ocr.llm_vision_ollama_url"),
    "google_vision_key": ("ocr", "google_vision_key", "ocr.google_vision_key"),
    "ocr_max_concurrent_vision_requests": (
        "ocr",
        "max_concurrent_vision_requests",
        "ocr.max_concurrent_vision_requests",
    ),
    "pipeline_watch_enabled": ("pipeline", "watch_enabled", "pipeline.watch_enabled"),
    "pipeline_poll_interval": (
        "pipeline",
        "poll_interval_seconds",
        "pipeline.poll_interval_seconds",
    ),
    "pipeline_retry_interval": (
        "pipeline",
        "retry_interval_seconds",
        "pipeline.retry_interval_seconds",
    ),
    "pipeline_max_retries": ("pipeline", "max_retries", "pipeline.max_retries"),
    "pipeline_default_flow": ("pipeline", "default_flow", "pipeline.default_flow"),
    "vision_extraction_timeout": ("vision", "extraction_timeout", "vision.extraction_timeout"),
    "vision_max_concurrent_requests": (
        "vision",
        "max_concurrent_requests",
        "vision.max_concurrent_requests",
    ),
    "vision_max_retries": ("vision", "max_retries", "vision.max_retries"),
    "vision_retry_backoff_seconds": (
        "vision",
        "retry_backoff_seconds",
        "vision.retry_backoff_seconds",
    ),
    "session_ttl_hours": ("auth", "session_ttl_hours", "auth.session_ttl_hours"),
    "oidc_enabled": ("oidc", "enabled", "oidc.enabled"),
    "oidc_provider_url": ("oidc", "provider_url", "oidc.provider_url"),
    "oidc_client_id": ("oidc", "client_id", "oidc.client_id"),
    "oidc_client_secret": ("oidc", "client_secret", "oidc.client_secret"),
    "oidc_scopes": ("oidc", "scopes", "oidc.scopes"),
    "oidc_auto_create_user": ("oidc", "auto_create_user", "oidc.auto_create_user"),
    "oidc_username_claim": ("oidc", "username_claim", "oidc.username_claim"),
    "oidc_display_name_claim": ("oidc", "display_name_claim", "oidc.display_name_claim"),
    "oidc_sync_roles": ("oidc", "sync_roles", "oidc.sync_roles"),
    "oidc_roles_claim": ("oidc", "roles_claim", "oidc.roles_claim"),
    "oidc_admin_roles": ("oidc", "admin_roles", "oidc.admin_roles"),
    "oidc_editor_roles": ("oidc", "editor_roles", "oidc.editor_roles"),
    "oidc_viewer_roles": ("oidc", "viewer_roles", "oidc.viewer_roles"),
    "oidc_default_role": ("oidc", "default_role", "oidc.default_role"),
    "oidc_hide_password_login": (
        "oidc",
        "hide_password_login",
        "oidc.hide_password_login",
    ),
    "backup_enabled": ("backup", "enabled", "backup.enabled"),
    "backup_include_database": ("backup", "include_database", "backup.include_database"),
    "backup_include_vault": ("backup", "include_vault", "backup.include_vault"),
    "backup_schedule": ("backup", "schedule", "backup.schedule"),
    "backup_retention_mode": ("backup", "retention_mode", "backup.retention_mode"),
    "backup_retention_value": ("backup", "retention_value", "backup.retention_value"),
}


@router.patch("")
async def update_settings(
    body: SettingsUpdate,
    request: Request = None,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Update settings: persists to YAML and updates in-memory config."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)

    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No settings to update")

    if "pipeline_default_flow" in changes and changes["pipeline_default_flow"] not in (
        "ocr_llm",
        "vision_llm",
    ):
        raise HTTPException(
            status_code=400, detail="default_flow must be 'ocr_llm' or 'vision_llm'"
        )

    if "backup_schedule" in changes and changes["backup_schedule"] not in (
        "hourly",
        "daily",
        "weekly",
    ):
        raise HTTPException(
            status_code=400, detail="backup_schedule must be hourly, daily, or weekly"
        )
    if "backup_retention_mode" in changes and changes["backup_retention_mode"] not in (
        "count",
        "days",
    ):
        raise HTTPException(
            status_code=400, detail="backup_retention_mode must be 'count' or 'days'"
        )

    config = get_config()

    # Resolve final translation language allow-list + default for cross-field validation.
    if "translation_allowed_languages" in changes or "translation_target_language" in changes:
        new_allowed = changes.get(
            "translation_allowed_languages",
            list(config.llm.translation_allowed_languages),
        )
        if not isinstance(new_allowed, list) or not new_allowed:
            raise HTTPException(
                status_code=400,
                detail="translation_allowed_languages must be a non-empty list",
            )
        unknown = [lang for lang in new_allowed if lang not in KNOWN_TRANSLATION_LANGUAGES]
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown translation language(s): {', '.join(unknown)}",
            )
        # de-dupe while preserving order
        seen: set[str] = set()
        deduped: list[str] = []
        for lang in new_allowed:
            if lang not in seen:
                seen.add(lang)
                deduped.append(lang)
        changes["translation_allowed_languages"] = deduped
        new_allowed = deduped

        new_default = changes.get(
            "translation_target_language",
            config.llm.translation_target_language,
        )
        if new_default not in new_allowed:
            raise HTTPException(
                status_code=400,
                detail="translation_target_language must be in translation_allowed_languages",
            )

    for key, value in changes.items():
        if key not in _SETTINGS_MAP:
            continue
        yaml_section, yaml_key, config_dotpath = _SETTINGS_MAP[key]

        # yaml_key may contain dots to describe nested sub-sections
        # (e.g. "db.enabled" -> data[section]["db"]["enabled"]).
        if yaml_section not in data or not isinstance(data[yaml_section], dict):
            data[yaml_section] = {}
        yaml_parts = yaml_key.split(".")
        node = data[yaml_section]
        for part in yaml_parts[:-1]:
            if part not in node or not isinstance(node[part], dict):
                node[part] = {}
            node = node[part]
        node[yaml_parts[-1]] = value

        parts = config_dotpath.split(".")
        obj = config
        for part in parts[:-1]:
            obj = getattr(obj, part)
        setattr(obj, parts[-1], value)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    # Runtime pipeline start/stop when pipeline_watch_enabled changes
    if "pipeline_watch_enabled" in changes and request is not None:
        import asyncio

        from asclepius.pipeline.watcher import start_watcher

        app_state = request.app.state
        if changes["pipeline_watch_enabled"]:
            task = getattr(app_state, "pipeline_task", None)
            if task is None or task.done():
                app_state.pipeline_task = asyncio.create_task(start_watcher(config, app_state))
        else:
            task = getattr(app_state, "pipeline_task", None)
            if task is not None and not task.done():
                task.cancel()
                app_state.pipeline_task = None
                app_state.pipeline_auto_stopped = False
                app_state.pipeline_auto_stop_reason = ""

    # Runtime backup scheduler restart when any backup_* field changes.
    if request is not None and any(k.startswith("backup_") for k in changes):
        import asyncio

        from asclepius.backup.scheduler import start_backup_scheduler

        app_state = request.app.state

        task = getattr(app_state, "backup_task", None)
        if task is not None and not task.done():
            task.cancel()
            app_state.backup_task = None

        if config.backup.enabled:
            app_state.backup_task = asyncio.create_task(start_backup_scheduler(config, app_state))

    ip = get_client_ip(request) if request else None
    await audit_log(
        db,
        current_user["id"],
        "settings.update",
        "settings",
        details={"changed_keys": list(changes.keys())},
        ip_address=ip,
    )

    return {"status": "saved", "changes": changes}
