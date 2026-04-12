"""Settings and user management API routes."""

import os
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user, hash_password
from asclepius.config import get_config
from asclepius.db.connection import get_db

router = APIRouter()


# --- Logs ---

@router.get("/logs")
async def get_logs(
    level: str | None = Query(default=None),
    module: str | None = Query(default=None),
    limit: int = Query(default=200),
    current_user: dict = Depends(get_current_user),
):
    """Get recent application logs from the in-memory buffer."""
    from asclepius.main import LOG_BUFFER

    logs = list(LOG_BUFFER)

    # Filter by level
    if level:
        levels = level.upper().split(",")
        logs = [l for l in logs if l["level"] in levels]

    # Filter by module
    if module:
        logs = [l for l in logs if module in l["module"]]

    # Return in chronological order (oldest first), limited to most recent entries
    logs = logs[-limit:]

    return {"logs": logs, "total": len(LOG_BUFFER)}


# --- Backup ---

@router.get("/backup")
async def download_backup(
    current_user: dict = Depends(get_current_user),
):
    """Download a SQLite backup of the database."""
    import shutil
    import tempfile
    import sqlite3
    from datetime import datetime
    from fastapi.responses import FileResponse

    config = get_config()
    db_path = config.database.path

    # Create a safe backup using SQLite's backup API
    backup_name = f"asclepius_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sqlite"
    backup_path = os.path.join(tempfile.gettempdir(), backup_name)

    try:
        source = sqlite3.connect(db_path)
        dest = sqlite3.connect(backup_path)
        source.backup(dest)
        source.close()
        dest.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

    return FileResponse(
        path=backup_path,
        filename=backup_name,
        media_type="application/x-sqlite3",
        background=None,
    )


# --- Prompts ---

@router.get("/prompts")
async def list_prompts(
    current_user: dict = Depends(get_current_user),
):
    config = get_config()
    from asclepius.llm.prompt_manager import get_all_prompts
    return await get_all_prompts(config.database.path)


class PromptUpdate(BaseModel):
    text: str


@router.put("/prompts/{key}")
async def update_prompt(
    key: str,
    body: PromptUpdate,
    current_user: dict = Depends(get_current_user),
):
    config = get_config()
    from asclepius.llm.prompt_manager import set_prompt, PROMPT_REGISTRY
    if key not in PROMPT_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown prompt key: {key}")
    await set_prompt(config.database.path, key, body.text)
    return {"ok": True, "key": key}


@router.delete("/prompts/{key}")
async def reset_prompt(
    key: str,
    current_user: dict = Depends(get_current_user),
):
    config = get_config()
    from asclepius.llm.prompt_manager import reset_prompt as _reset, PROMPT_REGISTRY
    if key not in PROMPT_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown prompt key: {key}")
    await _reset(config.database.path, key)
    return {"ok": True, "key": key}


# --- Settings ---

@router.get("")
async def get_settings(current_user: dict = Depends(get_current_user)):
    config = get_config()
    return {
        "llm": {
            "provider": config.llm.provider,
            "ollama_base_url": config.llm.ollama_base_url,
            "ollama_model": config.llm.ollama_model,
            "claude_model": config.llm.claude_model,
            "has_claude_key": bool(config.llm.claude_api_key),
            "extraction_timeout": config.llm.extraction_timeout,
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
        },
        "pipeline": {
            "watch_enabled": config.pipeline.watch_enabled,
            "poll_interval_seconds": config.pipeline.poll_interval_seconds,
            "retry_interval_seconds": config.pipeline.retry_interval_seconds,
            "max_retries": config.pipeline.max_retries,
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
        },
        "vault": {
            "root_path": config.vault.root_path,
            "inbox_path": config.vault.inbox_path,
        },
    }


class SettingsUpdate(BaseModel):
    # LLM
    llm_provider: str | None = None
    ollama_base_url: str | None = None
    ollama_model: str | None = None
    claude_api_key: str | None = None
    claude_model: str | None = None
    extraction_timeout: int | None = None
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
    # Pipeline
    pipeline_watch_enabled: bool | None = None
    pipeline_poll_interval: int | None = None
    pipeline_retry_interval: int | None = None
    pipeline_max_retries: int | None = None
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


# Mapping: API field -> (yaml_section, yaml_key, config_dotpath)
_SETTINGS_MAP = {
    "llm_provider": ("llm", "provider", "llm.provider"),
    "ollama_base_url": ("llm", "ollama_base_url", "llm.ollama_base_url"),
    "ollama_model": ("llm", "ollama_model", "llm.ollama_model"),
    "claude_api_key": ("llm", "claude_api_key", "llm.claude_api_key"),
    "claude_model": ("llm", "claude_model", "llm.claude_model"),
    "extraction_timeout": ("llm", "extraction_timeout", "llm.extraction_timeout"),
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
    "pipeline_watch_enabled": ("pipeline", "watch_enabled", "pipeline.watch_enabled"),
    "pipeline_poll_interval": ("pipeline", "poll_interval_seconds", "pipeline.poll_interval_seconds"),
    "pipeline_retry_interval": ("pipeline", "retry_interval_seconds", "pipeline.retry_interval_seconds"),
    "pipeline_max_retries": ("pipeline", "max_retries", "pipeline.max_retries"),
    "session_ttl_hours": ("auth", "session_ttl_hours", "auth.session_ttl_hours"),
    "oidc_enabled": ("oidc", "enabled", "oidc.enabled"),
    "oidc_provider_url": ("oidc", "provider_url", "oidc.provider_url"),
    "oidc_client_id": ("oidc", "client_id", "oidc.client_id"),
    "oidc_client_secret": ("oidc", "client_secret", "oidc.client_secret"),
    "oidc_scopes": ("oidc", "scopes", "oidc.scopes"),
    "oidc_auto_create_user": ("oidc", "auto_create_user", "oidc.auto_create_user"),
    "oidc_username_claim": ("oidc", "username_claim", "oidc.username_claim"),
    "oidc_display_name_claim": ("oidc", "display_name_claim", "oidc.display_name_claim"),
}


@router.patch("")
async def update_settings(
    body: SettingsUpdate,
    current_user: dict = Depends(get_current_user),
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

    config = get_config()

    for key, value in changes.items():
        if key not in _SETTINGS_MAP:
            continue
        yaml_section, yaml_key, config_dotpath = _SETTINGS_MAP[key]

        # Write to YAML
        if yaml_section not in data:
            data[yaml_section] = {}
        data[yaml_section][yaml_key] = value

        # Update in-memory config
        parts = config_dotpath.split(".")
        obj = config
        for part in parts[:-1]:
            obj = getattr(obj, part)
        setattr(obj, parts[-1], value)

    # Persist
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved", "changes": changes}


# --- User management ---

class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None


class UserUpdate(BaseModel):
    display_name: str | None = None
    password: str | None = None


class PatientAccessGrant(BaseModel):
    patient_id: int
    role: str = "viewer"


@router.get("/users")
async def list_users(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "SELECT id, username, display_name, created_at FROM users ORDER BY username"
    )
    return [dict(r) for r in await cursor.fetchall()]


@router.post("/users", status_code=201)
async def create_user(
    body: UserCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    try:
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
            (body.username, hash_password(body.password), body.display_name or body.username),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "username": body.username}
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="Username already exists")


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    updates = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.password is not None:
        updates["password_hash"] = hash_password(body.password)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [user_id]
    await db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
    await db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    await db.execute("DELETE FROM user_patient_access WHERE user_id = ?", (user_id,))
    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.commit()
    return {"ok": True}


@router.get("/users/{user_id}/access")
async def get_user_access(
    user_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        """SELECT p.id, p.slug, p.display_name, upa.role
           FROM patients p
           JOIN user_patient_access upa ON upa.patient_id = p.id
           WHERE upa.user_id = ?""",
        (user_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]


@router.post("/users/{user_id}/access")
async def grant_access(
    user_id: int,
    body: PatientAccessGrant,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    try:
        await db.execute(
            "INSERT OR REPLACE INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, ?)",
            (user_id, body.patient_id, body.role),
        )
        await db.commit()
        return {"ok": True}
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=400, detail="Invalid user or patient ID")


@router.delete("/users/{user_id}/access/{patient_id}")
async def revoke_access(
    user_id: int,
    patient_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute(
        "DELETE FROM user_patient_access WHERE user_id = ? AND patient_id = ?",
        (user_id, patient_id),
    )
    await db.commit()
    return {"ok": True}
