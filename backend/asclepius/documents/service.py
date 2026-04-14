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
    doctor_id: str | int | None = None,
    facility_id: str | int | None = None,
) -> dict:
    """List documents with filters. Returns {items, total}."""
    conditions = []
    params: list = []

    if patient_id is not None:
        conditions.append("d.patient_id = ?")
        params.append(patient_id)
    if doc_type:
        types = [t.strip() for t in doc_type.split(",") if t.strip()]
        if len(types) == 1:
            conditions.append("d.doc_type = ?")
            params.append(types[0])
        elif types:
            placeholders = ",".join(["?"] * len(types))
            conditions.append(f"d.doc_type IN ({placeholders})")
            params.extend(types)
    if date_from:
        # Use the best available date
        conditions.append("COALESCE(d.date_visit, d.date_issued, d.doc_date) >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("COALESCE(d.date_visit, d.date_issued, d.doc_date) <= ?")
        params.append(date_to)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            conditions.append("d.status = ?")
            params.append(statuses[0])
        elif statuses:
            placeholders = ",".join(["?"] * len(statuses))
            conditions.append(f"d.status IN ({placeholders})")
            params.extend(statuses)
    if doctor_id is not None:
        doctor_ids = [int(x) for x in str(doctor_id).split(",") if x.strip().isdigit()]
        if len(doctor_ids) == 1:
            conditions.append("d.doctor_id = ?")
            params.append(doctor_ids[0])
        elif doctor_ids:
            placeholders = ",".join(["?"] * len(doctor_ids))
            conditions.append(f"d.doctor_id IN ({placeholders})")
            params.extend(doctor_ids)
    if facility_id is not None:
        facility_ids = [int(x) for x in str(facility_id).split(",") if x.strip().isdigit()]
        if len(facility_ids) == 1:
            conditions.append("d.facility_id = ?")
            params.append(facility_ids[0])
        elif facility_ids:
            placeholders = ",".join(["?"] * len(facility_ids))
            conditions.append(f"d.facility_id IN ({placeholders})")
            params.extend(facility_ids)
    if specialty:
        spec_values = [s.strip() for s in specialty.split(",") if s.strip()]
        if len(spec_values) == 1:
            conditions.append("(d.norm_specialty_id = ? OR d.specialty_original LIKE ?)")
            try:
                spec_id = int(spec_values[0])
                params.extend([spec_id, f"%{spec_values[0]}%"])
            except ValueError:
                params.extend([-1, f"%{spec_values[0]}%"])
        elif spec_values:
            or_parts = []
            for sv in spec_values:
                or_parts.append("d.specialty_original LIKE ?")
                params.append(f"%{sv}%")
            conditions.append(f"({' OR '.join(or_parts)})")

    # Fuzzy search across multiple columns using LIKE
    if q:
        search_term = f"%{q}%"
        conditions.append(
            """(d.original_filename LIKE ? COLLATE NOCASE
                OR d.doc_type LIKE ? COLLATE NOCASE
                OR d.doctor_name LIKE ? COLLATE NOCASE
                OR d.facility_name LIKE ? COLLATE NOCASE
                OR d.summary_en LIKE ? COLLATE NOCASE
                OR d.summary_original LIKE ? COLLATE NOCASE
                OR d.specialty_original LIKE ? COLLATE NOCASE
                OR d.ocr_text LIKE ? COLLATE NOCASE
                OR p.display_name LIKE ? COLLATE NOCASE)"""
        )
        params.extend([search_term] * 9)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    select_cols = """d.*,
                     p.display_name as patient_name,
                     COALESCE(d.doctor_name, doc.name) as doctor_name,
                     COALESCE(d.facility_name, f.name) as facility_name,
                     me.title as event_title,
                     me.event_type as event_type,
                     me.color as event_color"""
    joins = """LEFT JOIN patients p ON d.patient_id = p.id
               LEFT JOIN doctors doc ON d.doctor_id = doc.id
               LEFT JOIN facilities f ON d.facility_id = f.id
               LEFT JOIN medical_events me ON d.event_id = me.id"""

    query = f"""SELECT {select_cols}
                FROM documents d {joins}
                {where}
                ORDER BY COALESCE(d.date_visit, d.date_issued, d.doc_date, d.created_at) DESC
                LIMIT ? OFFSET ?"""
    params.extend([limit, offset])
    cursor = await db.execute(query, params)

    rows = await cursor.fetchall()
    items = [dict(r) for r in rows]

    # Get total count
    count_params = params[:-2]  # remove limit/offset
    count_query = f"SELECT COUNT(*) FROM documents d {joins} {where}"
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
