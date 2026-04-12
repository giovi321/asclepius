"""Normalization API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.db.connection import get_db
from asclepius.normalization.service import NormService

router = APIRouter()

# Mapping of type names to table info
NORM_TABLES = {
    "lab_tests": {
        "main": "norm_lab_tests",
        "aliases": "norm_lab_test_aliases",
        "fk": "norm_lab_test_id",
        "ref_table": "lab_results",
        "ref_col": "norm_lab_test_id",
    },
    "specialties": {
        "main": "norm_specialties",
        "aliases": "norm_specialty_aliases",
        "fk": "norm_specialty_id",
        "ref_table": "encounters",
        "ref_col": "norm_specialty_id",
    },
    "diagnoses": {
        "main": "norm_diagnoses",
        "aliases": "norm_diagnosis_aliases",
        "fk": "norm_diagnosis_id",
        "ref_table": "encounters",
        "ref_col": "norm_diagnosis_id",
    },
    "medications": {
        "main": "norm_medications",
        "aliases": "norm_medication_aliases",
        "fk": "norm_medication_id",
        "ref_table": "medications",
        "ref_col": "norm_medication_id",
    },
}


class AliasCreate(BaseModel):
    alias: str
    language: str | None = None


class NormUpdate(BaseModel):
    canonical_code: str | None = None
    canonical_display: str | None = None


class MergeRequest(BaseModel):
    source_id: int
    target_id: int


def _validate_type(norm_type: str) -> dict:
    if norm_type not in NORM_TABLES:
        raise HTTPException(status_code=400, detail=f"Invalid type: {norm_type}")
    return NORM_TABLES[norm_type]


# --- Doctors and Facilities (not norm_ tables, but used by filters) ---

@router.get("/doctors")
async def list_doctors(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "SELECT id, name, slug, title, specialty_original FROM doctors ORDER BY name"
    )
    return [dict(r) for r in await cursor.fetchall()]


@router.get("/facilities")
async def list_facilities(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        "SELECT id, name, slug, type, city, country FROM facilities ORDER BY name"
    )
    return [dict(r) for r in await cursor.fetchall()]


@router.get("/{norm_type}")
async def list_norms(
    norm_type: str,
    filter: str | None = Query(default=None),
    search: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    return await svc.list_all(
        filter_unreviewed=(filter == "unreviewed"),
        search=search,
    )


@router.get("/{norm_type}/{norm_id}")
async def get_norm(
    norm_type: str,
    norm_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    result = await svc.get_with_aliases(norm_id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


@router.patch("/{norm_type}/{norm_id}")
async def update_norm(
    norm_type: str,
    norm_id: int,
    body: NormUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    return await svc.update(norm_id, body.canonical_code, body.canonical_display)


@router.post("/{norm_type}/{norm_id}/aliases")
async def add_alias(
    norm_type: str,
    norm_id: int,
    body: AliasCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    return await svc.add_alias(norm_id, body.alias, body.language)


@router.delete("/{norm_type}/aliases/{alias_id}")
async def remove_alias(
    norm_type: str,
    alias_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    await svc.remove_alias(alias_id)
    return {"ok": True}


@router.post("/{norm_type}/{norm_id}/confirm")
async def confirm_aliases(
    norm_type: str,
    norm_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    await svc.confirm_aliases(norm_id)
    return {"ok": True}


@router.post("/{norm_type}/merge")
async def merge_norms(
    norm_type: str,
    body: MergeRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    await svc.merge(body.source_id, body.target_id)
    return {"ok": True}
