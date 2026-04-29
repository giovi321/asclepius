"""Smart page-level document sectioning for multi-page documents."""

import json
import logging
import re
from pathlib import Path

import aiosqlite
import fitz  # pymupdf

from asclepius.config import AppConfig
from asclepius.llm.base import LLMProvider
from asclepius.pipeline.text_utils import _ALT_OR_LABEL, _HTML_TAG

logger = logging.getLogger(__name__)

# Threshold: documents with more pages than this get sectioned
SECTION_THRESHOLD = 5

# Vision-LLM emits structured DOM-like output ("<div data-bbox=...>") to
# preserve layout. That's helpful upstream but not as a human-readable summary,
# so the fallback summarizer pulls out the semantic ``alt=`` / ``data-label=``
# values and strips the rest of the markup.


def _strip_markup_for_summary(text: str) -> str:
    """Return a clean, text-only summary fragment suitable for storage in
    ``document_sections.summary_en``.

    Pulls semantic alt / data-label values to the front so the user sees
    "Hospital logo featuring..." rather than the raw ``<img alt="...">`` HTML.
    Leaves plain-text input untouched (regex no-ops when there are no tags).
    """
    if not text or "<" not in text:
        return text.strip() if text else ""
    semantic = " ".join(m.group(1).strip() for m in _ALT_OR_LABEL.finditer(text))
    stripped = _HTML_TAG.sub(" ", text)
    combined = (semantic + " " + stripped).strip()
    return re.sub(r"\s+", " ", combined)


async def should_section(file_path: str) -> bool:
    """Check if a document should be processed with page-level sectioning."""
    path = Path(file_path)
    if path.suffix.lower() != ".pdf":
        return False
    try:
        doc = fitz.open(str(path))
        count = len(doc)
        doc.close()
        return count > SECTION_THRESHOLD
    except Exception:
        return False


async def process_with_sections(
    db: aiosqlite.Connection,
    llm: LLMProvider,
    doc_id: int,
    file_path: str,
    ocr_pages: list[str],  # OCR text per page (already extracted)
    config: AppConfig,
) -> dict:
    """Process a multi-page document with smart page-level sectioning.

    Steps:
    1. Classify each page
    2. Group consecutive pages of the same type into sections
    3. Extract data from each section using type-appropriate prompts
    4. Aggregate all extracted data
    """
    from asclepius.pipeline.processor import pipeline_status

    pipeline_status["processing_step"] = "page_classification"

    # Step 1: Classify pages
    # Send pages in batches of ~10 to avoid token limits
    page_classifications = []
    batch_size = 10

    for i in range(0, len(ocr_pages), batch_size):
        batch = ocr_pages[i : i + batch_size]
        pages_text = "\n".join(f"--- PAGE {i + j + 1} ---\n{text}" for j, text in enumerate(batch))

        from asclepius.llm.prompt_manager import get_prompt

        prompt_template = await get_prompt(config.database.path, "page_classification")
        prompt = prompt_template.format(pages_text=pages_text)

        if hasattr(llm, "_generate"):
            response = await llm._generate(prompt)
            result = llm._parse_json(response)
        else:
            result = {"pages": []}

        for p in result.get("pages", []):
            page_classifications.append(p)

    # Fill in any missing pages with 'other'
    classified = {}
    for p in page_classifications:
        classified[p.get("page", 0)] = p.get("type", "other")

    for pg in range(1, len(ocr_pages) + 1):
        if pg not in classified:
            classified[pg] = "other"

    logger.info(
        "Page classifications for doc %d: %s",
        doc_id,
        {pg: classified[pg] for pg in sorted(classified.keys())},
    )

    # Step 2: Group consecutive pages of the same type into sections
    sections = []
    current_type = None
    current_start = None
    current_pages = []

    for pg in range(1, len(ocr_pages) + 1):
        pg_type = classified.get(pg, "other")
        if pg_type == current_type:
            current_pages.append(ocr_pages[pg - 1])
        else:
            if current_type is not None:
                sections.append(
                    {
                        "type": current_type,
                        "page_start": current_start,
                        "page_end": pg - 1,
                        "text": "\n\n".join(current_pages),
                    }
                )
            current_type = pg_type
            current_start = pg
            current_pages = [ocr_pages[pg - 1]]

    # Don't forget the last section
    if current_type is not None:
        sections.append(
            {
                "type": current_type,
                "page_start": current_start,
                "page_end": len(ocr_pages),
                "text": "\n\n".join(current_pages),
            }
        )

    logger.info(
        "Doc %d split into %d sections: %s",
        doc_id,
        len(sections),
        [(s["type"], f"pp.{s['page_start']}-{s['page_end']}") for s in sections],
    )

    # Step 3: Extract from each section
    pipeline_status["processing_step"] = "section_extraction"

    from asclepius.pipeline.extractor import (
        build_extraction_context,
        _extract_type_specific,
    )

    context = await build_extraction_context(db)

    # Map section types to extraction doc_types
    SECTION_TO_DOCTYPE = {
        "lab_results_page": "bloodtest",
        "clinical_notes": "specialist_report",
        "nursing_notes": "specialist_report",
        "operative_notes": "surgical_report",
        "discharge_summary": "discharge",
        "imaging_report": "radiology_report",
        "medication_chart": "prescription",
        "vital_signs": "specialist_report",
        "invoice_page": "invoice",
        "consent_form": None,  # Skip extraction
        "cover_page": None,  # Skip extraction
        "correspondence": "specialist_report",
        "other": None,
    }

    all_extractions = []

    for idx, section in enumerate(sections):
        section_type = section["type"]
        extraction_type = SECTION_TO_DOCTYPE.get(section_type)

        pipeline_status["processing_step"] = (
            f"extracting section {idx + 1}/{len(sections)} ({section_type})"
        )

        section_extraction = {}
        if extraction_type and section["text"].strip():
            try:
                section_extraction = await _extract_type_specific(
                    llm,
                    section["text"],
                    extraction_type,
                    context,
                    db_path=config.database.path,
                )
            except Exception:
                logger.exception(
                    "Failed to extract section %d (%s) of doc %d",
                    idx,
                    section_type,
                    doc_id,
                )

        # Generate a brief summary for the section (skip for large docs to save time)
        summary = ""
        if len(sections) <= 10 and section["text"].strip() and hasattr(llm, "_generate"):
            try:
                sum_prompt = (
                    "Summarize this medical document section in 1-2 sentences "
                    "in English:\n\n" + section["text"][:3000]
                )
                summary = await llm._generate(sum_prompt, force_json=False)
                summary = summary.strip()[:500]
            except Exception:
                pass
        elif section["text"].strip():
            # For large docs, just use first ~200 chars as a crude summary —
            # but strip vision-LLM markup first so we don't store raw
            # ``<div data-bbox=...>`` HTML in summary_en.
            cleaned = _strip_markup_for_summary(section["text"])
            summary = cleaned[:200].replace("\n", " ").strip()

        # Save section to DB
        await db.execute(
            """INSERT INTO document_sections
               (document_id, section_index, page_start, page_end, section_type,
                ocr_text, raw_extraction, summary_en)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                idx,
                section["page_start"],
                section["page_end"],
                section_type,
                section["text"],
                json.dumps(section_extraction),
                summary,
            ),
        )
        await db.commit()

        all_extractions.append(section_extraction)

    # Step 4: Aggregate all extractions into one merged result
    merged = _merge_section_extractions(all_extractions)

    return merged


def _merge_section_extractions(extractions: list[dict]) -> dict:
    """Merge multiple section extractions into one combined result."""
    merged: dict = {
        "lab_results": [],
        "diagnoses": [],
        "medications": [],
        "vaccinations": [],
        "encounter": {},
        "cost": {"line_items": []},
    }

    for ext in extractions:
        if not isinstance(ext, dict):
            continue

        for key in ("lab_results", "diagnoses", "medications", "vaccinations"):
            items = ext.get(key, [])
            if isinstance(items, list):
                merged[key].extend(items)

        # Merge encounter (keep the most detailed one)
        enc = ext.get("encounter", {})
        if isinstance(enc, dict) and enc.get("encounter_date"):
            if not merged["encounter"].get("encounter_date"):
                merged["encounter"] = enc

        # Merge cost
        cost = ext.get("cost", {})
        if isinstance(cost, dict):
            items = cost.get("line_items", [])
            if isinstance(items, list):
                merged["cost"]["line_items"].extend(items)
            if cost.get("total_amount") and not merged["cost"].get("total_amount"):
                merged["cost"]["total_amount"] = cost["total_amount"]
                merged["cost"]["currency"] = cost.get("currency")

    return merged
