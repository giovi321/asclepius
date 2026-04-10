"""Settings and user management API routes."""

import os
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user, hash_password
from asclepius.config import get_config
from asclepius.db.connection import get_db

router = APIRouter()


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
        },
        "ocr": {
            "engine": config.ocr.engine,
            "language": config.ocr.language,
            "confidence_threshold": config.ocr.confidence_threshold,
            "cloud_ocr_enabled": config.ocr.cloud_ocr_enabled,
        },
        "pipeline": {
            "watch_enabled": config.pipeline.watch_enabled,
            "poll_interval_seconds": config.pipeline.poll_interval_seconds,
        },
        "vault": {
            "root_path": config.vault.root_path,
            "inbox_path": config.vault.inbox_path,
        },
    }


class SettingsUpdate(BaseModel):
    llm_provider: str | None = None
    ollama_base_url: str | None = None
    ollama_model: str | None = None
    claude_api_key: str | None = None
    claude_model: str | None = None
    ocr_language: str | None = None
    ocr_confidence_threshold: float | None = None
    cloud_ocr_enabled: bool | None = None


@router.patch("")
async def update_settings(
    body: SettingsUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update settings and persist to settings.yaml. Requires restart for most changes."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)

    # Load existing YAML
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    # Apply updates
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No settings to update")

    mapping = {
        "llm_provider": ("llm", "provider"),
        "ollama_base_url": ("llm", "ollama_base_url"),
        "ollama_model": ("llm", "ollama_model"),
        "claude_api_key": ("llm", "claude_api_key"),
        "claude_model": ("llm", "claude_model"),
        "ocr_language": ("ocr", "language"),
        "ocr_confidence_threshold": ("ocr", "confidence_threshold"),
        "cloud_ocr_enabled": ("ocr", "cloud_ocr_enabled"),
    }

    for key, value in changes.items():
        if key in mapping:
            section, field = mapping[key]
            if section not in data:
                data[section] = {}
            data[section][field] = value

    # Write back
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    # Also update in-memory config for immediate effect where possible
    config = get_config()
    if body.llm_provider:
        config.llm.provider = body.llm_provider
    if body.ollama_base_url:
        config.llm.ollama_base_url = body.ollama_base_url
    if body.ollama_model:
        config.llm.ollama_model = body.ollama_model
    if body.claude_api_key:
        config.llm.claude_api_key = body.claude_api_key
    if body.claude_model:
        config.llm.claude_model = body.claude_model
    if body.ocr_language:
        config.ocr.language = body.ocr_language
    if body.ocr_confidence_threshold is not None:
        config.ocr.confidence_threshold = body.ocr_confidence_threshold
    if body.cloud_ocr_enabled is not None:
        config.ocr.cloud_ocr_enabled = body.cloud_ocr_enabled

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
