"""Pipeline status and control API routes."""

import asyncio

from fastapi import APIRouter, Depends, Request

from asclepius.auth.session import get_current_user, require_role
from asclepius.config import get_config

router = APIRouter()


@router.get("/status")
async def get_pipeline_status(request: Request, current_user: dict = Depends(get_current_user)):
    from asclepius.pipeline.processor import pipeline_status as status
    from asclepius.llm.gate import snapshot as gate_snapshot

    app_state = request.app.state
    task = getattr(app_state, "pipeline_task", None)
    watcher_active = task is not None and not task.done()

    return {
        **status,
        "watcher_active": watcher_active,
        "auto_stopped": getattr(app_state, "pipeline_auto_stopped", False),
        "auto_stop_reason": getattr(app_state, "pipeline_auto_stop_reason", ""),
        "llm_queues": gate_snapshot(),
    }


@router.post("/start")
async def start_pipeline(request: Request, current_user: dict = Depends(require_role("admin"))):
    """Start the pipeline watcher at runtime."""
    app_state = request.app.state
    task = getattr(app_state, "pipeline_task", None)

    if task is not None and not task.done():
        return {"status": "already_running"}

    config = get_config()
    from asclepius.pipeline.watcher import start_watcher
    app_state.pipeline_task = asyncio.create_task(start_watcher(config, app_state))
    return {"status": "started"}


@router.post("/stop")
async def stop_pipeline(request: Request, current_user: dict = Depends(require_role("admin"))):
    """Stop the pipeline watcher at runtime."""
    app_state = request.app.state
    task = getattr(app_state, "pipeline_task", None)

    if task is None or task.done():
        return {"status": "already_stopped"}

    task.cancel()
    app_state.pipeline_task = None
    app_state.pipeline_auto_stopped = False
    app_state.pipeline_auto_stop_reason = ""
    return {"status": "stopped"}
