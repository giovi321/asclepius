"""Chunked LLM extraction for long documents and result merging."""

import logging

import aiosqlite

from asclepius.config import AppConfig

logger = logging.getLogger(__name__)


async def chunked_extract_and_store(
    db: aiosqlite.Connection,
    llm,
    doc_id: int,
    ocr_text: str,
    config: AppConfig,
) -> dict:
    """Split long text into overlapping chunks, extract from each, and merge results."""
    from asclepius.pipeline.extractor import build_extraction_context, extract_and_store

    chunk_size = 10000
    overlap = 1000
    chunks = []
    start = 0
    while start < len(ocr_text):
        end = start + chunk_size
        chunks.append(ocr_text[start:end])
        start = end - overlap

    logger.info("Splitting doc %d into %d chunks for LLM extraction", doc_id, len(chunks))

    # Extract first chunk normally (this writes to DB)
    extraction = await extract_and_store(db, llm, doc_id, chunks[0], config)
    if "error" in extraction:
        return extraction

    # Extract remaining chunks and merge
    context = await build_extraction_context(db)
    for i, chunk in enumerate(chunks[1:], start=2):
        logger.info("Extracting chunk %d/%d for doc %d", i, len(chunks), doc_id)
        try:
            chunk_extraction = await llm.extract(chunk, context)
            if "error" in chunk_extraction:
                continue
            extraction = merge_extractions(extraction, chunk_extraction)
        except Exception:
            logger.exception("Chunk %d extraction failed for doc %d", i, doc_id)

    return extraction


def merge_extractions(base: dict, additional: dict) -> dict:
    """Merge additional extraction results into the base, deduplicating."""
    # Merge lab results — deduplicate by test_name_original
    existing_labs = {lr.get("test_name_original") for lr in base.get("lab_results", [])}
    for lab in additional.get("lab_results", []):
        if lab.get("test_name_original") not in existing_labs:
            base.setdefault("lab_results", []).append(lab)
            existing_labs.add(lab.get("test_name_original"))

    # Merge medications — deduplicate by brand_name + active_ingredient_original
    existing_meds = {
        (m.get("brand_name"), m.get("active_ingredient_original"))
        for m in base.get("medications", [])
    }
    for med in additional.get("medications", []):
        key = (med.get("brand_name"), med.get("active_ingredient_original"))
        if key not in existing_meds:
            base.setdefault("medications", []).append(med)
            existing_meds.add(key)

    # Merge diagnoses — deduplicate by diagnosis_original
    existing_diags = {d.get("diagnosis_original") for d in base.get("diagnoses", [])}
    for diag in additional.get("diagnoses", []):
        if diag.get("diagnosis_original") not in existing_diags:
            base.setdefault("diagnoses", []).append(diag)
            existing_diags.add(diag.get("diagnosis_original"))

    # Merge vaccinations — deduplicate by vaccine_name + date_administered
    existing_vax = {
        (v.get("vaccine_name"), v.get("date_administered"))
        for v in base.get("vaccinations", [])
    }
    for vax in additional.get("vaccinations", []):
        key = (vax.get("vaccine_name"), vax.get("date_administered"))
        if key not in existing_vax:
            base.setdefault("vaccinations", []).append(vax)
            existing_vax.add(key)

    # Merge cost line items — deduplicate by description + amount
    base_cost = base.get("cost", {})
    add_cost = additional.get("cost", {})
    existing_items = {
        (li.get("description"), li.get("amount"))
        for li in base_cost.get("line_items", [])
    }
    for item in add_cost.get("line_items", []):
        key = (item.get("description"), item.get("amount"))
        if key not in existing_items:
            base_cost.setdefault("line_items", []).append(item)
            existing_items.add(key)

    return base
