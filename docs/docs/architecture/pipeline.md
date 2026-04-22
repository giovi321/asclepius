# Processing Pipeline

The pipeline is the ingestion engine. It watches the inbox folder, sends each file through OCR and LLM extraction, and files the result into the vault.

<iframe src="../../assets/diagrams/pipeline.html" width="100%" height="850" style="border:0;border-radius:8px;" title="Pipeline flow"></iframe>

`pipeline.default_flow` decides which branch a **new upload** takes (`ocr_llm` or `vision_llm`). For **existing** documents, the Reprocess menu on the document page overrides the flow per-document (OCR+LLM, OCR only, LLM only, or Vision-LLM). Initial ingest and reprocess both run through the same `run_extraction()` strategy picker, so a 3-page blood test gets the same sectioning, chunking, or single-shot decision regardless of when it lands.

## File Watcher

The pipeline uses `watchdog` to monitor the `vault/inbox/` directory for new files. When a file appears:

1. It is added to a **priority queue** sorted by file size (smallest first)
2. The queue is processed sequentially (one file at a time)
3. Processing status is tracked in memory and visible on the Dashboard

Configuration:

| Setting | Default | Description |
|---------|---------|-------------|
| `pipeline.watch_enabled` | `true` | Enable/disable the file watcher |
| `pipeline.poll_interval_seconds` | `5` | How often to check for new files |
| `pipeline.retry_interval_seconds` | `300` | Wait before retrying failed extractions |
| `pipeline.max_retries` | `3` | Maximum retry attempts |

## Patient Assignment

Documents can be pre-assigned to a patient in two ways:

1. **Upload via web UI** -- selecting a patient during upload writes a `.patient_hint` file alongside the document
2. **Hint file** -- a file named `document.pdf.patient_hint` containing the patient ID (a single integer)

The pipeline reads and deletes the hint file during processing, then sets the `patient_id` on the document record.

## OCR Phase

OCR providers are configured as an ordered list in Settings. The pipeline tries each enabled provider in **priority order**, falling back to the next if a provider returns empty text or fails. All engines return `(text, confidence, provider_name)`.

The `provider_name` stored in the database is the user-configured display name (e.g., "My Remote OCR") rather than the technical engine type.

### Provider Fallback Chain

1. Try provider at priority 1
2. If empty text or error → try priority 2
3. Continue until text is extracted or all providers exhausted
4. If all fail → mark document as `needs_review`

### Tesseract (Local)

1. For PDFs: try embedded text first (from digital PDFs)
2. If embedded text is insufficient (<50 chars): render pages at 300 DPI and OCR each page
3. Calculate per-page confidence from Tesseract's word-level confidence scores
4. For large documents (>20 pages): progress tracking per page

### LLM Vision

1. Render each PDF page as a JPEG image (150 DPI, auto-downscale if >4.5MB)
2. Send each page image to the LLM (Claude, OpenAI, or Ollama with vision model)
3. LLM transcribes all visible text, preserving structure
4. Transient failures (ReadTimeout, ConnectError, HTTP 429/5xx) retry with per-credential backoff (defaults to `[30, 60, 120]` seconds, configurable via `CredentialEntry.max_retries` / `retry_backoff_seconds`)
5. Per-page calls are serialized through a process-wide gate keyed by `(credential, kind)` so OCR and LLM traffic to the same endpoint never exceed the credential's configured `max_concurrent`
6. Can use a **separate** provider/model/URL from the extraction LLM

### Remote Tesseract

1. Send the entire file to a remote Tesseract server via HTTP POST
2. Server returns `{"text": "...", "confidence": 0.95}`
3. Falls back to local Tesseract if the remote server fails

### Google Cloud Vision

Uses the Google Cloud Vision API for OCR. Requires an API key.

## Vision-LLM Flow (alternative to OCR + LLM)

When `pipeline.default_flow` is `vision_llm`, or the Reprocess menu is set to **Vision-LLM**, the pipeline takes a different path that **skips the OCR and the LLM-classification steps** entirely. Each page image is sent directly to a vision-capable LLM with a combined read-and-classify prompt. The model returns a single JSON document containing both `ocr_text` and all classification/universal fields (doc_type, dates, doctor, facility, summary).

1. Iterate `vision.providers[]` in priority order; fall through to the next provider on failure.
2. For each PDF page (or the single image), render to JPEG and send to the chosen provider (Ollama / Claude / OpenAI). Image dimensions are aligned to a 28-pixel patch grid and capped below the model's `max_pixels` budget (e.g. `qwen2.5-vl`) so the server never silently rescales.
3. Parse the JSON response; merge extractions across pages (first non-null value per key wins).
4. Persist `ocr_text` + set `ocr_engine = vision_llm:<provider name>` on the document.
5. Run **Phase 2 type-specific extraction** on the vision-produced OCR text using the same provider selected for vision. Lab results, medications, and diagnoses are populated even though classification came from the vision prompt.
6. Call `extract_and_store` with the merged result as the override.

Retries on transient failures are controlled per-credential (`max_retries`, `retry_backoff_seconds`). Per-page vision calls share the same `(credential, kind)` gate as OCR, so vision traffic respects the credential's configured concurrency cap.

**Advantages:** single model pull, no model swapping, and the model sees visual layout cues (bold headers, table grids, letterhead positioning, signatures) that OCR strips away.

**Best for:** Documents where OCR quality is poor, or when you'd rather not maintain separate OCR + text-LLM stacks.

**Recommended local model:** `qwen2.5vl:7b` (~6 GB VRAM) on Ollama. See [LLM & OCR Configuration](../admin-guide/llm-configuration.md#vision-llm-providers) for the full size-vs-VRAM matrix.

## Two-Phase Extraction

After OCR, the extracted text is sent to the LLM in two phases:

### Retrieval-Augmented Extraction (Few-Shot Examples)

Before classification, the pipeline searches for **similar previously-processed documents** to use as few-shot examples in the prompt. This improves extraction quality, especially for smaller models like qwen2.5.

**Example selection priority:**

1. Documents with user corrections from the same facility (highest quality, human-verified)
2. Documents with user corrections from any facility
3. Completed documents from the same facility
4. FTS5 text similarity search (BM25 ranking on OCR text)

The system injects 1-2 compact examples (500-char OCR snippet + extraction result) into the classification prompt. If user corrections exist for an example document, the corrected values are used instead of the raw LLM output.

Facility detection happens heuristically by matching known facility names against the first 500 characters of OCR text (the letterhead area).

### Phase 1: Classification

A single prompt classifies the document and extracts basic metadata. The prompt is structured with the document content first, few-shot examples in the middle, and the JSON schema last (recency bias helps smaller models follow the schema).

- **Document type** (bloodtest, specialist_report, prescription, invoice, discharge, radiology_report, vaccination, surgical_report, and 15+ other types)
- **Patient name** (matched against existing patients)
- **Doctor name** (matched/created in the doctors table, with alias)
- **Facility name** (matched/created in the facilities table, with alias)
- **Dates** (doc_date, date_issued, date_visit)
- **Specialty** (normalized against the specialties table)
- **Summary** (English + source language)

When smaller LLMs return non-conforming JSON (e.g., using `responsible` instead of `doctor`), a salvage step attempts to map common alternative key names to the expected schema.

The LLM provider name and model used for extraction are stored on the document (visible under "Processing details" in the document view).

### Phase 2: Type-Specific Extraction

Based on the classified document type, a type-specific prompt extracts detailed structured data:

| Document Type | Extracted Data |
|--------------|----------------|
| `bloodtest` | Lab results (test name, value, unit, reference range, abnormal flag) |
| `specialist_report` | Encounters (diagnosis, findings, follow-up), medications |
| `prescription` | Medications (name, dosage, form, frequency, duration) |
| `invoice` | Invoice line items (description, amount, tariff code, category) |
| `discharge` | Encounters, medications, diagnoses, follow-up instructions |
| `radiology_report` | Imaging findings, diagnoses |
| `vaccination` | Vaccination records (vaccine, manufacturer, lot, dose number) |
| `surgical_report` | Encounters with operative details |

## Smart Page-Level Sectioning

For PDFs with more than **5 pages** (`should_section()`), the pipeline classifies pages individually and extracts each group with its own prompt instead of sending the whole document to a single extraction call.

<iframe src="../../assets/diagrams/smart-sectioning.html" width="100%" height="540" style="border:0;border-radius:8px;" title="Smart page-level sectioning"></iframe>

### Page Classification Types

| Type | Description |
|------|-------------|
| `lab_results_page` | Laboratory test results |
| `clinical_notes` | Doctor's clinical notes |
| `nursing_notes` | Nursing observations |
| `operative_notes` | Surgical operation details |
| `discharge_summary` | Discharge summary |
| `imaging_report` | Radiology/imaging report |
| `medication_chart` | Medication administration records |
| `vital_signs` | Vital signs monitoring |
| `consent_form` | Patient consent (skipped for extraction) |
| `cover_page` | Cover/title page (skipped for extraction) |
| `invoice_page` | Billing/invoice page |
| `correspondence` | Letters and correspondence |
| `other` | Unclassified content |

### Sectioning Process

1. **Page classification** -- Pages are sent in batches of 10 to the LLM for classification
2. **Grouping** -- Consecutive pages of the same type are merged into sections
3. **Per-section extraction** -- Each section is extracted using the appropriate type-specific prompt
4. **Section summary** -- Each section gets a brief English summary
5. **Aggregation** -- All section extractions are merged, deduplicating lab results, medications, etc.
6. **Document-level classification** -- A classification prompt runs on the first ~5000 characters for overall document metadata

Sections are stored in the `document_sections` table and are visible in the document detail page.

## Chunked Extraction

For documents that are not large enough for sectioning, chunking is triggered whenever the cached OCR has **more than one page** or the concatenated OCR text exceeds **8,000 characters**. This is deliberately aggressive: multi-page blood-test tables often fit well under the LLM's input cap but overflow its *output* cap, so later-page rows are silently dropped if sent as a single prompt.

### Page-aligned chunks

1. Pages are loaded from the `ocr_page_cache` table (populated during OCR).
2. Pages are greedily packed into chunks up to `_TARGET_CHUNK_CHARS` (~10k).
3. The **last page of each chunk is repeated as the first page of the next** chunk, so any table spanning a page boundary is visible in full to at least one chunk.
4. A preamble (`Chunk i of N, pages X-Y of Z, overlaps previous chunk`) is prepended so the LLM treats the text in context.

### Truncation-aware retry

Each chunk is extracted **in-memory**; the merged result is stored exactly once at the end. If a chunk response is flagged `_truncated` or `_truncation_suspected` and contains more than one page, the chunk is bisected into two halves and each half is retried (depth-capped at 2). The bisection path keeps writes idempotent because nothing hits the DB until all chunks have succeeded.

### Merging & logging

`merge_extractions` deduplicates by:

- `test_name_original` for lab results
- `brand_name + active_ingredient_original` for medications
- `diagnosis_original` for diagnoses
- `vaccine_name + date_administered` for vaccinations
- `description + amount` for invoice line items

After merging, a **page coverage** line is logged: `pages covered=N/total`, number of lab results/medications/diagnoses produced, and a `[TRUNCATION DETECTED]` tag if any chunk (even after bisection) still hit the output cap. Missing pages show up explicitly instead of being lost silently.

## Cancellation

Document processing can be cancelled at any time from the web UI:

- The API adds the document ID to an in-memory `cancelled_docs` set
- The pipeline checks this set between each processing step (OCR, LLM, organizing)
- If a cancellation is detected, the document status is set to `cancelled` and processing stops

## Name Normalization

During extraction, doctor and facility names are normalized:

1. The LLM extracts raw names from the document
2. Names are slugified and matched against existing records
3. If a match is found, the existing record is reused
4. If no match is found, a new doctor/facility record is created
5. Document type names are also normalized against fuzzy alias tables

## Progress Tracking

The pipeline maintains an in-memory status dict visible via `GET /api/pipeline/status`:

```json
{
  "queue_depth": 2,
  "processing": "document.pdf",
  "processing_step": "llm_extraction",
  "processing_doc_id": 42,
  "processing_pages": 15,
  "processing_page_current": 7,
  "last_processed": "previous.pdf",
  "total_processed": 128,
  "total_errors": 3,
  "recent_errors": [],
  "queued_files": [
    {"filename": "next.pdf", "size": 1234567}
  ]
}
```

## Runtime Pipeline Control

The pipeline can be started and stopped at runtime from the Settings UI without restarting the application:

- **Start/Stop buttons** in Settings > Pipeline tab
- `POST /api/pipeline/start` and `POST /api/pipeline/stop` endpoints (admin only)
- Toggling `pipeline_watch_enabled` in settings also starts/stops the pipeline immediately

### Auto-Stop on Provider Failures

If the pipeline encounters **5 consecutive provider connectivity failures** (connection refused, timeout, HTTP 5xx), it automatically pauses and sets an `auto_stopped` flag. A warning banner appears in the Settings UI with a "Restart" button.

Only connectivity errors trigger auto-stop. Document-specific extraction failures (malformed content, unsupported format) do not.

### Extraction Validation

After LLM extraction, the pipeline validates that at least one meaningful field was produced (doc_type, summary, dates, lab results, medications, or diagnoses). If the extraction is completely empty, the document is marked `needs_review` with the error message "LLM extraction returned empty results" instead of being silently marked as `done`.

## Correction-Driven Learning

When users manually edit document metadata (doc_type, dates, doctor name, facility name, summary, etc.) through the web UI or the AI Edit feature, the system captures these corrections as training signals.

Each correction records:

- **Document ID** -- which document was corrected
- **Field name** -- which field was changed (e.g. `doctor_name`, `doc_type`)
- **LLM value** -- what the LLM originally extracted (from `raw_extraction`)
- **Corrected value** -- what the user set
- **Facility ID and doc type** -- denormalized for fast lookup by facility/type

These corrections serve two purposes:

1. **Few-shot example quality** -- Documents with corrections are preferred as few-shot examples in retrieval-augmented extraction, since they represent human-verified ground truth
2. **Learning signal** -- Corrections from the same facility are especially valuable, as documents from the same source share the same layout and formatting patterns

Corrections are logged transparently; no UI changes needed. The system compares each edit against the original `raw_extraction` JSON and only logs fields that actually differ from what the LLM produced.
