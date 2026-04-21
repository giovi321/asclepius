"""Settings and user management API routes."""

import os
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user, hash_password, require_role
from asclepius.audit.service import audit_log, get_client_ip
from asclepius.config import get_config, LlmProviderEntry, OcrProviderEntry, VisionLlmProviderEntry
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
        logs = [entry for entry in logs if entry["level"] in levels]

    # Filter by module
    if module:
        logs = [entry for entry in logs if module in entry["module"]]

    # Return in chronological order (oldest first), limited to most recent entries
    logs = logs[-limit:]

    return {"logs": logs, "total": len(LOG_BUFFER)}


# --- Backup ---

@router.get("/audit-log")
async def get_audit_log(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
    user_id: int | None = Query(default=None),
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get audit log entries (admin only)."""
    conditions = []
    params: list = []
    if action:
        conditions.append("a.action LIKE ?")
        params.append(f"%{action}%")
    if user_id is not None:
        conditions.append("a.user_id = ?")
        params.append(user_id)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    cursor = await db.execute(
        f"""SELECT a.*, u.username
            FROM audit_log a
            LEFT JOIN users u ON a.user_id = u.id
            {where}
            ORDER BY a.created_at DESC
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    )
    items = [dict(r) for r in await cursor.fetchall()]

    count_cursor = await db.execute(
        f"SELECT COUNT(*) FROM audit_log a {where}", params
    )
    total = (await count_cursor.fetchone())[0]

    return {"items": items, "total": total}


@router.get("/backup")
async def download_backup(
    current_user: dict = Depends(get_current_user),
):
    """Download a SQLite backup of the database."""
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
            "extraction_timeout": config.llm.extraction_timeout,
            "max_concurrent_requests": config.llm.max_concurrent_requests,
            "max_retries": config.llm.max_retries,
            "retry_backoff_seconds": list(config.llm.retry_backoff_seconds),
            "provider_count": len([p for p in config.llm.providers if p.enabled]),
            "canonical_language": config.llm.canonical_language,
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
        },
        "vault": {
            "root_path": config.vault.root_path,
            "inbox_path": config.vault.inbox_path,
        },
    }


class SettingsUpdate(BaseModel):
    # LLM
    extraction_timeout: int | None = None
    llm_max_concurrent_requests: int | None = None
    llm_max_retries: int | None = None
    llm_retry_backoff_seconds: list[int] | None = None
    canonical_language: str | None = None
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
    pipeline_default_flow: str | None = None  # "ocr_llm" | "vision_llm"
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


# Mapping: API field -> (yaml_section, yaml_key, config_dotpath)
_SETTINGS_MAP = {
    "extraction_timeout": ("llm", "extraction_timeout", "llm.extraction_timeout"),
    "llm_max_concurrent_requests": ("llm", "max_concurrent_requests", "llm.max_concurrent_requests"),
    "llm_max_retries": ("llm", "max_retries", "llm.max_retries"),
    "llm_retry_backoff_seconds": ("llm", "retry_backoff_seconds", "llm.retry_backoff_seconds"),
    "canonical_language": ("llm", "canonical_language", "llm.canonical_language"),
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
    "pipeline_default_flow": ("pipeline", "default_flow", "pipeline.default_flow"),
    "vision_extraction_timeout": ("vision", "extraction_timeout", "vision.extraction_timeout"),
    "vision_max_concurrent_requests": ("vision", "max_concurrent_requests", "vision.max_concurrent_requests"),
    "vision_max_retries": ("vision", "max_retries", "vision.max_retries"),
    "vision_retry_backoff_seconds": ("vision", "retry_backoff_seconds", "vision.retry_backoff_seconds"),
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

    if "pipeline_default_flow" in changes and changes["pipeline_default_flow"] not in ("ocr_llm", "vision_llm"):
        raise HTTPException(status_code=400, detail="default_flow must be 'ocr_llm' or 'vision_llm'")

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

    # Runtime pipeline start/stop when pipeline_watch_enabled changes
    if "pipeline_watch_enabled" in changes and request is not None:
        import asyncio
        from asclepius.pipeline.watcher import start_watcher
        app_state = request.app.state
        if changes["pipeline_watch_enabled"]:
            # Start pipeline if not already running
            task = getattr(app_state, "pipeline_task", None)
            if task is None or task.done():
                app_state.pipeline_task = asyncio.create_task(start_watcher(config, app_state))
        else:
            # Stop pipeline if running
            task = getattr(app_state, "pipeline_task", None)
            if task is not None and not task.done():
                task.cancel()
                app_state.pipeline_task = None
                app_state.pipeline_auto_stopped = False
                app_state.pipeline_auto_stop_reason = ""

    # Audit log
    ip = get_client_ip(request) if request else None
    await audit_log(db, current_user["id"], "settings.update", "settings", details={"changed_keys": list(changes.keys())}, ip_address=ip)

    return {"status": "saved", "changes": changes}


# --- LLM Providers ---

@router.get("/llm-providers")
async def get_llm_providers(current_user: dict = Depends(get_current_user)):
    """Get the ordered list of LLM providers."""
    config = get_config()
    providers = []
    for p in config.llm.providers:
        entry = p.model_dump()
        # Mask API keys
        if entry.get("api_key"):
            entry["has_api_key"] = True
            entry["api_key"] = ""
        else:
            entry["has_api_key"] = False
        providers.append(entry)
    return providers


@router.put("/llm-providers")
async def update_llm_providers(
    providers: list[dict],
    current_user: dict = Depends(require_role("admin")),
):
    """Replace the full list of LLM providers. API keys sent as empty string are preserved."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    config = get_config()

    # Build a lookup of existing providers by id (to preserve API keys)
    existing_by_id = {p.id: p for p in config.llm.providers}

    new_providers: list[LlmProviderEntry] = []
    for i, raw in enumerate(providers):
        # Preserve existing API key if not provided
        pid = raw.get("id", f"llm-{i}")
        if not raw.get("api_key") and pid in existing_by_id:
            raw["api_key"] = existing_by_id[pid].api_key
        raw["id"] = pid
        new_providers.append(LlmProviderEntry(**raw))

    # Update in-memory config
    config.llm.providers = new_providers

    # Persist to YAML
    data["llm"] = data.get("llm", {})
    data["llm"]["providers"] = [p.model_dump() for p in new_providers]

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved", "count": len(new_providers)}


# --- OCR Providers ---

@router.get("/ocr-providers")
async def get_ocr_providers(current_user: dict = Depends(get_current_user)):
    """Get the ordered list of OCR providers."""
    config = get_config()
    providers = []
    for p in config.ocr.providers:
        entry = p.model_dump()
        # Mask API keys
        for key_field in ("remote_api_key", "llm_api_key", "google_vision_key"):
            if entry.get(key_field):
                entry[f"has_{key_field}"] = True
                entry[key_field] = ""
            else:
                entry[f"has_{key_field}"] = False
        providers.append(entry)
    return providers


@router.put("/ocr-providers")
async def update_ocr_providers(
    providers: list[dict],
    current_user: dict = Depends(require_role("admin")),
):
    """Replace the full list of OCR providers."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    config = get_config()
    existing_by_id = {p.id: p for p in config.ocr.providers}

    new_providers: list[OcrProviderEntry] = []
    for i, raw in enumerate(providers):
        pid = raw.get("id", f"ocr-{i}")
        # Preserve existing keys if not provided
        if pid in existing_by_id:
            existing = existing_by_id[pid]
            for key_field in ("remote_api_key", "llm_api_key", "google_vision_key"):
                if not raw.get(key_field):
                    raw[key_field] = getattr(existing, key_field, "")
        raw["id"] = pid
        new_providers.append(OcrProviderEntry(**raw))

    config.ocr.providers = new_providers

    data["ocr"] = data.get("ocr", {})
    data["ocr"]["providers"] = [p.model_dump() for p in new_providers]

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved", "count": len(new_providers)}


# --- Vision-LLM Providers ---

@router.get("/vision-providers")
async def get_vision_providers(current_user: dict = Depends(get_current_user)):
    """Get the ordered list of Vision-LLM providers."""
    config = get_config()
    providers = []
    for p in config.vision.providers:
        entry = p.model_dump()
        if entry.get("api_key"):
            entry["has_api_key"] = True
            entry["api_key"] = ""
        else:
            entry["has_api_key"] = False
        providers.append(entry)
    return providers


@router.put("/vision-providers")
async def update_vision_providers(
    providers: list[dict],
    current_user: dict = Depends(require_role("admin")),
):
    """Replace the full list of Vision-LLM providers. API keys sent as empty string are preserved."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    config = get_config()
    existing_by_id = {p.id: p for p in config.vision.providers}

    new_providers: list[VisionLlmProviderEntry] = []
    for i, raw in enumerate(providers):
        pid = raw.get("id", f"vision-{i}")
        if not raw.get("api_key") and pid in existing_by_id:
            raw["api_key"] = existing_by_id[pid].api_key
        raw["id"] = pid
        new_providers.append(VisionLlmProviderEntry(**raw))

    config.vision.providers = new_providers

    data["vision"] = data.get("vision", {})
    data["vision"]["providers"] = [p.model_dump() for p in new_providers]

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved", "count": len(new_providers)}


# --- Provider testing ---

class TestProviderRequest(BaseModel):
    provider_id: str


@router.post("/test-llm-provider")
async def test_llm_provider(
    body: TestProviderRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Test connectivity to an LLM provider by sending a tiny prompt."""
    config = get_config()
    entry = next((p for p in config.llm.providers if p.id == body.provider_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Provider not found")

    try:
        from asclepius.pipeline.processor import _build_llm_provider
        provider = _build_llm_provider(entry)
        response = await provider._generate("Reply with exactly: OK", force_json=False, timeout_override=15)
        return {"ok": True, "response": response.strip()[:200]}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)}"}


@router.post("/test-ocr-provider")
async def test_ocr_provider(
    body: TestProviderRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Test connectivity to an OCR provider."""
    config = get_config()
    entry = next((p for p in config.ocr.providers if p.id == body.provider_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Provider not found")

    try:
        if entry.type == "tesseract":
            import subprocess
            result = subprocess.run(
                ["tesseract", "--version"],
                capture_output=True, text=True, timeout=10,
            )
            version = result.stdout.split("\n")[0] if result.stdout else result.stderr.split("\n")[0]
            return {"ok": True, "detail": f"Tesseract {version}"}

        elif entry.type == "tesseract_remote":
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(entry.remote_url.rstrip("/") + "/")
                return {"ok": True, "detail": f"Remote OCR reachable (HTTP {resp.status_code})"}

        elif entry.type == "llm_vision":
            # Build and test the underlying LLM provider
            from asclepius.pipeline.processor import _build_llm_provider
            from asclepius.config import LlmProviderEntry
            llm_entry = LlmProviderEntry(
                id="test-vision",
                type=entry.llm_provider,
                name="test",
                base_url=entry.llm_base_url,
                model=entry.llm_model,
                api_key=entry.llm_api_key,
                timeout=15,
            )
            provider = _build_llm_provider(llm_entry)
            response = await provider._generate("Reply with exactly: OK", force_json=False, timeout_override=15)
            return {"ok": True, "detail": f"LLM Vision OK: {response.strip()[:100]}"}

        elif entry.type == "google_vision":
            if not entry.google_vision_key:
                return {"ok": False, "error": "No Google Vision API key configured"}
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"https://vision.googleapis.com/v1/images:annotate?key={entry.google_vision_key}",
                    json={"requests": []},
                )
                if resp.status_code in (200, 400):
                    # 400 with empty requests is expected — means the API key works
                    return {"ok": True, "detail": "Google Vision API key is valid"}
                return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}

        else:
            return {"ok": False, "error": f"Unknown provider type: {entry.type}"}

    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)}"}


@router.post("/test-vision-provider")
async def test_vision_provider(
    body: TestProviderRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Test connectivity to a Vision-LLM provider with a trivial prompt."""
    config = get_config()
    entry = next((p for p in config.vision.providers if p.id == body.provider_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Provider not found")

    try:
        # Build a tiny white JPEG so every backend round-trips end-to-end.
        import io as _io
        import base64 as _b64
        from PIL import Image as _Image
        img = _Image.new("RGB", (8, 8), "white")
        buf = _io.BytesIO()
        img.save(buf, format="JPEG")
        b64 = _b64.b64encode(buf.getvalue()).decode("utf-8")

        from asclepius.pipeline.vision_extractor import _vision_call
        response = await _vision_call(b64, "Reply with exactly: OK", entry)
        return {"ok": True, "detail": response.strip()[:200]}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)}"}


# --- User management ---

class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    role: str = "editor"  # 'admin', 'editor', 'viewer'


class UserUpdate(BaseModel):
    display_name: str | None = None
    password: str | None = None
    role: str | None = None  # 'admin', 'editor', 'viewer'


class PatientAccessGrant(BaseModel):
    patient_id: int
    role: str = "viewer"


@router.get("/users")
async def list_users(
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "SELECT id, username, display_name, role, created_at FROM users ORDER BY username"
    )
    return [dict(r) for r in await cursor.fetchall()]


@router.post("/users", status_code=201)
async def create_user(
    body: UserCreate,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    try:
        role = getattr(body, "role", "editor") or "editor"
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
            (body.username, hash_password(body.password), body.display_name or body.username, role),
        )
        await db.commit()
        await audit_log(db, current_user["id"], "user.create", "user", cursor.lastrowid,
                        {"username": body.username, "role": role}, get_client_ip(request))
        return {"id": cursor.lastrowid, "username": body.username, "role": role}
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="Username already exists")


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    updates = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.password is not None:
        updates["password_hash"] = hash_password(body.password)
    if body.role is not None:
        if body.role not in ("admin", "editor", "viewer"):
            raise HTTPException(status_code=400, detail="Role must be admin, editor, or viewer")
        updates["role"] = body.role

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [user_id]
    await db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
    await db.commit()
    await audit_log(db, current_user["id"], "user.update", "user", user_id,
                    {"changed": list(updates.keys())}, get_client_ip(request))
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    # Get username for audit log
    cursor = await db.execute("SELECT username FROM users WHERE id = ?", (user_id,))
    user_row = await cursor.fetchone()
    username = user_row[0] if user_row else "unknown"

    await db.execute("DELETE FROM user_patient_access WHERE user_id = ?", (user_id,))
    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.commit()
    await audit_log(db, current_user["id"], "user.delete", "user", user_id,
                    {"username": username}, get_client_ip(request))
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
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    try:
        await db.execute(
            "INSERT OR REPLACE INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, ?)",
            (user_id, body.patient_id, body.role),
        )
        await db.commit()
        await audit_log(db, current_user["id"], "access.grant", "user", user_id,
                        {"patient_id": body.patient_id, "role": body.role}, get_client_ip(request))
        return {"ok": True}
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=400, detail="Invalid user or patient ID")


@router.delete("/users/{user_id}/access/{patient_id}")
async def revoke_access(
    user_id: int,
    patient_id: int,
    request: Request,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute(
        "DELETE FROM user_patient_access WHERE user_id = ? AND patient_id = ?",
        (user_id, patient_id),
    )
    await db.commit()
    await audit_log(db, current_user["id"], "access.revoke", "user", user_id,
                    {"patient_id": patient_id}, get_client_ip(request))
    return {"ok": True}
