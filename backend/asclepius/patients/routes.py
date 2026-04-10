"""Patient API routes."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import check_patient_access, get_patients_for_user, slugify

router = APIRouter()


class PatientCreate(BaseModel):
    display_name: str
    date_of_birth: str | None = None


class PatientUpdate(BaseModel):
    display_name: str | None = None
    date_of_birth: str | None = None


@router.get("")
async def list_patients(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await get_patients_for_user(db, current_user["id"])


@router.post("", status_code=201)
async def create_patient(
    body: PatientCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    slug = slugify(body.display_name)
    config = get_config()

    # Create patient directory
    patient_dir = Path(config.vault.patients_path) / slug
    patient_dir.mkdir(parents=True, exist_ok=True)

    try:
        cursor = await db.execute(
            "INSERT INTO patients (slug, display_name, date_of_birth) VALUES (?, ?, ?)",
            (slug, body.display_name, body.date_of_birth),
        )
        patient_id = cursor.lastrowid

        # Grant owner access
        await db.execute(
            "INSERT INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, 'owner')",
            (current_user["id"], patient_id),
        )
        await db.commit()
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="Patient slug already exists")

    return {
        "id": patient_id,
        "slug": slug,
        "display_name": body.display_name,
        "date_of_birth": body.date_of_birth,
    }


@router.patch("/{patient_id}")
async def update_patient(
    patient_id: int,
    body: PatientUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    role = await check_patient_access(db, current_user["id"], patient_id)
    if not role:
        raise HTTPException(status_code=403, detail="No access to this patient")
    if role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can edit patient info")

    updates = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.date_of_birth is not None:
        updates["date_of_birth"] = body.date_of_birth

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [patient_id]
    await db.execute(f"UPDATE patients SET {set_clause} WHERE id = ?", values)
    await db.commit()

    cursor = await db.execute(
        "SELECT id, slug, display_name, date_of_birth FROM patients WHERE id = ?",
        (patient_id,),
    )
    row = await cursor.fetchone()
    return {
        "id": row[0], "slug": row[1],
        "display_name": row[2], "date_of_birth": row[3],
    }
