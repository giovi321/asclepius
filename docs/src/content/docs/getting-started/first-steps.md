---
title: "First Steps"
---

After [installation](./installation/), the first-launch **setup wizard**
creates your admin account and first patient and logs you in. After that,
three things matter before you can ingest documents.

## 1. Configure LLM & OCR

Open **Settings → Document Analysis → Providers** and add:

- **Credentials**, one per physical endpoint (Ollama server, Claude /
  OpenAI account). Each credential carries its URL, API key, concurrency
  cap, and retry policy.
- **LLM provider**, pointing at a credential and a model (e.g.
  `qwen2.5`, `claude-haiku-4-5-20251001`).
- **OCR provider(s)**, Tesseract (built-in, no credential), LLM Vision
  (vision model), Google Cloud Vision, or Tesseract Remote.
- **Vision-LLM provider** (optional), for the single-step vision flow.

The **Priority** sub-tab reorders providers for fallback.

## 2. Ingest a document

Upload via the Documents page (drag-and-drop or file picker) or drop files
into `vault/inbox/`. On a phone or tablet the drop area becomes a **Tap to
choose files** button, and a **Take photo** button lets you shoot a paper
report straight into the pipeline. The watcher picks up inbox files within a
few seconds (configurable via `pipeline.poll_interval_seconds`). Supported
formats: PDF, PNG / JPG / TIFF, DICOM.

## 3. Watch it process

The Dashboard's **Pipeline** card shows the live job: filename, kind
(Upload or Reprocess), flow type (OCR + LLM or Vision-LLM), a connected
stepper across the planned stages, a live elapsed-time clock, and a
shimmering page-progress bar during OCR. An "Up next" rail underneath
lists what's queued behind the running job. Each document moves through
OCR → LLM extraction → organizing in the default flow; the Vision-LLM
flow shortens that to Vision → LLM extraction → organizing.

The **document detail** page carries a per-doc *Pipeline stages* card
that shows every upload + reprocess this document has been through,
grouped by run, with durations, error messages, and outcome pills —
useful when comparing reprocesses or debugging a failure.

For multi-page PDFs you may also see chunked extraction (>1 page or
>8k chars), page classification, and section extraction surfaced as
their own stages.

## Next steps

- [OIDC / SSO setup](../admin-guide/user-management/) for enterprise auth
- [LLM and OCR settings](../admin-guide/llm-configuration/) for
  extraction quality
- [Custom prompts](../admin-guide/llm-configuration/#custom-prompts)
- [Normalization](../user-guide/normalization/) for cross-language
  consistency
- [Automated backups](../admin-guide/backup-restore/)
