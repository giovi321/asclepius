"""Settings API routes."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config

router = APIRouter()


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
    # In MVP, settings changes require a restart.
    # For now, just acknowledge the request.
    return {"status": "Settings update requires application restart", "received": body.model_dump(exclude_none=True)}
