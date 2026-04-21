"""Chat API routes."""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.chat.service import chat_with_rag
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access
from asclepius.pipeline.provider_factory import (
    _build_general_llm_provider,
    ProviderUnreachableError,
)

router = APIRouter()


class ChatRequest(BaseModel):
    patient_id: int | None = None
    message: str = Field(min_length=1, max_length=4000)


@router.post("")
async def chat(
    body: ChatRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    if body.patient_id:
        role = await check_patient_access(db, current_user["id"], body.patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access to this patient")

    config = get_config()
    llm = _build_general_llm_provider(config)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail="General LLM is not configured. Set it under Settings → Document Analysis → General.",
        )

    try:
        result = await chat_with_rag(
            db, llm, current_user["id"], body.patient_id, body.message,
            is_admin=(current_user.get("role") == "admin"),
        )
    except ProviderUnreachableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return result


@router.get("/history")
async def chat_history(
    patient_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    if patient_id:
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access")

    cursor = await db.execute(
        """SELECT id, role, content, sources, created_at FROM chat_history
           WHERE user_id = ? AND (patient_id = ? OR (? IS NULL AND patient_id IS NULL))
           ORDER BY created_at ASC""",
        (current_user["id"], patient_id, patient_id),
    )
    messages = []
    for r in await cursor.fetchall():
        d = dict(r)
        raw = d.pop("sources", None)
        if raw:
            try:
                d["sources"] = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                d["sources"] = []
        else:
            d["sources"] = []
        messages.append(d)
    return {"messages": messages}


@router.delete("/history")
async def clear_chat_history(
    patient_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    if patient_id:
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access")

    await db.execute(
        """DELETE FROM chat_history
           WHERE user_id = ? AND (patient_id = ? OR (? IS NULL AND patient_id IS NULL))""",
        (current_user["id"], patient_id, patient_id),
    )
    await db.commit()
    return {"ok": True}
