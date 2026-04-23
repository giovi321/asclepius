"""Prompt management endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from asclepius.auth.session import get_current_user
from asclepius.config import get_config

router = APIRouter()


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
    from asclepius.llm.prompt_manager import PROMPT_REGISTRY, set_prompt
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
    from asclepius.llm.prompt_manager import PROMPT_REGISTRY
    from asclepius.llm.prompt_manager import reset_prompt as _reset
    if key not in PROMPT_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown prompt key: {key}")
    await _reset(config.database.path, key)
    return {"ok": True, "key": key}
