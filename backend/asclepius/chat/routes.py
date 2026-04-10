"""Chat API routes."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.chat.service import chat_with_rag
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access
from asclepius.pipeline.processor import get_llm_provider

router = APIRouter()


class ChatRequest(BaseModel):
    patient_id: int | None = None
    message: str


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
    llm = get_llm_provider(config)

    result = await chat_with_rag(
        db, llm, current_user["id"], body.patient_id, body.message
    )
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
        """SELECT id, role, content, created_at FROM chat_history
           WHERE user_id = ? AND (patient_id = ? OR (? IS NULL AND patient_id IS NULL))
           ORDER BY created_at ASC""",
        (current_user["id"], patient_id, patient_id),
    )
    rows = await cursor.fetchall()
    return {"messages": [dict(r) for r in rows]}
