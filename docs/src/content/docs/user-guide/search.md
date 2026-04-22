---
title: "Search"
---

## Full-text search

Asclepius uses SQLite FTS5 for ranked full-text search across:

- **OCR text** — the raw text extracted from documents
- **Raw extraction data** — the JSON output from LLM extraction

## Usage

1. Go to **Search** in the sidebar
2. Type your search query
3. Results are ranked by relevance and show matching document metadata

## How it works

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

## Search tips

- Search is case-insensitive
- Specific medical terms produce more precise results (e.g. "hemoglobin" rather than "blood test")
- Patient context is applied automatically when a patient is selected in the sidebar
- With no patient selected, results include every patient you have access to

## FTS5 index

The FTS5 virtual table `documents_fts` indexes:

- `ocr_text` -- full OCR output
- `raw_extraction` -- JSON extraction results

The index is kept in sync automatically via database triggers on insert, update, and delete operations on the `documents` table.
