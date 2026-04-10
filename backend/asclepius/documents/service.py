"""Document business logic."""

import hashlib
from pathlib import Path

import aiosqlite


async def get_document(db: aiosqlite.Connection, doc_id: int) -> dict | None:
    """Get a single document by ID."""
    cursor = await db.execute(
        """SELECT d.*, p.display_name as patient_name, p.slug as patient_slug,
                  pr.name as provider_name
           FROM documents d
           LEFT JOIN patients p ON d.patient_id = p.id
           LEFT JOIN providers pr ON d.provider_id = pr.id
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
) -> dict:
    """List documents with filters. Returns {items, total}."""
    conditions = []
    params: list = []

    # Only show documents for patients the user has access to, or unclassified
    conditions.append(
        "(d.patient_id IN (SELECT patient_id FROM user_patient_access WHERE user_id = ?) "
        "OR d.patient_id IS NULL)"
    )
    params.append(user_id)

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

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    # Full-text search
    if q:
        fts_query = (
            f"""SELECT d.*, p.display_name as patient_name, pr.name as provider_name
                FROM documents d
                LEFT JOIN patients p ON d.patient_id = p.id
                LEFT JOIN providers pr ON d.provider_id = pr.id
                JOIN documents_fts ON documents_fts.rowid = d.id
                {where} AND documents_fts MATCH ?
                ORDER BY rank
                LIMIT ? OFFSET ?"""
        )
        params.extend([q, limit, offset])
        cursor = await db.execute(fts_query, params)
    else:
        query = f"""SELECT d.*, p.display_name as patient_name, pr.name as provider_name
                    FROM documents d
                    LEFT JOIN patients p ON d.patient_id = p.id
                    LEFT JOIN providers pr ON d.provider_id = pr.id
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
