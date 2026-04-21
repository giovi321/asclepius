"""Normalization API routes."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import aiosqlite
from asclepius.auth.session import get_current_user
from asclepius.config import get_config
from asclepius.db.connection import get_db
from asclepius.normalization.auto_merge import suggest_merges
from asclepius.normalization.service import NormService
from asclepius.pipeline.processor import get_llm_provider

logger = logging.getLogger(__name__)

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


class NewTarget(BaseModel):
    canonical_code: str
    canonical_display: str


class MergeBatchRequest(BaseModel):
    source_ids: list[int]
    target_id: int | None = None
    # If set, create a brand-new canonical entry first and merge sources into it.
    new_target: NewTarget | None = None


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
    try:
        return await svc.update(norm_id, body.canonical_code, body.canonical_display)
    except aiosqlite.IntegrityError as e:
        msg = str(e)
        # Most common: UNIQUE constraint on canonical_code when another entry
        # already owns the requested code. Tell the user what to do.
        if "canonical_code" in msg or "UNIQUE" in msg.upper():
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Another {norm_type[:-1] if norm_type.endswith('s') else norm_type} "
                    f"already has code '{body.canonical_code}'. Use Merge to unify them "
                    f"instead of renaming."
                ),
            ) from e
        raise HTTPException(status_code=409, detail=f"Database conflict: {msg}") from e
    except Exception as e:
        logger.exception("Failed to update %s #%d", norm_type, norm_id)
        raise HTTPException(status_code=500, detail=f"Update failed: {e}") from e


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

    if body.new_target is not None:
        if not body.new_target.canonical_display.strip():
            raise HTTPException(status_code=400, detail="canonical_display is required")
        try:
            target_id = await svc.create_entry(
                canonical_code=body.new_target.canonical_code.strip(),
                canonical_display=body.new_target.canonical_display.strip(),
            )
        except aiosqlite.IntegrityError as e:
            raise HTTPException(
                status_code=409,
                detail=f"Could not create new entry: {e}. Pick a different code or use an existing target.",
            ) from e
    elif body.target_id is not None:
        target_id = body.target_id
    else:
        raise HTTPException(status_code=400, detail="target_id or new_target required")

    try:
        await svc.merge_batch(body.source_ids, target_id)
    except Exception as e:
        logger.exception("merge-batch failed for %s into %s", body.source_ids, target_id)
        raise HTTPException(status_code=500, detail=f"Merge failed: {e}") from e
    return {
        "ok": True,
        "target_id": target_id,
        "merged": len([s for s in body.source_ids if s != target_id]),
    }


@router.delete("/{norm_type}/{norm_id}")
async def delete_norm(
    norm_type: str,
    norm_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    tables = _validate_type(norm_type)
    svc = NormService(db, tables)
    try:
        await svc.delete_entry(norm_id)
    except Exception as e:
        logger.exception("Failed to delete %s #%d", norm_type, norm_id)
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}") from e
    return {"ok": True}


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
    """Ask the configured General LLM to propose merge groups. Does NOT execute any merge."""
    from asclepius.pipeline.provider_factory import (
        _build_general_llm_provider,
        ProviderUnreachableError,
    )

    tables = _validate_type(norm_type)
    config = get_config()
    llm = _build_general_llm_provider(config)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail="General LLM is not configured. Set it under Settings → Document Analysis → General.",
        )
    try:
        return await suggest_merges(
            db=db,
            llm=llm,
            main_table=tables["main"],
            alias_table=tables["aliases"],
            fk_col=tables["fk"],
            norm_type_label=norm_type.replace("_", " "),
        )
    except ProviderUnreachableError as e:
        raise HTTPException(status_code=503, detail=str(e))
