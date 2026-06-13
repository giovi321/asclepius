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
from asclepius.pipeline.extraction_merge import merge_pair
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
    """Two-phase chunked extraction.

    Phase 1 runs ``llm.classify`` on the first chunk to nail down the
    universal fields (doc_type, patient, doctor, facility, dates,
    summary). Small models reliably hit a short schema when it's the
    only thing they're asked to produce; giving them the full
    classification + type-specific schema in one call caused qwen to
    zoom in on the loudest payload (say, the lab table) and drop the
    rest.

    Phase 2 runs the type-specific extractor on every chunk with the
    doc_type picked in Phase 1, then merges the per-chunk results.
    Lab results / medications / diagnoses that straddle page boundaries
    are deduped by ``merge_extractions``.

    All chunks are extracted in-memory first; we only write to the DB
    once at the end via ``extract_and_store(extraction_override=...)``.
    Truncated chunks bisect and retry without partial DB writes.
    """
    from asclepius.pipeline.extractor import (
        build_extraction_context,
        extract_and_store,
        _salvage_classification,
        _normalize_doc_type,
        _salvage_array_keys,
    )

    pages = await _load_pages(db, doc_id, ocr_text)
    chunks = _build_page_chunks(pages, _TARGET_CHUNK_CHARS)
    total_pages = len(pages)
    total_chunks = len(chunks)
    logger.info(
        "Doc %d: %d pages → %d chunks (page-aligned, last-page overlap)",
        doc_id,
        total_pages,
        total_chunks,
    )

    context = await build_extraction_context(db)

    # Phase 1 — classify on chunk 1. One cheap short-schema call; qwen
    # reliably hits this even on hardware that struggled with the full
    # 80-line combined schema.
    first = chunks[0]
    first_text = (
        _prepend_preamble(
            "\n\n".join(pages[first["page_start"] - 1 : first["page_end"]]),
            1,
            total_chunks,
            first["page_start"],
            first["page_end"],
            total_pages,
            overlaps_previous=False,
        )
        if total_chunks > 1
        else pages[0]
        if len(pages) == 1
        else "\n\n".join(pages[first["page_start"] - 1 : first["page_end"]])
    )
    try:
        classification = await llm.classify(first_text, context)
    except Exception:
        logger.exception(
            "Doc %d: classify call failed during chunked extraction",
            doc_id,
        )
        classification = {"error": "classification failed"}

    if "error" in classification:
        logger.error(
            "Doc %d: classification phase failed (%s), storing partial and giving up",
            doc_id,
            classification.get("error"),
        )
        return classification

    _salvage_classification(classification)
    doc_type = _normalize_doc_type(classification.get("doc_type", "other"))
    classification["doc_type"] = doc_type
    logger.info(
        "Doc %d chunked extraction: classified as %s, running type-specific extraction on %d chunks",
        doc_id,
        doc_type,
        total_chunks,
    )

    # Phase 2 — type-specific extraction per chunk, merged.
    merged: dict = dict(classification)
    any_truncated = False
    covered_pages: set[int] = set()

    for i, chunk in enumerate(chunks, start=1):
        logger.info(
            "Extracting chunk %d/%d for doc %d (pages %d-%d)",
            i,
            total_chunks,
            doc_id,
            chunk["page_start"],
            chunk["page_end"],
        )
        chunk_pages = pages[chunk["page_start"] - 1 : chunk["page_end"]]
        chunk_result, truncated = await _extract_type_chunk_with_bisect(
            llm,
            context,
            chunk_pages,
            doc_type,
            page_start=chunk["page_start"],
            chunk_index=i,
            total_chunks=total_chunks,
            total_pages=total_pages,
            overlaps_previous=(i > 1),
            doc_id=doc_id,
            db_path=config.database.path,
        )
        any_truncated = any_truncated or truncated
        if not chunk_result or "error" in chunk_result:
            continue
        # Per-chunk salvage (e.g. 'test_results' → 'lab_results') so the
        # merge below doesn't drop rows that arrived under a drifted key.
        _salvage_array_keys(chunk_result)
        merged = merge_extractions(merged, chunk_result)
        for p in range(chunk["page_start"], chunk["page_end"] + 1):
            covered_pages.add(p)

    # Coverage observability — makes missing-page issues visible in logs.
    # Runs after salvage so the counts match what actually gets stored.
    missing = [p for p in range(1, total_pages + 1) if p not in covered_pages]
    logger.info(
        "Doc %d chunked extraction: pages covered=%d/%d%s, "
        "lab_results=%d, medications=%d, diagnoses=%d%s",
        doc_id,
        len(covered_pages),
        total_pages,
        f" (missing {missing})" if missing else "",
        len(merged.get("lab_results") or []),
        len(merged.get("medications") or []),
        len(merged.get("diagnoses") or []),
        " [TRUNCATION DETECTED]" if any_truncated else "",
    )

    return await extract_and_store(
        db,
        llm,
        doc_id,
        ocr_text,
        config,
        extraction_override=merged,
    )


async def _extract_type_chunk_with_bisect(
    llm,
    context: dict,
    chunk_pages: list[str],
    doc_type: str,
    *,
    page_start: int,
    chunk_index: int,
    total_chunks: int,
    total_pages: int,
    overlaps_previous: bool,
    doc_id: int,
    db_path: str | None = None,
    _depth: int = 0,
) -> tuple[dict | None, bool]:
    """Run type-specific extraction on a chunk; bisect on truncation.

    Unlike the old single-phase helper this calls ``_extract_type_specific``
    with the classified doc_type, so the LLM sees a narrow schema
    (lab results only, or medications only, etc.) instead of the full
    classification+everything prompt. Small models are a lot happier
    with that.

    Returns (type_extraction, truncation_occurred). Depth capped at 2.
    """
    from asclepius.pipeline.extractor import _extract_type_specific

    if not chunk_pages:
        return None, False

    chunk_text = _prepend_preamble(
        "\n\n".join(chunk_pages),
        chunk_index,
        total_chunks,
        page_start,
        page_start + len(chunk_pages) - 1,
        total_pages,
        overlaps_previous=overlaps_previous,
    )
    try:
        result = await _extract_type_specific(
            llm,
            chunk_text,
            doc_type,
            context,
            db_path=db_path,
        )
    except Exception:
        logger.exception(
            "Chunk %d/%d type-specific extraction raised for doc %d (pages %d-%d)",
            chunk_index,
            total_chunks,
            doc_id,
            page_start,
            page_start + len(chunk_pages) - 1,
        )
        return None, False

    if not isinstance(result, dict):
        return None, False

    truncated = bool(result.get("_truncated") or result.get("_truncation_suspected"))
    if "error" in result and not truncated:
        logger.warning(
            "Chunk %d/%d type-specific extraction returned error for doc %d: %s",
            chunk_index,
            total_chunks,
            doc_id,
            result.get("error"),
        )
        return None, False

    if not truncated or len(chunk_pages) <= 1 or _depth >= 2:
        if truncated:
            logger.warning(
                "Doc %d chunk pages %d-%d: output truncated, kept partial "
                "(cannot bisect further: pages=%d, depth=%d)",
                doc_id,
                page_start,
                page_start + len(chunk_pages) - 1,
                len(chunk_pages),
                _depth,
            )
        return result, truncated

    mid = len(chunk_pages) // 2
    logger.warning(
        "Doc %d chunk pages %d-%d: output truncated — bisecting into " "pages %d-%d and %d-%d",
        doc_id,
        page_start,
        page_start + len(chunk_pages) - 1,
        page_start,
        page_start + mid - 1,
        page_start + mid,
        page_start + len(chunk_pages) - 1,
    )
    left, left_trunc = await _extract_type_chunk_with_bisect(
        llm,
        context,
        chunk_pages[:mid],
        doc_type,
        page_start=page_start,
        chunk_index=chunk_index,
        total_chunks=total_chunks,
        total_pages=total_pages,
        overlaps_previous=overlaps_previous,
        doc_id=doc_id,
        db_path=db_path,
        _depth=_depth + 1,
    )
    right, right_trunc = await _extract_type_chunk_with_bisect(
        llm,
        context,
        chunk_pages[mid:],
        doc_type,
        page_start=page_start + mid,
        chunk_index=chunk_index,
        total_chunks=total_chunks,
        total_pages=total_pages,
        overlaps_previous=False,
        doc_id=doc_id,
        db_path=db_path,
        _depth=_depth + 1,
    )
    combined: dict | None = None
    if left and "error" not in left:
        combined = left
    if right and "error" not in right:
        combined = right if combined is None else merge_extractions(combined, right)
    return combined, (left_trunc or right_trunc)


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
    db: aiosqlite.Connection,
    doc_id: int,
    ocr_text: str,
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
    pages: list[str],
    target_chars: int,
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
        chunks.append(
            {
                "text": "\n\n".join(current_pages),
                "page_start": current_start,
                "page_end": current_end,
            }
        )
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
    """Merge ``additional`` extraction results into ``base``, deduplicating.

    Thin wrapper over the canonical ``extraction_merge.merge_pair`` — the
    composite dedup keys this chunked path historically defined now live
    centrally in ``extraction_merge.ARRAY_DEDUP_KEYS`` and are shared by the
    section and vision paths too. Behaviour is unchanged for the chunked flow:
    only the array fields (and nested cost line items) are merged in place;
    every scalar/metadata field is left as ``base`` had it.
    """
    return merge_pair(base, additional)


# Threshold above which a document is chunked even when it's single-page or
# page boundaries aren't known. Kept well below the LLM input cap so output
# truncation is the binding constraint, not input.
_SINGLE_SHOT_CHAR_LIMIT = 8000


async def run_extraction(
    db: aiosqlite.Connection,
    llm,
    doc_id: int,
    ocr_text: str,
    config: AppConfig,
    file_path: str | None = None,
) -> dict:
    """Pick the right extraction strategy for a document and run it.

    Strategy order:
      1. Sectioning — only for large PDFs (``should_section`` returns True).
      2. Chunked extraction — whenever cached OCR has >1 page, or raw text
         exceeds the single-shot char limit. Tables that span pages, or long
         single pages, both benefit from the chunk merger.
      3. Single-shot ``classify_and_extract`` — short, single-page docs.
    """
    from asclepius.pipeline.extractor import classify_and_extract

    cached_pages = await load_cached_ocr_pages(db, doc_id)
    page_count = len(cached_pages) if cached_pages else None

    # 1. Sectioning — only meaningful when we have a file on disk.
    if file_path:
        try:
            from asclepius.pipeline.section_processor import should_section

            if await should_section(file_path):
                return await _run_sectioning(
                    db,
                    llm,
                    doc_id,
                    ocr_text,
                    config,
                    file_path,
                    cached_pages=cached_pages,
                )
        except Exception:
            logger.exception(
                "Sectioning check failed for doc %d, continuing with chunking",
                doc_id,
            )

    # 2. Chunking — multi-page OR long single-page.
    if (page_count and page_count > 1) or len(ocr_text) > _SINGLE_SHOT_CHAR_LIMIT:
        logger.info(
            "Doc %d: routing through chunked extraction (pages=%s, chars=%d)",
            doc_id,
            page_count,
            len(ocr_text),
        )
        return await chunked_extract_and_store(db, llm, doc_id, ocr_text, config)

    # 3. Single-shot.
    logger.info(
        "Doc %d: routing through single-shot extraction (pages=%s, chars=%d)",
        doc_id,
        page_count or 1,
        len(ocr_text),
    )
    return await classify_and_extract(db, llm, doc_id, ocr_text, config)


async def _run_sectioning(
    db: aiosqlite.Connection,
    llm,
    doc_id: int,
    ocr_text: str,
    config: AppConfig,
    file_path: str,
    cached_pages: list[str] | None,
) -> dict:
    """Run page-level sectioning on a large document. Falls back to chunked
    extraction if sectioning itself fails."""
    from asclepius.pipeline.extractor import build_extraction_context, extract_and_store
    from asclepius.pipeline.section_processor import process_with_sections

    ocr_pages = cached_pages
    if not ocr_pages:
        normalised = ocr_text.replace("\r\n", "\n").strip()
        if "\n\n" in normalised:
            ocr_pages = [p for p in normalised.split("\n\n") if p.strip()]
        else:
            ocr_pages = [normalised]

    try:
        section_extraction = await process_with_sections(
            db,
            llm,
            doc_id,
            file_path,
            ocr_pages,
            config,
        )
    except Exception:
        logger.exception(
            "Sectioning failed for doc %d, falling back to chunked extraction",
            doc_id,
        )
        return await chunked_extract_and_store(db, llm, doc_id, ocr_text, config)

    if section_extraction is None:
        return await chunked_extract_and_store(db, llm, doc_id, ocr_text, config)

    context = await build_extraction_context(db)
    try:
        classification = await llm.classify(ocr_text[:5000], context)
    except Exception:
        classification = {"error": "classification failed"}

    if "error" in classification:
        merged = section_extraction
    else:
        merged = {**classification, **section_extraction}

    return await extract_and_store(
        db,
        llm,
        doc_id,
        ocr_text,
        config,
        extraction_override=merged,
    )
