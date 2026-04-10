# Search

## Full-Text Search

Asclepius uses SQLite FTS5 for fast, ranked full-text search across:

- OCR text from all documents
- Raw LLM extraction data

## How to Search

1. Go to the **Search** page or use the search filter on the Documents page
2. Enter your search terms
3. Results are ranked by relevance (BM25)

## Search Tips

- Use specific medical terms: `"cholesterol"`, `"hemoglobin"`, `"hypertension"`
- Search for provider names: `"Dr. House"`, `"Ospedale Zurigo"`
- Search works across languages (whatever is in the OCR text)
- Filter results by patient using the patient selector

## How It Works

The FTS5 virtual table indexes document OCR text and extraction data. When you search, SQLite performs full-text matching with BM25 ranking and returns results ordered by relevance.
