"""Pipeline status and control API routes."""

import asyncio
import logging

from fastapi import APIRouter, Depends, Request

from asclepius.auth.session import get_current_user, require_role
from asclepius.config import get_config

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/status")
async def get_pipeline_status(request: Request, current_user: dict = Depends(get_current_user)):
    from asclepius.pipeline.processor import pipeline_status as status
    from asclepius.llm.gate import snapshot as gate_snapshot
    from asclepius.config import get_config

    app_state = request.app.state
    task = getattr(app_state, "pipeline_task", None)
    watcher_active = task is not None and not task.done()

    # Enrich the gate snapshot with user-chosen display names, so the top-bar
    # chip reads "Chandra" instead of "fredrezones55/chandra-ocr-2". Matching
    # on (credential_id, raw_model) against the three provider lists.
    queues = gate_snapshot()
    config = get_config()
    for q in queues:
        cred_id = q.get("credential_id", "")
        kind = q.get("kind", "llm")
        labels = []
        for raw_model in q.get("models", []):
            labels.append(_resolve_model_display_name(config, kind, cred_id, raw_model) or raw_model)
        q["display_names"] = labels
        q["display_name"] = labels[0] if labels else q.get("model", "")

    return {
        **status,
        "watcher_active": watcher_active,
        "auto_stopped": getattr(app_state, "pipeline_auto_stopped", False),
        "auto_stop_reason": getattr(app_state, "pipeline_auto_stop_reason", ""),
        "llm_queues": queues,
    }


def _resolve_model_display_name(config, kind: str, credential_id: str, raw_model: str) -> str:
    """Return the user-chosen ``name`` for a (credential, model) tuple in the
    given kind's provider list, or ``""`` if no entry matches.

    Falls back through progressively looser matches so edge cases — legacy
    entries without a ``credential_id``, synthetic ``legacy-vision-*``
    credential ids registered by the OCR wrapper, or unusual
    configurations — still land on the user's friendly name whenever a
    single entry unambiguously owns the raw model string.
    """
    if not raw_model:
        return ""
    if kind == "llm":
        candidates = config.llm.providers
        key = "model"
    elif kind == "vision":
        candidates = config.vision.providers
        key = "model"
    elif kind == "ocr":
        # LLM-vision OCR entries register with their llm_model as the "model"
        # string in the gate; the user-chosen display name is on entry.name.
        candidates = config.ocr.providers
        key = "llm_model"
    else:
        return ""

    # 1. Strict match: same credential + same raw model.
    for p in candidates:
        if p.credential_id == credential_id and getattr(p, key, "") == raw_model:
            if p.name:
                return p.name

    # 2. Loose match on model alone — handles (a) OCR entries registered
    #    under a synthetic "legacy-vision-*" credential id because the
    #    entry had no credential_id set, and (b) configs where the OCR
    #    entry's credential_id drifted from the actual credential in use.
    named = [p for p in candidates if getattr(p, key, "") == raw_model and p.name]
    if len(named) == 1:
        return named[0].name

    if len(named) == 0:
        logger.debug(
            "display-name lookup miss: kind=%s credential=%s model=%s",
            kind, credential_id, raw_model,
        )
    return ""


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
