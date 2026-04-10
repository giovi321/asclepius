"""Patient business logic."""

import re

import aiosqlite


def slugify(name: str) -> str:
    """Convert a display name to a slug for folder naming."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


async def check_patient_access(
    db: aiosqlite.Connection, user_id: int, patient_id: int
) -> str | None:
    """Check if user has access to patient. Returns role or None."""
    cursor = await db.execute(
        "SELECT role FROM user_patient_access WHERE user_id = ? AND patient_id = ?",
        (user_id, patient_id),
    )
    row = await cursor.fetchone()
    return row[0] if row else None


async def get_patients_for_user(
    db: aiosqlite.Connection, user_id: int
) -> list[dict]:
    """Get all patients accessible to a user."""
    cursor = await db.execute(
        """SELECT p.id, p.slug, p.display_name, p.date_of_birth, p.created_at, upa.role
           FROM patients p
           JOIN user_patient_access upa ON upa.patient_id = p.id
           WHERE upa.user_id = ?
           ORDER BY p.display_name""",
        (user_id,),
    )
    rows = await cursor.fetchall()
    return [
        {
            "id": r[0], "slug": r[1], "display_name": r[2],
            "date_of_birth": r[3], "created_at": r[4], "role": r[5],
        }
        for r in rows
    ]
