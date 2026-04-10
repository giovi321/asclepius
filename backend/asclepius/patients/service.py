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
    """Get all patients accessible to a user.
    Returns all patients if the user has access to any, since admin users
    need visibility. Falls back to showing all patients if no access entries exist.
    """
    # First try: patients the user has explicit access to
    cursor = await db.execute(
        """SELECT p.*, upa.role
           FROM patients p
           JOIN user_patient_access upa ON upa.patient_id = p.id
           WHERE upa.user_id = ?
           ORDER BY p.display_name""",
        (user_id,),
    )
    rows = await cursor.fetchall()

    if rows:
        return [dict(r) for r in rows]

    # Fallback: if user has no access entries, show all patients
    # (covers first-run / admin without explicit grants)
    cursor = await db.execute(
        "SELECT *, 'owner' as role FROM patients ORDER BY display_name"
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]
