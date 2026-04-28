"""Per-user UI preferences for table column visibility + ordering.

Stored in ``user_view_prefs`` so the user's column choices follow them
across devices instead of getting trapped in a single browser's
localStorage. Defaults live in the frontend column registries; an absent
row means "use defaults".
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.db.connection import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


_VALID_VIEW_KEYS = {"documents", "imaging", "lab"}


class ViewPrefsBody(BaseModel):
    visible: list[str] = Field(default_factory=list)
    order: list[str] = Field(default_factory=list)


@router.get("/view-prefs/{view_key}")
async def get_view_prefs(
    view_key: str,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Return the user's stored prefs for ``view_key`` or ``null`` keys
    when no row exists. Frontend treats null as "use defaults"."""
    if view_key not in _VALID_VIEW_KEYS:
        raise HTTPException(status_code=400, detail="Unknown view key")

    cursor = await db.execute(
        "SELECT visible_json, order_json FROM user_view_prefs "
        "WHERE user_id = ? AND view_key = ?",
        (current_user["id"], view_key),
    )
    row = await cursor.fetchone()
    if not row:
        return {"visible": None, "order": None}
    try:
        return {
            "visible": json.loads(row[0]),
            "order": json.loads(row[1]),
        }
    except (TypeError, ValueError):
        # Stored row is corrupt — fall back to defaults rather than 500.
        logger.warning(
            "Corrupt view_prefs row for user=%s view=%s; ignoring",
            current_user["id"], view_key,
        )
        return {"visible": None, "order": None}


@router.put("/view-prefs/{view_key}")
async def set_view_prefs(
    view_key: str,
    body: ViewPrefsBody,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    if view_key not in _VALID_VIEW_KEYS:
        raise HTTPException(status_code=400, detail="Unknown view key")

    visible_json = json.dumps(body.visible)
    order_json = json.dumps(body.order)
    await db.execute(
        """INSERT INTO user_view_prefs (user_id, view_key, visible_json, order_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, view_key) DO UPDATE SET
             visible_json = excluded.visible_json,
             order_json   = excluded.order_json,
             updated_at   = CURRENT_TIMESTAMP""",
        (current_user["id"], view_key, visible_json, order_json),
    )
    await db.commit()
    return {"status": "saved", "view_key": view_key}
