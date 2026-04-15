"""Per-page OCR text caching for pipeline processing."""

import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def cache_ocr_pages(
    db: aiosqlite.Connection, doc_id: int, ocr_text: str, engine: str, confidence: float
) -> None:
    """Cache per-page OCR text for a document."""
    if not ocr_text or not ocr_text.strip():
        return

    # Split by page separator (LLM vision uses \n\n)
    if "\n\n" in ocr_text:
        pages = ocr_text.split("\n\n")
    else:
        pages = [ocr_text]

    # Clear old cache
    await db.execute("DELETE FROM ocr_page_cache WHERE document_id = ?", (doc_id,))

    for i, page_text in enumerate(pages, start=1):
        if page_text.strip():
            await db.execute(
                """INSERT OR REPLACE INTO ocr_page_cache
                   (document_id, page_number, ocr_text, ocr_engine, confidence)
                   VALUES (?, ?, ?, ?, ?)""",
                (doc_id, i, page_text.strip(), engine, confidence),
            )
    await db.commit()
    logger.debug("Cached %d OCR pages for doc %d", len(pages), doc_id)


async def load_cached_ocr_pages(db: aiosqlite.Connection, doc_id: int) -> list[str] | None:
    """Load cached per-page OCR text. Returns None if no cache exists."""
    cursor = await db.execute(
        "SELECT ocr_text FROM ocr_page_cache WHERE document_id = ? ORDER BY page_number",
        (doc_id,),
    )
    rows = await cursor.fetchall()
    if not rows:
        return None
    return [row[0] for row in rows]
