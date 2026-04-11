# Search

## Full-Text Search

Asclepius uses SQLite FTS5 for fast, ranked full-text search across:

- **OCR text** -- the raw text extracted from documents
- **Raw extraction data** -- the JSON output from LLM extraction

## Usage

1. Go to **Search** in the sidebar
2. Type your search query
3. Results are ranked by relevance and show matching document metadata

## How It Works

The search uses a fuzzy LIKE query across multiple fields, searching:

- OCR text content
- Document summaries
- Doctor and facility names
- Document types
- Tags and notes

Results show:

- Document title / filename
- Document type and date
- Patient name
- Matching text snippet (highlighted)
- Link to the full document detail page

## Search Tips

- Search is case-insensitive
- Use specific medical terms for more precise results (e.g., "hemoglobin" rather than "blood test")
- Patient context is applied automatically when a patient is selected in the sidebar
- Results include documents across all patients you have access to when no patient is selected

## FTS5 Index

The FTS5 virtual table `documents_fts` indexes:

- `ocr_text` -- full OCR output
- `raw_extraction` -- JSON extraction results

The index is kept in sync automatically via database triggers on insert, update, and delete operations on the `documents` table.
