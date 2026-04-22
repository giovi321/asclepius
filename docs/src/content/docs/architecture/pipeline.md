---
title: "Processing Pipeline"
---

The pipeline is the ingestion engine. It watches the inbox folder, sends each file through OCR and LLM extraction, and files the result into the vault.

<div class="diagram-frame">
<svg viewBox="0 0 920 728" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Asclepius pipeline flow" style="display:block;width:100%;height:auto;max-width:100%;">
    <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.9" fill="rgba(28,25,23,0.10)"/>
      </pattern>
      <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#57534e"/>
      </marker>
      <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#8E4449"/>
      </marker>
    </defs>
    <rect width="100%" height="100%" fill="#efeee5"/>
    <rect width="100%" height="100%" fill="url(#dots)" opacity="0.6"/>
    <!-- ===== ARROWS ===== -->
    <!-- inbox -> hash -->
    <line x1="460" y1="92" x2="460" y2="120" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- hash -> dedup decision -->
    <line x1="460" y1="160" x2="460" y2="184" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- dedup -> skip (left) -->
    <line x1="408" y1="208" x2="304" y2="208" stroke="#57534e" stroke-width="1" stroke-dasharray="5,4" marker-end="url(#arrow)"/>
    <!-- dedup -> flow router (down) -->
    <line x1="460" y1="232" x2="460" y2="260" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- flow -> ocr (left branch) -->
    <line x1="408" y1="284" x2="220" y2="284" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <line x1="200" y1="296" x2="200" y2="324" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- flow -> vision (right branch) -->
    <line x1="512" y1="284" x2="700" y2="284" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-accent)"/>
    <line x1="720" y1="296" x2="720" y2="324" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-accent)"/>
    <!-- ocr providers -> ocr text gate -->
    <line x1="200" y1="396" x2="200" y2="420" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- vision providers -> merged result -->
    <line x1="720" y1="396" x2="720" y2="420" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-accent)"/>
    <!-- ocr -> chunk picker (right) -->
    <line x1="280" y1="448" x2="416" y2="488" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- vision -> chunk picker (left) -->
    <line x1="640" y1="448" x2="504" y2="488" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-accent)"/>
    <!-- chunk picker -> phase 1 -->
    <line x1="460" y1="540" x2="460" y2="568" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- phase1 -> phase2 -->
    <line x1="460" y1="604" x2="460" y2="628" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- phase2 -> store -->
    <line x1="460" y1="664" x2="460" y2="684" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-accent)"/>
    <!-- arrow labels — centered on each segment midpoint, sitting above the line -->
    <rect x="332" y="190" width="48" height="12" rx="2" fill="#efeee5"/>
    <text x="356" y="199" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">DUP HIT</text>
    <rect x="282" y="266" width="64" height="12" rx="2" fill="#efeee5"/>
    <text x="314" y="275" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">OCR_LLM</text>
    <rect x="566" y="266" width="80" height="12" rx="2" fill="#efeee5"/>
    <text x="606" y="275" font-family="'Geist Mono',monospace" font-size="8" fill="#8E4449" text-anchor="middle" letter-spacing="0.06em">VISION_LLM</text>
    <!-- ===== NODES ===== -->
    <!-- Start -->
    <rect x="376" y="60" width="168" height="32" rx="6" fill="#faf7f2"/>
    <rect x="376" y="60" width="168" height="32" rx="6" fill="rgba(87,83,78,0.10)" stroke="#78716c" stroke-width="1"/>
    <text x="460" y="80" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">File detected in inbox/</text>
    <!-- Hash -->
    <rect x="376" y="120" width="168" height="40" rx="6" fill="#faf7f2"/>
    <rect x="376" y="120" width="168" height="40" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <text x="460" y="140" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">SHA-256 + record</text>
    <text x="460" y="153" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">read .patient_hint</text>
    <!-- Dedup decision (diamond-ish via rounded rect) -->
    <polygon points="460,184 512,208 460,232 408,208" fill="#faf7f2"/>
    <polygon points="460,184 512,208 460,232 408,208" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <text x="460" y="212" font-family="'Geist',sans-serif" font-size="11" font-weight="600" fill="#1c1917" text-anchor="middle">duplicate?</text>
    <!-- Skip -->
    <rect x="160" y="192" width="144" height="32" rx="6" fill="#faf7f2"/>
    <rect x="160" y="192" width="144" height="32" rx="6" fill="rgba(28,25,23,0.02)" stroke="rgba(28,25,23,0.20)" stroke-width="1" stroke-dasharray="4,3"/>
    <text x="232" y="212" font-family="'Geist',sans-serif" font-size="11" fill="#57534e" text-anchor="middle">Skip — already processed</text>
    <!-- Flow router -->
    <polygon points="460,260 528,284 460,308 392,284" fill="#faf7f2"/>
    <polygon points="460,260 528,284 460,308 392,284" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <text x="460" y="282" font-family="'Geist',sans-serif" font-size="11" font-weight="600" fill="#1c1917" text-anchor="middle">default_flow</text>
    <text x="460" y="296" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">router</text>
    <!-- LEFT: OCR engines -->
    <rect x="120" y="324" width="160" height="72" rx="6" fill="#faf7f2"/>
    <rect x="120" y="324" width="160" height="72" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="128" y="332" width="40" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="148" y="341" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">OCR</text>
    <text x="200" y="362" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Provider chain</text>
    <text x="200" y="377" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">tesseract → remote →</text>
    <text x="200" y="389" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">llm-vision → gvision</text>
    <!-- RIGHT: Vision providers (focal) -->
    <rect x="640" y="324" width="160" height="72" rx="6" fill="#faf7f2"/>
    <rect x="640" y="324" width="160" height="72" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <rect x="648" y="332" width="56" height="12" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
    <text x="676" y="341" font-family="'Geist Mono',monospace" font-size="7" fill="#8E4449" text-anchor="middle" letter-spacing="0.08em">VISION</text>
    <text x="720" y="362" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Read + classify</text>
    <text x="720" y="377" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">qwen2.5-vl · claude</text>
    <text x="720" y="389" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">gpt-4o (vision)</text>
    <!-- ocr text node -->
    <rect x="120" y="420" width="160" height="32" rx="6" fill="#faf7f2"/>
    <rect x="120" y="420" width="160" height="32" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
    <text x="200" y="440" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">ocr_page_cache</text>
    <!-- vision merged -->
    <rect x="640" y="420" width="160" height="32" rx="6" fill="#faf7f2"/>
    <rect x="640" y="420" width="160" height="32" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
    <text x="720" y="440" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">merged JSON + OCR text</text>
    <!-- Chunk picker -->
    <rect x="376" y="488" width="168" height="52" rx="6" fill="#faf7f2"/>
    <rect x="376" y="488" width="168" height="52" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="384" y="494" width="60" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="414" y="503" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">STRATEGY</text>
    <text x="460" y="520" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">run_extraction()</text>
    <text x="460" y="534" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">section · chunk · single</text>
    <!-- Phase 1 -->
    <rect x="376" y="568" width="168" height="36" rx="6" fill="#faf7f2"/>
    <rect x="376" y="568" width="168" height="36" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <text x="460" y="585" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Phase 1 — classify</text>
    <text x="460" y="598" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">+ retrieval few-shot</text>
    <!-- Phase 2 -->
    <rect x="376" y="628" width="168" height="36" rx="6" fill="#faf7f2"/>
    <rect x="376" y="628" width="168" height="36" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <text x="460" y="645" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Phase 2 — type-specific</text>
    <text x="460" y="658" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">labs · meds · diagnoses</text>
    <!-- Store / organize -->
    <rect x="376" y="684" width="168" height="32" rx="6" fill="#faf7f2"/>
    <rect x="376" y="684" width="168" height="32" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <text x="460" y="704" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Store + organize file</text>
    <!-- ===== Side note (top-left empty band) ===== -->
    <text x="40" y="76" font-family="'Geist',sans-serif" font-size="13" fill="#57534e">Reprocessing reuses the same picker —</text>
    <text x="40" y="92" font-family="'Geist',sans-serif" font-size="13" fill="#57534e">section vs. chunk vs. single-shot is</text>
    <text x="40" y="108" font-family="'Geist',sans-serif" font-size="13" fill="#57534e">decided in exactly one place.</text>
  </svg>
</div>

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

<div class="diagram-frame">
<svg viewBox="0 0 920 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Smart sectioning flow" style="display:block;width:100%;height:auto;max-width:100%;">
    <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.9" fill="rgba(28,25,23,0.10)"/>
      </pattern>
      <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#57534e"/>
      </marker>
      <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#8E4449"/>
      </marker>
    </defs>
    <rect width="100%" height="100%" fill="#efeee5"/>
    <rect width="100%" height="100%" fill="url(#dots)" opacity="0.6"/>
    <!-- ===== Stage band labels ===== -->
    <text x="100" y="56" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.18em" fill="#78716c">1 · INPUT</text>
    <text x="280" y="56" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.18em" fill="#78716c">2 · PER-PAGE OCR</text>
    <text x="500" y="56" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.18em" fill="#78716c">3 · CLASSIFY + GROUP</text>
    <text x="760" y="56" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.18em" fill="#78716c">4 · MERGE</text>
    <!-- arrows -->
    <line x1="200" y1="160" x2="252" y2="160" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <line x1="436" y1="160" x2="488" y2="160" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <line x1="704" y1="160" x2="756" y2="160" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-accent)"/>
    <!-- ===== 1. Input ===== -->
    <rect x="60" y="120" width="140" height="80" rx="6" fill="#faf7f2"/>
    <rect x="60" y="120" width="140" height="80" rx="6" fill="rgba(87,83,78,0.10)" stroke="#78716c" stroke-width="1"/>
    <text x="130" y="148" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Multi-page PDF</text>
    <text x="130" y="166" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">page_count &gt; 5</text>
    <text x="130" y="180" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">should_section()</text>
    <!-- ===== 2. Per-page OCR (a small page-stack) ===== -->
    <g>
      <rect x="252" y="124" width="180" height="92" rx="6" fill="#faf7f2"/>
      <rect x="252" y="124" width="180" height="92" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
      <rect x="260" y="132" width="48" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
      <text x="284" y="141" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">OCR</text>
      <!-- mini "page" tiles -->
      <rect x="268" y="156" width="20" height="28" rx="2" fill="rgba(28,25,23,0.05)" stroke="rgba(28,25,23,0.30)" stroke-width="0.8"/>
      <rect x="292" y="156" width="20" height="28" rx="2" fill="rgba(28,25,23,0.05)" stroke="rgba(28,25,23,0.30)" stroke-width="0.8"/>
      <rect x="316" y="156" width="20" height="28" rx="2" fill="rgba(28,25,23,0.05)" stroke="rgba(28,25,23,0.30)" stroke-width="0.8"/>
      <rect x="340" y="156" width="20" height="28" rx="2" fill="rgba(28,25,23,0.05)" stroke="rgba(28,25,23,0.30)" stroke-width="0.8"/>
      <text x="384" y="174" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">… N</text>
      <text x="342" y="206" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">cached in ocr_page_cache</text>
    </g>
    <!-- ===== 3. Classify + group (page tiles colored by type) ===== -->
    <g>
      <rect x="488" y="124" width="216" height="92" rx="6" fill="#faf7f2"/>
      <rect x="488" y="124" width="216" height="92" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
      <rect x="496" y="132" width="64" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
      <text x="528" y="141" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">CLASSIFY</text>
      <!-- coloured page tiles → grouped sections -->
      <rect x="500" y="156" width="20" height="28" rx="2" fill="rgba(142,68,73,0.20)" stroke="#8E4449" stroke-width="0.8"/>
      <rect x="524" y="156" width="20" height="28" rx="2" fill="rgba(142,68,73,0.20)" stroke="#8E4449" stroke-width="0.8"/>
      <rect x="548" y="156" width="20" height="28" rx="2" fill="rgba(28,25,23,0.10)" stroke="#57534e" stroke-width="0.8"/>
      <rect x="572" y="156" width="20" height="28" rx="2" fill="rgba(28,25,23,0.10)" stroke="#57534e" stroke-width="0.8"/>
      <rect x="596" y="156" width="20" height="28" rx="2" fill="rgba(28,25,23,0.10)" stroke="#57534e" stroke-width="0.8"/>
      <rect x="620" y="156" width="20" height="28" rx="2" fill="rgba(120,113,108,0.20)" stroke="#78716c" stroke-width="0.8"/>
      <rect x="644" y="156" width="20" height="28" rx="2" fill="rgba(120,113,108,0.20)" stroke="#78716c" stroke-width="0.8"/>
      <text x="676" y="174" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">…</text>
      <text x="596" y="206" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">batches of 10 → group consecutive same-type</text>
    </g>
    <!-- ===== 4. Merge (focal) ===== -->
    <rect x="756" y="120" width="124" height="80" rx="6" fill="#faf7f2"/>
    <rect x="756" y="120" width="124" height="80" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <text x="818" y="148" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Merge</text>
    <text x="818" y="166" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">dedup labs · meds</text>
    <text x="818" y="180" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">diagnoses · vaccines</text>
    <!-- ===== Legend strip ===== -->
    <line x1="60" y1="252" x2="900" y2="252" stroke="rgba(28,25,23,0.10)" stroke-width="0.8"/>
    <text x="60" y="270" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.14em" fill="#57534e">PAGE TYPES</text>
    <rect x="180" y="262" width="14" height="10" rx="2" fill="rgba(142,68,73,0.20)" stroke="#8E4449" stroke-width="0.8"/>
    <text x="200" y="271" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">lab_results_page</text>
    <rect x="320" y="262" width="14" height="10" rx="2" fill="rgba(28,25,23,0.10)" stroke="#57534e" stroke-width="0.8"/>
    <text x="340" y="271" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">clinical_notes</text>
    <rect x="450" y="262" width="14" height="10" rx="2" fill="rgba(120,113,108,0.20)" stroke="#78716c" stroke-width="0.8"/>
    <text x="470" y="271" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">cover_page  (skipped)</text>
    <text x="60" y="312" font-family="'Geist',sans-serif" font-size="13" fill="#57534e">A discharge summary with cover, history, and lab tables ends up as 3 sections, not one wall of text.</text>
  </svg>
</div>

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

### Two phases per document

Chunked extraction runs the same two phases as the non-chunked path, but with Phase 2 repeated per chunk and merged:

1. **Phase 1 — classify on chunk 1.** A short-schema call that captures universal fields (doc_type, patient, doctor, facility, dates, summary, language). Keeping it separate means small models only have to fit one concern in working memory at a time — the reason qwen2.5:14b reliably returns these fields now instead of zooming in on the loudest section (lab table) and dropping everything else.
2. **Phase 2 — type-specific extraction per chunk.** Runs the prompt for the doc_type picked in Phase 1 (e.g. `bloodtest` → lab-results-only schema). Each chunk produces its own extraction; `merge_extractions` dedupes overlap.

### Page-aligned chunks

1. Pages are loaded from the `ocr_page_cache` table (populated during OCR).
2. Pages are greedily packed into chunks up to `_TARGET_CHUNK_CHARS` (~10k).
3. The **last page of each chunk is repeated as the first page of the next** chunk, so any table spanning a page boundary is visible in full to at least one chunk.
4. A preamble (`Chunk i of N, pages X-Y of Z, overlaps previous chunk`) is prepended so the LLM treats the text in context.

### Truncation-aware retry

Each chunk is extracted **in-memory**; the merged result is stored exactly once at the end. If a chunk response is flagged `_truncated` or `_truncation_suspected` and contains more than one page, the chunk is bisected into two halves and each half is retried (depth-capped at 2). The bisection path keeps writes idempotent because nothing hits the DB until all chunks have succeeded.

Small models can also self-truncate mid-JSON well before the token cap is reached — the JSON parser detects an unclosed structure and flags the response as truncated, which feeds the same bisection loop. So "one chunk" on the first attempt often becomes "two single-page halves" on retry, and both finish cleanly.

### Merging & logging

`merge_extractions` deduplicates by:

- `test_name_original` for lab results
- `brand_name + active_ingredient_original` for medications
- `diagnosis_original` for diagnoses
- `vaccine_name + date_administered` for vaccinations
- `description + amount` for invoice line items

After merging, a **page coverage** line is logged: `pages covered=N/total`, number of lab results/medications/diagnoses produced, and a `[TRUNCATION DETECTED]` tag if any chunk (even after bisection) still hit the output cap. Missing pages show up explicitly instead of being lost silently.

## Cancellation

Document processing can be cancelled at any time from the web UI. The Cancel button triggers two mechanisms at once (belt-and-braces):

1. **Hard cancel** — the pipeline keeps a registry of in-flight asyncio tasks keyed by `doc_id`. On cancel, the API calls `asyncio.Task.cancel()` on the registered task. This propagates `CancelledError` into whichever `await` the pipeline is parked on (typically the httpx POST to the LLM), aborts the HTTP connection, releases the credential gate slot via `async with` finalizers, and marks the document `cancelled`. The UI chip disappears within a second.
2. **Cooperative flag** — the API also adds the doc_id to an in-memory `cancelled_docs` set. Every phase boundary (before OCR, between OCR and LLM, after LLM) checks the set and exits early. This is the fallback for the rare case where the hard cancel can't interrupt the current await (e.g. C-level blocking syscall).

Before this was belt-and-braces, cancel was cooperative only: a mid-extraction click had to wait for the LLM to finish its current call before the pipeline would notice. Reprocess also didn't honour the flag at all. Both are fixed.

## Name Normalization

Everything that references a canonical table — lab tests, medications, diagnoses, specialties, doctors, facilities — is matched in Python after extraction, not inside the LLM prompt. The LLM emits the document's original wording; `asclepius.normalization.resolver` does the rest:

1. Exact case-insensitive match against the alias table.
2. Fuzzy match via `rapidfuzz.process.extractOne` (WRatio ≥ 85). Catches OCR drift and minor language variants.
3. Auto-create a new canonical row if nothing matches, with the original wording as `canonical_display` and as an `auto_mapped=1` alias for user review in the Normalization UI.

Doctors and facilities still go through their dedicated `_upsert_*` helpers (slug matching + alias-aware upsert), which predate the resolver but behave the same way.

Before this refactor the prompt carried every `(canonical_code, alias)` pair inline so the LLM could pick. On a real install that payload reached 437 kB and broke schema adherence on smaller models. Doing the match in Python cut the extraction prompt to ~15-20 kB and made qwen2.5:14b viable end-to-end.
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
