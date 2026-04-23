"""Retrieval-augmented extraction — find similar documents as few-shot examples.

Searches for previously-processed documents that are similar to the current one
(by facility, doc type, or FTS5 text similarity) and formats them as examples
for the classification prompt. Prefers documents with user corrections since
those represent human-verified ground truth.
"""

import json
import logging
import re

import aiosqlite

logger = logging.getLogger(__name__)

# Compact subset of raw_extraction keys to include in examples
_EXAMPLE_KEYS = {
    "doc_type", "event_date", "issued_date",
    "doc_date", "date_issued", "date_visit",  # legacy keys from older extractions
    "language_detected", "doctor", "facility", "specialty", "summary_en",
}

# Common words to skip when building FTS5 search queries
_STOPWORDS = {
    "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "is",
    "it", "this", "that", "with", "from", "by", "as", "are", "was", "were",
    "be", "has", "have", "had", "not", "but", "if", "no", "all", "can", "will",
    "del", "di", "il", "la", "le", "lo", "un", "una", "per", "con", "che", "da",
    "der", "die", "das", "und", "von", "den", "dem", "ein", "eine", "mit", "ist",
    "null", "none", "true", "false",
}


def _extract_search_terms(ocr_text: str, max_terms: int = 5) -> list[str]:
    """Extract distinctive words from OCR text for FTS5 search."""
    # Take first 1000 chars — the header/letterhead is most distinctive
    snippet = ocr_text[:1000]
    words = re.findall(r"[a-zA-ZÀ-ÿ]{4,}", snippet)
    # Deduplicate, skip stopwords, prefer longer words (more distinctive)
    seen = set()
    candidates = []
    for w in words:
        lower = w.lower()
        if lower in _STOPWORDS or lower in seen:
            continue
        seen.add(lower)
        candidates.append(w)
    # Sort by length (longest first) and take top N
    candidates.sort(key=len, reverse=True)
    return candidates[:max_terms]


def _compact_extraction(raw: dict) -> dict:
    """Extract a compact subset of raw_extraction for use as an example."""
    result = {}
    for key in _EXAMPLE_KEYS:
        val = raw.get(key)
        if val is None:
            continue
        # For nested dicts (doctor, facility), keep only key fields
        if isinstance(val, dict):
            compact = {k: v for k, v in val.items() if v and k in ("name", "type", "original", "canonical")}
            if compact:
                result[key] = compact
        else:
            result[key] = val
    return result


def _apply_corrections(extraction: dict, corrections: list[dict]) -> dict:
    """Apply user corrections to an extraction dict, producing ground truth."""
    from asclepius.documents.corrections import CORRECTABLE_FIELDS

    result = dict(extraction)
    for corr in corrections:
        field = corr["field_name"]
        path = CORRECTABLE_FIELDS.get(field)
        if not path or corr["corrected_value"] is None:
            continue
        if len(path) == 1:
            result[path[0]] = corr["corrected_value"]
        elif len(path) == 2:
            parent = result.get(path[0])
            if not isinstance(parent, dict):
                parent = {}
                result[path[0]] = parent
            parent[path[1]] = corr["corrected_value"]
    return result


async def _detect_facility_id(db: aiosqlite.Connection, ocr_text: str) -> int | None:
    """Try to match a known facility from the first part of OCR text (letterhead area)."""
    header = ocr_text[:500].lower()
    cursor = await db.execute("SELECT id, name FROM facilities")
    for row in await cursor.fetchall():
        if row[1] and row[1].lower() in header:
            return row[0]
    return None


async def find_few_shot_examples(
    db: aiosqlite.Connection,
    ocr_text: str,
    current_doc_id: int | None = None,
    facility_id: int | None = None,
    limit: int = 2,
) -> list[dict]:
    """Find similar documents to use as few-shot examples in the classification prompt.

    Priority order:
    1. Documents with user corrections from the same facility
    2. Documents with user corrections for any facility
    3. Documents from the same facility with status='done'
    4. FTS5 text similarity fallback

    Returns list of {ocr_snippet, extraction} dicts.
    """
    # Try to detect facility from OCR text if not provided
    if not facility_id:
        facility_id = await _detect_facility_id(db, ocr_text)

    examples = []
    seen_ids: set[int] = set()
    if current_doc_id:
        seen_ids.add(current_doc_id)

    # Strategy 1: Corrected documents from same facility
    if facility_id and len(examples) < limit:
        cursor = await db.execute(
            """SELECT DISTINCT d.id, SUBSTR(d.ocr_text, 1, 500) AS snippet, d.raw_extraction
               FROM documents d
               JOIN extraction_corrections ec ON ec.document_id = d.id
               WHERE d.facility_id = ? AND d.status = 'done' AND d.raw_extraction IS NOT NULL
                     AND d.id NOT IN ({})
               ORDER BY d.updated_at DESC
               LIMIT ?""".format(",".join("?" * len(seen_ids)) if seen_ids else "-1"),
            (facility_id, *seen_ids, limit - len(examples)),
        )
        for row in await cursor.fetchall():
            if row[0] in seen_ids:
                continue
            seen_ids.add(row[0])
            raw = json.loads(row[2]) if isinstance(row[2], str) else row[2]
            # Fetch corrections for this doc
            corr_cursor = await db.execute(
                "SELECT field_name, corrected_value FROM extraction_corrections WHERE document_id = ?",
                (row[0],),
            )
            corrections = [{"field_name": r[0], "corrected_value": r[1]} for r in await corr_cursor.fetchall()]
            corrected = _apply_corrections(raw, corrections)
            examples.append({
                "ocr_snippet": row[1],
                "extraction": _compact_extraction(corrected),
                "has_corrections": True,
            })

    # Strategy 2: Corrected documents from any facility
    if len(examples) < limit:
        cursor = await db.execute(
            """SELECT DISTINCT d.id, SUBSTR(d.ocr_text, 1, 500) AS snippet, d.raw_extraction
               FROM documents d
               JOIN extraction_corrections ec ON ec.document_id = d.id
               WHERE d.status = 'done' AND d.raw_extraction IS NOT NULL
                     AND d.id NOT IN ({})
               ORDER BY d.updated_at DESC
               LIMIT ?""".format(",".join("?" * len(seen_ids)) if seen_ids else "-1"),
            (*seen_ids, limit - len(examples)),
        )
        for row in await cursor.fetchall():
            if row[0] in seen_ids:
                continue
            seen_ids.add(row[0])
            raw = json.loads(row[2]) if isinstance(row[2], str) else row[2]
            corr_cursor = await db.execute(
                "SELECT field_name, corrected_value FROM extraction_corrections WHERE document_id = ?",
                (row[0],),
            )
            corrections = [{"field_name": r[0], "corrected_value": r[1]} for r in await corr_cursor.fetchall()]
            corrected = _apply_corrections(raw, corrections)
            examples.append({
                "ocr_snippet": row[1],
                "extraction": _compact_extraction(corrected),
                "has_corrections": True,
            })

    # Strategy 3: Same facility, no corrections needed
    if facility_id and len(examples) < limit:
        cursor = await db.execute(
            """SELECT d.id, SUBSTR(d.ocr_text, 1, 500) AS snippet, d.raw_extraction
               FROM documents d
               WHERE d.facility_id = ? AND d.status = 'done' AND d.raw_extraction IS NOT NULL
                     AND d.id NOT IN ({})
               ORDER BY d.updated_at DESC
               LIMIT ?""".format(",".join("?" * len(seen_ids)) if seen_ids else "-1"),
            (facility_id, *seen_ids, limit - len(examples)),
        )
        for row in await cursor.fetchall():
            if row[0] in seen_ids:
                continue
            seen_ids.add(row[0])
            raw = json.loads(row[2]) if isinstance(row[2], str) else row[2]
            examples.append({
                "ocr_snippet": row[1],
                "extraction": _compact_extraction(raw),
                "has_corrections": False,
            })

    # Strategy 4: FTS5 text similarity
    if len(examples) < limit:
        terms = _extract_search_terms(ocr_text)
        if terms:
            fts_query = " OR ".join(f'"{t}"' for t in terms)
            try:
                exclude_clause = "AND d.id NOT IN ({})".format(",".join("?" * len(seen_ids))) if seen_ids else ""
                cursor = await db.execute(
                    f"""SELECT d.id, SUBSTR(d.ocr_text, 1, 500) AS snippet, d.raw_extraction
                       FROM documents_fts fts
                       JOIN documents d ON d.id = fts.rowid
                       WHERE documents_fts MATCH ? AND d.status = 'done' AND d.raw_extraction IS NOT NULL
                             {exclude_clause}
                       ORDER BY bm25(documents_fts)
                       LIMIT ?""",
                    (fts_query, *seen_ids, limit - len(examples)),
                )
                for row in await cursor.fetchall():
                    if row[0] in seen_ids:
                        continue
                    seen_ids.add(row[0])
                    raw = json.loads(row[2]) if isinstance(row[2], str) else row[2]
                    examples.append({
                        "ocr_snippet": row[1],
                        "extraction": _compact_extraction(raw),
                        "has_corrections": False,
                    })
            except Exception:
                logger.debug("FTS5 search failed (non-fatal)", exc_info=True)

    logger.info("Found %d few-shot examples for extraction (facility_id=%s)", len(examples), facility_id)
    return examples


def format_few_shot_examples(examples: list[dict]) -> str:
    """Format few-shot examples as a string to inject into the classification prompt."""
    if not examples:
        return ""

    parts = ["\nHere are examples of previously classified documents. Follow the same JSON format:\n"]
    for i, ex in enumerate(examples, 1):
        snippet = ex["ocr_snippet"].strip().replace("\n", " ")[:400]
        extraction_json = json.dumps(ex["extraction"], indent=2, ensure_ascii=False)
        parts.append(f"EXAMPLE {i}:")
        parts.append(f"Document text (excerpt): \"{snippet}...\"")
        parts.append(f"Correct classification:\n{extraction_json}\n")

    return "\n".join(parts)
