"""Pipeline status API routes."""

from fastapi import APIRouter, Depends

from asclepius.auth.session import get_current_user

router = APIRouter()


@router.get("/status")
async def pipeline_status(current_user: dict = Depends(get_current_user)):
    from asclepius.pipeline.processor import pipeline_status as status
    return status
