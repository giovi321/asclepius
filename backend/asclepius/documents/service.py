"""Document business logic."""

import hashlib
from pathlib import Path

import aiosqlite


async def get_document(db: aiosqlite.Connection, doc_id: int) -> dict | None:
    """Get a single document by ID."""
    cursor = await db.execute(
        """SELECT d.*,
                  p.display_name as patient_name, p.slug as patient_slug,
                  COALESCE(d.doctor_name, doc.name) as doctor_name,
                  COALESCE(d.facility_name, f.name) as facility_name
           FROM documents d
           LEFT JOIN patients p ON d.patient_id = p.id
           LEFT JOIN doctors doc ON d.doctor_id = doc.id
           LEFT JOIN facilities f ON d.facility_id = f.id
           WHERE d.id = ?""",
        (doc_id,),
    )
    row = await cursor.fetchone()
    if not row:
        return None
    return dict(row)


async def list_documents(
    db: aiosqlite.Connection,
    user_id: int,
    patient_id: int | None = None,
    doc_type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
    specialty: str | None = None,
    doctor_id: int | None = None,
    facility_id: int | None = None,
) -> dict:
    """List documents with filters. Returns {items, total}."""
    conditions = []
    params: list = []

    # No blanket access filter — all authenticated users can see all documents.
    # Per-patient access control is enforced when viewing individual documents.

    if patient_id is not None:
        conditions.append("d.patient_id = ?")
        params.append(patient_id)
    if doc_type:
        conditions.append("d.doc_type = ?")
        params.append(doc_type)
    if date_from:
        conditions.append("d.doc_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("d.doc_date <= ?")
        params.append(date_to)
    if status:
        conditions.append("d.status = ?")
        params.append(status)
    if doctor_id is not None:
        conditions.append("d.doctor_id = ?")
        params.append(doctor_id)
    if facility_id is not None:
        conditions.append("d.facility_id = ?")
        params.append(facility_id)
    if specialty:
        conditions.append(
            "(d.norm_specialty_id = ? OR d.specialty_original LIKE ?)"
        )
        try:
            spec_id = int(specialty)
            params.extend([spec_id, f"%{specialty}%"])
        except ValueError:
            params.extend([-1, f"%{specialty}%"])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    select_cols = """d.*,
                     p.display_name as patient_name,
                     COALESCE(d.doctor_name, doc.name) as doctor_name,
                     COALESCE(d.facility_name, f.name) as facility_name"""
    joins = """LEFT JOIN patients p ON d.patient_id = p.id
               LEFT JOIN doctors doc ON d.doctor_id = doc.id
               LEFT JOIN facilities f ON d.facility_id = f.id"""

    # Full-text search
    if q:
        fts_query = (
            f"""SELECT {select_cols}
                FROM documents d {joins}
                JOIN documents_fts ON documents_fts.rowid = d.id
                {where} AND documents_fts MATCH ?
                ORDER BY rank
                LIMIT ? OFFSET ?"""
        )
        params.extend([q, limit, offset])
        cursor = await db.execute(fts_query, params)
    else:
        query = f"""SELECT {select_cols}
                    FROM documents d {joins}
                    {where}
                    ORDER BY d.created_at DESC
                    LIMIT ? OFFSET ?"""
        params.extend([limit, offset])
        cursor = await db.execute(query, params)

    rows = await cursor.fetchall()
    items = [dict(r) for r in rows]

    # Get total count
    count_params = params[:-2]  # remove limit/offset
    if q:
        count_query = f"""SELECT COUNT(*) FROM documents d
                         JOIN documents_fts ON documents_fts.rowid = d.id
                         {where} AND documents_fts MATCH ?"""
    else:
        count_query = f"SELECT COUNT(*) FROM documents d {where}"
    cursor = await db.execute(count_query, count_params)
    total = (await cursor.fetchone())[0]

    return {"items": items, "total": total}


def compute_file_hash(file_path: str | Path) -> str:
    """Compute SHA-256 hash of a file."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()
