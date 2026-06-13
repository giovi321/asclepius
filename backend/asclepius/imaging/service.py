"""Imaging study queries + the list SQL builder (no FastAPI routing).

``_study_with_access`` and the list query body were moved verbatim from
``routes.py``; the list endpoint now delegates to :func:`list_imaging_studies_query`.
"""

from fastapi import HTTPException

import aiosqlite
from asclepius.authz import require_patient_access
from asclepius.patients.service import check_patient_access


async def _study_with_access(
    study_id: int,
    current_user: dict,
    db: aiosqlite.Connection,
) -> dict:
    """Load a study row and enforce read access, or raise 404/403.

    Access goes through the canonical :func:`asclepius.authz.require_patient_access`,
    which ADDS an admin bypass this check previously lacked: admins can now
    reach any study even without an explicit patient grant.
    """
    cursor = await db.execute(
        "SELECT id, document_id, patient_id, folder_path " "FROM imaging_studies WHERE id = ?",
        (study_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Study not found")
    study = dict(row)
    if study["patient_id"]:
        await require_patient_access(db, study["patient_id"], current_user)
    return study


_LIST_SORT_COLUMNS: dict[str, str] = {
    # Frontend sort key → SQL expression. Whitelist only — anything not
    # here falls back to ``study_date DESC``. Doctor + facility are
    # joined through documents → doctors / facilities so the sort lines
    # up with the canonical names shown in the UI. Study date now lives
    # on the parent ``documents.event_date`` (single source of truth).
    "modality": "s.modality",
    "body_part": "s.body_part",
    "study_date": "d.event_date",
    "doctor": "doc.name",
    "facility": "f.name",
    "patient": "p.display_name",
    "report_status": "s.report_status",
    "date_added": "d.created_at",
}


async def list_imaging_studies_query(
    db: aiosqlite.Connection,
    current_user: dict,
    *,
    patient_id: int | None,
    modality: str | None,
    date_from: str | None,
    date_to: str | None,
    q: str | None,
    report_status: str | None,
    sort: str | None,
    order: str | None,
    limit: int,
    offset: int,
) -> dict:
    """List imaging studies. Mirrors the documents-list shape: search,
    filters, sort, paginated results with ``total`` count."""
    conditions = []
    params: list = []

    if patient_id:
        role = await check_patient_access(db, current_user["id"], patient_id)
        if not role:
            raise HTTPException(status_code=403, detail="No access")
        conditions.append("s.patient_id = ?")
        params.append(patient_id)
    else:
        conditions.append(
            "s.patient_id IN (SELECT patient_id FROM user_patient_access WHERE user_id = ?)"
        )
        params.append(current_user["id"])

    if modality:
        conditions.append("s.modality = ?")
        params.append(modality)
    if report_status:
        conditions.append("s.report_status = ?")
        params.append(report_status)
    if date_from:
        conditions.append("d.event_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("d.event_date <= ?")
        params.append(date_to)
    if q:
        like = f"%{q}%"
        # Search is across imaging-specific text + the canonical doctor /
        # facility names that come from the parent documents row.
        conditions.append(
            "(s.body_part LIKE ? OR s.study_description LIKE ? "
            "OR doc.name LIKE ? OR f.name LIKE ?)"
        )
        params.extend([like, like, like, like])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    sort_sql = _LIST_SORT_COLUMNS.get(sort or "", "d.event_date")
    order_sql = "ASC" if (order or "desc").lower() == "asc" else "DESC"

    # Count total (unbounded) so the UI can paginate.
    count_cursor = await db.execute(
        f"""SELECT COUNT(*)
            FROM imaging_studies s
            LEFT JOIN documents d ON s.document_id = d.id
            LEFT JOIN patients p ON s.patient_id = p.id
            LEFT JOIN doctors doc ON s.doctor_id = doc.id
            LEFT JOIN facilities f ON s.facility_id = f.id
            {where}""",
        params,
    )
    total_row = await count_cursor.fetchone()
    total = total_row[0] if total_row else 0

    cursor = await db.execute(
        f"""SELECT s.*,
                  p.display_name as patient_name,
                  doc.name as doctor_name,
                  f.name as facility_name,
                  d.original_filename as report_filename,
                  d.file_path as report_file_path,
                  d.event_date as study_date,
                  d.created_at as date_added
           FROM imaging_studies s
           LEFT JOIN documents d ON s.document_id = d.id
           LEFT JOIN patients p ON s.patient_id = p.id
           LEFT JOIN doctors doc ON s.doctor_id = doc.id
           LEFT JOIN facilities f ON s.facility_id = f.id
           {where}
           ORDER BY {sort_sql} {order_sql}, s.id DESC
           LIMIT ? OFFSET ?""",
        params + [limit, offset],
    )
    rows = await cursor.fetchall()
    return {"items": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}
