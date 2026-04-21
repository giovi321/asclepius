"""Chunked LLM extraction for long documents and result merging.

Long documents are split so each LLM call fits inside the model's context
window. We split by **page** rather than raw character offset so lab-result
tables are never cut mid-row. Consecutive chunks share one full page of
overlap: any table that straddles a page boundary is therefore seen intact
by at least one of the two chunks. ``merge_extractions`` deduplicates the
overlap (keyed by test name, brand+ingredient, diagnosis, etc.).
"""

import logging

import aiosqlite

from asclepius.config import AppConfig
from asclepius.llm.prompts import chunk_context_preamble
from asclepius.pipeline.ocr_cache import load_cached_ocr_pages

logger = logging.getLogger(__name__)

# Target size per chunk (characters). Kept close to the historical 10k so
# total LLM cost/tokens don't regress, while leaving room for the canonical-
# language directive and chunk preamble.
_TARGET_CHUNK_CHARS = 10000


async def chunked_extract_and_store(
    db: aiosqlite.Connection,
    llm,
    doc_id: int,
    ocr_text: str,
    config: AppConfig,
) -> dict:
    """Split long text into page-aligned chunks, extract from each, and merge results."""
    from asclepius.pipeline.extractor import build_extraction_context, extract_and_store

    pages = await _load_pages(db, doc_id, ocr_text)
    chunks = _build_page_chunks(pages, _TARGET_CHUNK_CHARS)
    total_pages = len(pages)
    total_chunks = len(chunks)
    logger.info(
        "Doc %d: %d pages → %d chunks (page-aligned, last-page overlap)",
        doc_id, total_pages, total_chunks,
    )

    first = chunks[0]
    first_text = _prepend_preamble(
        first["text"], 1, total_chunks,
        first["page_start"], first["page_end"], total_pages,
        overlaps_previous=False,
    ) if total_chunks > 1 else first["text"]
    # The first chunk goes through extract_and_store which writes to DB.
    # The preamble is prepended to the OCR text so the LLM sees the chunk
    # context at the top of the document block in the prompt.
    extraction = await extract_and_store(db, llm, doc_id, first_text, config)
    if "error" in extraction:
        return extraction

    # Subsequent chunks: extract in-memory and merge.
    context = await build_extraction_context(db)
    for i, chunk in enumerate(chunks[1:], start=2):
        logger.info(
            "Extracting chunk %d/%d for doc %d (pages %d-%d)",
            i, total_chunks, doc_id, chunk["page_start"], chunk["page_end"],
        )
        chunk_text = _prepend_preamble(
            chunk["text"], i, total_chunks,
            chunk["page_start"], chunk["page_end"], total_pages,
            overlaps_previous=True,
        )
        try:
            chunk_extraction = await llm.extract(chunk_text, context)
            if "error" in chunk_extraction:
                logger.warning(
                    "Chunk %d extraction returned error for doc %d: %s",
                    i, doc_id, chunk_extraction.get("error"),
                )
                continue
            extraction = merge_extractions(extraction, chunk_extraction)
        except Exception:
            logger.exception("Chunk %d extraction failed for doc %d", i, doc_id)

    return extraction


def _prepend_preamble(
    text: str,
    chunk_index: int,
    total_chunks: int,
    page_start: int,
    page_end: int,
    total_pages: int,
    overlaps_previous: bool,
) -> str:
    preamble = chunk_context_preamble(
        chunk_index=chunk_index,
        total_chunks=total_chunks,
        page_start=page_start,
        page_end=page_end,
        total_pages=total_pages,
        overlaps_previous=overlaps_previous,
    )
    return preamble + text


async def _load_pages(
    db: aiosqlite.Connection, doc_id: int, ocr_text: str,
) -> list[str]:
    """Return per-page OCR text. Falls back to splitting the concatenated
    ``ocr_text`` on blank lines when the cache is empty (older documents
    processed before per-page caching was added)."""
    cached = await load_cached_ocr_pages(db, doc_id)
    if cached:
        return cached
    # Legacy fallback. The OCR pipeline joins pages with ``"\n\n"`` but a
    # page may itself contain blank lines, so this is lossy — we split only
    # on double-blank-lines (``\n\n\n`` after normalisation) as a safer
    # heuristic. If that still produces a single page, return the whole text.
    normalised = ocr_text.replace("\r\n", "\n").strip()
    if "\n\n\n" in normalised:
        pages = [p.strip() for p in normalised.split("\n\n\n") if p.strip()]
    else:
        pages = [normalised]
    return pages


def _build_page_chunks(
    pages: list[str], target_chars: int,
) -> list[dict]:
    """Greedily pack pages into chunks up to ``target_chars`` each.

    The **last page** of every chunk is repeated as the **first page** of
    the next chunk. That guarantees any table spanning a page boundary is
    visible in its entirety in at least one chunk. ``merge_extractions``
    deduplicates the repeated rows.

    Returns a list of ``{"text": str, "page_start": int, "page_end": int}``
    dicts (page numbers are 1-based). Always returns at least one chunk,
    even for empty input (to keep downstream code simpler).
    """
    if not pages:
        return [{"text": "", "page_start": 1, "page_end": 1}]

    if len(pages) == 1:
        return [{"text": pages[0], "page_start": 1, "page_end": 1}]

    chunks: list[dict] = []
    i = 0
    n = len(pages)
    while i < n:
        current_pages = [pages[i]]
        current_start = i + 1
        j = i + 1
        while j < n and sum(len(p) for p in current_pages) + len(pages[j]) + 2 <= target_chars:
            current_pages.append(pages[j])
            j += 1
        current_end = current_start + len(current_pages) - 1
        chunks.append({
            "text": "\n\n".join(current_pages),
            "page_start": current_start,
            "page_end": current_end,
        })
        if j >= n:
            break
        # Overlap: the NEXT chunk's first page is THIS chunk's last page, so
        # the whole last page is seen by both. ``current_end`` is 1-based,
        # ``i`` is 0-based, so ``i = current_end - 1`` reuses the last page.
        # Guard against infinite loops on a single over-target page by
        # forcing at least one-step progress.
        i = max(i + 1, current_end - 1)
    return chunks


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
