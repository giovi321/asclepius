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


async def unique_patient_slug(
    db: aiosqlite.Connection, base: str, exclude_id: int | None = None
) -> str:
    """Return `base` if no patient owns it, else append -2, -3, … until unique.

    `patients.slug` is globally UNIQUE by schema so two users naming their
    patient "Mario Rossi" would collide. This lets the display_name repeat
    freely while the slug gets auto-disambiguated behind the scenes.
    """
    candidate = base or "patient"
    n = 1
    while True:
        if exclude_id is not None:
            cursor = await db.execute(
                "SELECT 1 FROM patients WHERE slug = ? AND id != ?",
                (candidate, exclude_id),
            )
        else:
            cursor = await db.execute(
                "SELECT 1 FROM patients WHERE slug = ?", (candidate,)
            )
        if not await cursor.fetchone():
            return candidate
        n += 1
        candidate = f"{base}-{n}"
        if n > 999:
            raise ValueError(f"Could not find a free slug for base '{base}'")


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
    db: aiosqlite.Connection, user_id: int, user_role: str | None = None
) -> list[dict]:
    """Get all patients accessible to a user.

    - Admins always see every patient, regardless of whether they have
      explicit grants (keeps the admin panel / maintenance flows working).
    - Non-admins see only the patients they have `user_patient_access` for.
      If they have zero grants, they get an empty list — previously the
      function fell through to showing everything, which leaked other
      users' patients.
    """
    if user_role == "admin":
        cursor = await db.execute(
            "SELECT *, 'owner' as role FROM patients ORDER BY display_name"
        )
        return [dict(r) for r in await cursor.fetchall()]

    cursor = await db.execute(
        """SELECT p.*, upa.role
           FROM patients p
           JOIN user_patient_access upa ON upa.patient_id = p.id
           WHERE upa.user_id = ?
           ORDER BY p.display_name""",
        (user_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]
