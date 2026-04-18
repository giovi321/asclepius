"""First-start setup wizard API routes (no auth required).

These endpoints are only meaningful when the DB contains zero users. After
the first successful ``/complete`` call the wizard is disabled (guarded
server-side, not just in the UI).
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import aiosqlite
from asclepius.auth.cookies import set_auth_cookie
from asclepius.auth.session import COOKIE_NAME, create_session_token, hash_password
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import slugify

router = APIRouter()


class SetupRequest(BaseModel):
    # Account
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=1024)
    display_name: str = Field(min_length=0, max_length=200)
    # Patient
    patient_name: str = Field(min_length=0, max_length=200)
    patient_date_of_birth: str | None = Field(default=None, max_length=40)
    patient_sex: str | None = Field(default=None, max_length=20)
    patient_blood_type: str | None = Field(default=None, max_length=20)
    patient_allergies: str | None = Field(default=None, max_length=1000)
    patient_phone: str | None = Field(default=None, max_length=100)
    patient_email: str | None = Field(default=None, max_length=200)
    patient_address: str | None = Field(default=None, max_length=500)
    patient_insurance_company: str | None = Field(default=None, max_length=200)
    patient_insurance_number: str | None = Field(default=None, max_length=100)


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

    config = get_config()
    if not body.username.strip() or not body.password.strip():
        raise HTTPException(status_code=400, detail="Username and password are required")
    if len(body.password) < config.auth.min_password_length:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {config.auth.min_password_length} characters",
        )

    # Create user — the first account is always an admin. This guarantees
    # that the installer has a working administrative login; subsequent
    # users are created by an admin via the API with an explicit role.
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')",
        (body.username.strip(), hash_password(body.password), body.display_name.strip() or body.username.strip()),
    )
    user_id = cursor.lastrowid

    # Create patient
    patient_name = body.patient_name.strip()
    if not patient_name:
        patient_name = body.display_name.strip() or body.username.strip()

    slug = slugify(patient_name)
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
    set_auth_cookie(
        response, COOKIE_NAME, token,
        config=config,
        max_age=config.auth.session_ttl_hours * 3600,
    )
    return response
