"""Normalization API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.normalization.auto_merge import suggest_merges
from asclepius.normalization.service import NormService
from asclepius.pipeline.processor import get_llm_provider

router = APIRouter()

# Mapping of type names to table info.
#
# doc_sources: list of (table, fk_col) pairs the "documents linked" endpoint walks to
# find the set of documents that reference this entry. Each source must be either
# `documents` itself (fk is the referring column) or a table with a `document_id`
# column pointing back to documents.
NORM_TABLES = {
    "lab_tests": {
        "main": "norm_lab_tests",
        "aliases": "norm_lab_test_aliases",
        "fk": "norm_lab_test_id",
        "ref_tables": [{"table": "lab_results", "col": "norm_lab_test_id"}],
        "doc_sources": [("lab_results", "norm_lab_test_id")],
    },
    "specialties": {
        "main": "norm_specialties",
        "aliases": "norm_specialty_aliases",
        "fk": "norm_specialty_id",
        "ref_tables": [{"table": "encounters", "col": "norm_specialty_id"}],
        "doc_sources": [
            ("documents", "norm_specialty_id"),
            ("encounters", "norm_specialty_id"),
        ],
    },
    "diagnoses": {
        "main": "norm_diagnoses",
        "aliases": "norm_diagnosis_aliases",
        "fk": "norm_diagnosis_id",
        "ref_tables": [{"table": "encounters", "col": "norm_diagnosis_id"}],
        "doc_sources": [("encounters", "norm_diagnosis_id")],
    },
    "medications": {
        "main": "norm_medications",
        "aliases": "norm_medication_aliases",
        "fk": "norm_medication_id",
        "ref_tables": [{"table": "medications", "col": "norm_medication_id"}],
        "doc_sources": [("medications", "norm_medication_id")],
    },
    "doctors": {
        "main": "doctors",
        "aliases": "doctor_aliases",
        "fk": "doctor_id",
        "ref_tables": [
            {"table": "documents", "col": "doctor_id"},
            {"table": "encounters", "col": "doctor_id"},
            {"table": "imaging_studies", "col": "doctor_id"},
        ],
        "denorm_updates": [
            {"table": "documents", "fk_col": "doctor_id", "text_col": "doctor_name"},
        ],
        "doc_sources": [
            ("documents", "doctor_id"),
            ("encounters", "doctor_id"),
            ("imaging_studies", "doctor_id"),
        ],
    },
    "facilities": {
        "main": "facilities",
        "aliases": "facility_aliases",
        "fk": "facility_id",
        "ref_tables": [
            {"table": "documents", "col": "facility_id"},
            {"table": "encounters", "col": "facility_id"},
            {"table": "imaging_studies", "col": "facility_id"},
            {"table": "doctors", "col": "facility_id"},
        ],
        "denorm_updates": [
            {"table": "documents", "fk_col": "facility_id", "text_col": "facility_name"},
        ],
        "doc_sources": [
            ("documents", "facility_id"),
            ("encounters", "facility_id"),
            ("imaging_studies", "facility_id"),
        ],
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


class MergeBatchRequest(BaseModel):
    source_ids: list[int]
    target_id: int


def _validate_type(norm_type: str) -> dict:
    if norm_type not in NORM_TABLES:
        raise HTTPException(status_code=400, detail=f"Invalid type: {norm_type}")
    return NORM_TABLES[norm_type]


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


@router.post("/{norm_type}/merge-batch")
async def merge_norms_batch(
    norm_type: str,
    body: MergeBatchRequest,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    await svc.merge_batch(body.source_ids, body.target_id)
    return {"ok": True, "merged": len([s for s in body.source_ids if s != body.target_id])}


@router.get("/{norm_type}/{norm_id}/documents")
async def list_linked_documents(
    norm_type: str,
    norm_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    return await svc.list_documents(norm_id)


@router.post("/{norm_type}/auto-merge")
async def auto_merge_proposals(
    norm_type: str,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Ask the configured LLM to propose merge groups. Does NOT execute any merge."""
    tables = _validate_type(norm_type)
    config = get_config()
    llm = get_llm_provider(config)
    return await suggest_merges(
        db=db,
        llm=llm,
        main_table=tables["main"],
        alias_table=tables["aliases"],
        fk_col=tables["fk"],
        norm_type_label=norm_type.replace("_", " "),
    )
