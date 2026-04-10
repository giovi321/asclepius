"""Authentication API routes."""

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import (
    COOKIE_NAME,
    create_session_token,
    get_current_user,
    verify_password,
)
from asclepius.db.connection import get_db

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str | None


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "SELECT id, username, password_hash, display_name FROM users WHERE username = ?",
        (body.username,),
    )
    user = await cursor.fetchone()
    if not user or not verify_password(body.password, user[2]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_session_token(user[0])
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return UserResponse(id=user[0], username=user[1], display_name=user[3])


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
async def me(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict:
    # Also return accessible patients
    cursor = await db.execute(
        """SELECT p.id, p.slug, p.display_name, upa.role
           FROM patients p
           JOIN user_patient_access upa ON upa.patient_id = p.id
           WHERE upa.user_id = ?""",
        (current_user["id"],),
    )
    patients = [
        {"id": row[0], "slug": row[1], "display_name": row[2], "role": row[3]}
        for row in await cursor.fetchall()
    ]
    return {**current_user, "patients": patients}
