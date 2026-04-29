---
title: "First Steps"
---

After [installation](./installation.md), the first-launch **setup wizard**
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
into `vault/inbox/`. The watcher picks them up within a few seconds
(configurable via `pipeline.poll_interval_seconds`). Supported formats:
PDF, PNG / JPG / TIFF, DICOM.

## 3. Watch it process

The Dashboard shows pipeline status, queue depth, and recent errors. Each
document moves through OCR → LLM extraction → organizing. For multi-page
PDFs you may also see chunked extraction (>1 page or >8k chars), page
classification, and section extraction.

## Next steps

- [OIDC / SSO setup](../admin-guide/user-management.md) for enterprise auth
- [LLM and OCR settings](../admin-guide/llm-configuration.md) for
  extraction quality
- [Custom prompts](../admin-guide/llm-configuration.md#custom-prompts)
- [Normalization](../user-guide/normalization.md) for cross-language
  consistency
- [Automated backups](../admin-guide/backup-restore.md)
