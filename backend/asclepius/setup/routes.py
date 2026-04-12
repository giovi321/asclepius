"""First-start setup wizard API routes (no auth required)."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import hash_password, create_session_token, COOKIE_NAME
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import slugify

router = APIRouter()


class SetupRequest(BaseModel):
    # Account
    username: str
    password: str
    display_name: str
    # Patient
    patient_name: str
    patient_date_of_birth: str | None = None
    patient_sex: str | None = None
    patient_blood_type: str | None = None
    patient_allergies: str | None = None
    patient_phone: str | None = None
    patient_email: str | None = None
    patient_address: str | None = None
    patient_insurance_company: str | None = None
    patient_insurance_number: str | None = None


@router.get("/status")
async def setup_status(db: aiosqlite.Connection = Depends(get_db)):
    """Check if initial setup is needed (no users exist)."""
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    count = (await cursor.fetchone())[0]
    return {"needs_setup": count == 0}


@router.post("/complete")
async def setup_complete(
    body: SetupRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Create the first admin user and first patient."""
    # Guard: only works if no users exist
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    count = (await cursor.fetchone())[0]
    if count > 0:
        raise HTTPException(status_code=400, detail="Setup already completed")

    if not body.username.strip() or not body.password.strip():
        raise HTTPException(status_code=400, detail="Username and password are required")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    # Create user
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
        (body.username.strip(), hash_password(body.password), body.display_name.strip() or body.username.strip()),
    )
    user_id = cursor.lastrowid

    # Create patient
    patient_name = body.patient_name.strip()
    if not patient_name:
        patient_name = body.display_name.strip() or body.username.strip()

    slug = slugify(patient_name)
    config = get_config()
    patient_dir = Path(config.vault.patients_path) / slug
    patient_dir.mkdir(parents=True, exist_ok=True)

    cursor = await db.execute(
        """INSERT INTO patients (slug, display_name, date_of_birth, sex, blood_type,
                                allergies, phone, email, address,
                                insurance_company, insurance_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (slug, patient_name, body.patient_date_of_birth, body.patient_sex,
         body.patient_blood_type, body.patient_allergies, body.patient_phone,
         body.patient_email, body.patient_address,
         body.patient_insurance_company, body.patient_insurance_number),
    )
    patient_id = cursor.lastrowid

    # Grant owner access
    await db.execute(
        "INSERT INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, 'owner')",
        (user_id, patient_id),
    )
    await db.commit()

    # Create session token so user is auto-logged in
    from fastapi.responses import JSONResponse
    token = create_session_token(user_id)
    response = JSONResponse(content={
        "ok": True,
        "user_id": user_id,
        "patient_id": patient_id,
    })
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return response
