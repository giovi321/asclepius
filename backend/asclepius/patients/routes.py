"""Patient API routes."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.patients.service import (
    check_patient_access, get_patients_for_user, slugify, unique_patient_slug,
)

router = APIRouter()


class PatientCreate(BaseModel):
    display_name: str
    date_of_birth: str | None = None
    sex: str | None = None
    blood_type: str | None = None
    allergies: str | None = None
    notes: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    insurance_company: str | None = None
    insurance_number: str | None = None


class PatientUpdate(BaseModel):
    display_name: str | None = None
    date_of_birth: str | None = None
    sex: str | None = None
    blood_type: str | None = None
    allergies: str | None = None
    notes: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    insurance_company: str | None = None
    insurance_number: str | None = None


@router.get("")
async def list_patients(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    return await get_patients_for_user(
        db, current_user["id"], user_role=current_user.get("role")
    )


@router.get("/{patient_id}")
async def get_patient(
    patient_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get a single patient's details."""
    role = await check_patient_access(db, current_user["id"], patient_id)
    if not role:
        raise HTTPException(status_code=403, detail="No access to this patient")

    cursor = await db.execute(
        """SELECT id, slug, display_name, date_of_birth, sex, blood_type,
                  allergies, notes, phone, email, address,
                  insurance_company, insurance_number, created_at
           FROM patients WHERE id = ?""",
        (patient_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient = dict(row)
    patient["role"] = role

    # Get document count
    cursor = await db.execute(
        "SELECT COUNT(*) FROM documents WHERE patient_id = ?", (patient_id,)
    )
    patient["document_count"] = (await cursor.fetchone())[0]

    return patient


@router.post("", status_code=201)
async def create_patient(
    body: PatientCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    # display_name is what the user sees; slug is an internal handle used for
    # folder names and joins, and must be globally unique. When two users
    # independently add "Mario Rossi" we auto-disambiguate the slug so both
    # succeed; display_name can freely repeat.
    base = slugify(body.display_name) or "patient"
    slug = await unique_patient_slug(db, base)
    config = get_config()

    # Create patient directory
    patient_dir = Path(config.vault.patients_path) / slug
    patient_dir.mkdir(parents=True, exist_ok=True)

    try:
        cursor = await db.execute(
            """INSERT INTO patients (slug, display_name, date_of_birth, sex, blood_type,
                                    allergies, notes, phone, email, address,
                                    insurance_company, insurance_number)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (slug, body.display_name, body.date_of_birth, body.sex, body.blood_type,
             body.allergies, body.notes, body.phone, body.email, body.address,
             body.insurance_company, body.insurance_number),
        )
        patient_id = cursor.lastrowid

        # Grant owner access
        await db.execute(
            "INSERT INTO user_patient_access (user_id, patient_id, role) VALUES (?, ?, 'owner')",
            (current_user["id"], patient_id),
        )
        await db.commit()
    except aiosqlite.IntegrityError:
        # Shouldn't happen given unique_patient_slug above, but if there's a
        # race between two simultaneous creates, surface a clean 409.
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
    for field in [
        "display_name", "date_of_birth", "sex", "blood_type", "allergies",
        "notes", "phone", "email", "address", "insurance_company", "insurance_number",
    ]:
        value = getattr(body, field, None)
        if value is not None:
            updates[field] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [patient_id]
    await db.execute(f"UPDATE patients SET {set_clause} WHERE id = ?", values)
    await db.commit()

    cursor = await db.execute(
        """SELECT id, slug, display_name, date_of_birth, sex, blood_type,
                  allergies, notes, phone, email, address,
                  insurance_company, insurance_number
           FROM patients WHERE id = ?""",
        (patient_id,),
    )
    row = await cursor.fetchone()
    return dict(row)


@router.delete("/{patient_id}")
async def delete_patient(
    patient_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a patient and disassociate their documents."""
    role = await check_patient_access(db, current_user["id"], patient_id)
    if not role:
        raise HTTPException(status_code=403, detail="No access to this patient")
    if role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can delete patients")

    # Disassociate documents (set patient_id to NULL rather than deleting)
    await db.execute(
        "UPDATE documents SET patient_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE patient_id = ?",
        (patient_id,),
    )

    # Remove access entries
    await db.execute("DELETE FROM user_patient_access WHERE patient_id = ?", (patient_id,))

    # Delete the patient
    await db.execute("DELETE FROM patients WHERE id = ?", (patient_id,))
    await db.commit()

    return {"status": "deleted", "patient_id": patient_id}
