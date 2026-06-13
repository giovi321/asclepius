"""Single source of truth for document / patient access control.

Every route module previously carried its own copy of the "can this user
touch this document/patient" check; those copies drifted (one let viewers
write, another lacked an admin bypass). The canonical model now lives here:

  * **Admin** (``current_user["role"] == "admin"``) bypasses every check —
    admins see and may mutate everything, even without an explicit grant.
  * **Uploader** of a document may always read and write it (document checks
    only).
  * **Patient grant** (a ``user_patient_access`` row) confers access at the
    role it names: ``viewer`` < ``editor`` < ``owner``. Read needs any grant;
    write needs a non-viewer grant.

``patients.service.check_patient_access`` remains the low-level primitive —
it answers "what role does this user hold on this patient?" and is the
building block both helpers below sit on top of.
"""

import aiosqlite
from fastapi import HTTPException

from asclepius.documents.service import get_document  # noqa: F401  (re-exported for callers)
from asclepius.patients.service import check_patient_access

# Patient-grant roles that may mutate. ``viewer`` is read-only; ``owner`` and
# ``editor`` may write. (``admin`` is a *global* user role, not a patient
# grant, and is handled by the explicit bypass in each helper.)
_WRITE_ROLES = frozenset({"owner", "editor"})


async def require_document_access(
    db: aiosqlite.Connection,
    doc: dict,
    current_user: dict,
    *,
    write: bool = False,
) -> None:
    """Raise 403 unless the caller may access ``doc`` (a ``get_document()`` row).

    Read access: admins, the original uploader, or any patient grant.
    Write access (``write=True``): admins, the uploader, or an owner/editor
    grant — viewers are rejected. This is the canonical document-access rule;
    the several per-router copies of this check now delegate here.
    """
    if current_user.get("role") == "admin":
        return
    if doc.get("uploaded_by_user_id") == current_user["id"]:
        return
    role = None
    if doc.get("patient_id"):
        role = await check_patient_access(db, current_user["id"], doc["patient_id"])
    if not role:
        raise HTTPException(status_code=403, detail="No access to this document")
    if write and role == "viewer":
        raise HTTPException(
            status_code=403, detail="Insufficient permissions to modify this document"
        )


async def require_patient_access(
    db: aiosqlite.Connection,
    patient_id: int,
    current_user: dict,
    *,
    write: bool = False,
) -> str | None:
    """Raise 403 unless the caller may act on ``patient_id``.

    Read access: admins, or any ``user_patient_access`` grant on the patient.
    Write access (``write=True``): admins, or an owner/editor grant — viewers
    are rejected. Returns the caller's patient role on success (``None`` for
    the admin bypass, since admins need no explicit grant).
    """
    if current_user.get("role") == "admin":
        return None
    role = await check_patient_access(db, current_user["id"], patient_id)
    if not role:
        raise HTTPException(status_code=403, detail="No access to this patient")
    if write and role not in _WRITE_ROLES:
        raise HTTPException(
            status_code=403, detail="Insufficient permissions for this patient"
        )
    return role
