# LLM, OCR & Vision-LLM Configuration

## Overview

Asclepius supports two extraction flows and uses a **multi-provider priority system** for each one. For any flow, you configure one or more providers and set their order; the pipeline uses the highest-priority enabled provider and falls through to the next on failure.

The two flows are:

- **OCR + LLM** — extract text with an OCR engine, then send the text to a language model for classification and structured extraction. Uses `ocr.providers` + `llm.providers`.
- **Vision-LLM** — send page images straight to a vision-capable LLM that returns both the transcribed text and the structured extraction in a single call. Uses `vision.providers`.

Which flow runs for a **new upload** is controlled by `pipeline.default_flow` (Settings → Pipeline). On an **existing document** you can pick any flow on a per-document basis from the Reprocess menu (OCR+LLM, OCR only, LLM only, or Vision-LLM).

All provider configuration is done from **Settings** > **Document Analysis** in the web UI. That page has four sub-tabs:

- **Providers** — add/edit/reorder LLM, OCR, and Vision-LLM providers, and manage the **Credentials** they share.
- **Priority** — drag-to-reorder priority across the providers you've defined.
- **Prompts** — edit classification / extraction / vision / chat / page-classification prompts.
- **Normalization** — canonical mappings for doctors, facilities, lab tests, specialties, diagnoses, medications.

## Credentials

A **credential** is a shared connection (URL + API key) that multiple providers can reference by `credential_id`. One credential per physical endpoint — a single Ollama server, a single Anthropic account, a single OpenAI project. Any number of LLM / Vision-LLM / OCR entries can point at the same credential and pick up changes to the URL, API key, retry policy, or concurrency cap automatically.

Key fields (per credential):

| Field | Default | Description |
|-------|---------|-------------|
| `type` | `ollama` | One of `ollama`, `vllm`, `claude`, `openai`, `google_vision`, `tesseract_remote` |
| `base_url` | — | Only for self-hosted types (Ollama/vLLM/Tesseract-remote) |
| `api_key` | — | Only for cloud types (Claude / OpenAI / Google Vision) |
| `max_concurrent` | `2` | Process-wide concurrency cap for this credential. Every provider referencing this credential shares the same queue, split per **kind** (`llm` / `ocr` / `vision`). This matches how a single Ollama or Claude account actually behaves — one physical endpoint, one real concurrency limit. |
| `max_retries` | `3` | Retries on transient failures (ReadTimeout, ConnectError, HTTP 429/5xx) |
| `retry_backoff_seconds` | `[30, 60, 120]` | Sleep between successive attempts; last value reused if list is shorter than `max_retries` |

Concurrency is enforced by a process-wide gate keyed by `(credential, kind)`. The Dashboard shows a live chip for each active credential×kind pair, so you can see at a glance which model is currently talking to which endpoint and how many slots are in-flight / waiting.

!!! tip "Why per-credential instead of per-provider?"
    Two Ollama models on the same server compete for the same GPU. Setting a concurrency cap on each provider entry would let the physical server get overrun as soon as you enabled a second provider on it. A credential-scoped cap means adding a new model to an existing endpoint doesn't silently multiply load.

## Recommended stack

If you're setting up Asclepius for the first time and want a reasonable default, here's what we run. It fits on a single workstation with ~12 GB of VRAM and produces solid results on Italian and English medical documents.

### Local (self-hosted, via Ollama)

| Role           | Model                              | Ollama tag                                |
|----------------|------------------------------------|-------------------------------------------|
| OCR            | Chandra OCR                        | `fredrezones55/chandra-ocr-2`             |
| Text LLM       | Qwen 2.5                           | `qwen2.5`                                 |
| Vision-LLM     | Qwen 2.5-VL 7B                     | `qwen2.5vl:7b`                            |

This trio runs comfortably on a 12 GB VRAM GPU and extraction quality is good enough that most users won't need to reach for a cloud model. Pull them with:

```bash
ollama pull fredrezones55/chandra-ocr-2
ollama pull qwen2.5
ollama pull qwen2.5vl:7b
```

Wire them up under **Settings → Document Analysis → Providers**:

1. First, add a single **Credential** of type `ollama` pointing at your Ollama server URL (e.g. `http://ollama:11434`). `max_concurrent` of `1` is safest when a single GPU serves all three models.
2. Add an **OCR** provider (*LLM Vision* type) referencing that credential, model `fredrezones55/chandra-ocr-2`.
3. Add an **LLM** provider (*Ollama* type) referencing the same credential, model `qwen2.5`.
4. Add a **Vision-LLM** provider (*Ollama* type) referencing the same credential, model `qwen2.5vl:7b`.

Because all three share the same credential, your Ollama server is never asked to run more than one thing at a time.

### Cloud (Anthropic)

If you'd rather use a hosted model, or want a fallback for documents the local models struggle with, **Claude Haiku** works well both as the text LLM and as the Vision-LLM. It's fast, cheap, and handles the single-step image-to-JSON Vision-LLM flow cleanly. Add a single Claude credential (which holds your API key, retry policy, and concurrency cap for the Anthropic endpoint), then add two providers on top of it: one in the LLM section and one in the Vision-LLM section, both referencing the Claude credential. Set it as priority 1, or drop it to priority 2 as an escalation target behind the local stack.

## LLM providers

LLM providers handle document classification, data extraction, chat, and search.

### Supported providers

| Provider | Type | Description |
|----------|------|-------------|
| **Ollama** | `ollama` | Self-hosted LLM via Ollama. Free, runs locally. |
| **vLLM** | `vllm` | High-performance inference server (OpenAI-compatible API). |
| **Claude** | `claude` | Anthropic Claude API. Best extraction quality. |
| **OpenAI** | `openai` | OpenAI API (GPT-4o, etc.). |

### Adding a provider

1. Go to **Settings** > **Document Analysis** > **Providers** and scroll to the **LLM** section
2. Click **Add Provider**, pick the type, either select an existing credential or create a new one inline
3. Set the **model** (the credential already carries URL + API key) and optionally the timeout
4. Drag in the **Priority** sub-tab to reorder across all LLM providers (top = highest priority)
5. Click **Save Changes**

### Provider priority and escalation

Providers are ordered by priority. The pipeline uses **priority 1** (topmost enabled provider) by default. If you're not satisfied with extraction results for a document, you can re-analyze it with the next provider from the document detail page.

Example setup:
1. **Ollama** (llama3.1) -- fast, free, good for most documents
2. **Claude** (claude-sonnet) -- higher quality, used for complex or failed documents

### YAML configuration

Providers can also be configured in `settings.yaml`:

```yaml
credentials:
  - id: "cred-ollama-main"
    name: "Ollama (GPU box)"
    type: "ollama"
    base_url: "http://ollama:11434"
    max_concurrent: 1
    max_retries: 3
    retry_backoff_seconds: [30, 60, 120]
  - id: "cred-claude-1"
    name: "Claude"
    type: "claude"
    api_key: "sk-ant-..."
    max_concurrent: 4

llm:
  providers:
    - id: "ollama-1"
      type: "ollama"
      name: "Qwen on Ollama"
      enabled: true
      priority: 1
      credential_id: "cred-ollama-main"
      model: "qwen2.5"
      timeout: 120
    - id: "claude-1"
      type: "claude"
      name: "Claude Haiku"
      enabled: true
      priority: 2
      credential_id: "cred-claude-1"
      model: "claude-haiku-4-5-20251001"
      timeout: 120
  general:                    # LLM used for chat, auto-merge, auto-rename,
    credential_id: "cred-claude-1"  # link suggestion, event extraction, AI
    type: "claude"            # document edits. Leave credential_id empty to
    model: "claude-haiku-4-5-20251001"  # disable those features (they'll 503).
    timeout: 120
```

Legacy inline form (`base_url` + `api_key` directly on the provider, no `credential_id`) is still honoured for backwards compatibility — on startup, Asclepius synthesises a credential per unique (type, base_url, api_key) triple and rewrites `settings.yaml` to reference it.

### Recommended models

**Ollama:**
- `llama3.1` -- good balance of speed and quality
- `llama3.1:70b` -- better quality, requires more VRAM
- `qwen2.5` -- strong multilingual support

**Claude:**
- `claude-sonnet-4-20250514` -- best balance of cost and quality

**OpenAI:**
- `gpt-4o` -- strong general-purpose model
- `gpt-4o-mini` -- faster, cheaper, good for simple documents

**vLLM:**
- Any HuggingFace model served by vLLM (e.g. `meta-llama/Llama-3.1-8B-Instruct`)

## OCR providers

OCR providers extract text from scanned documents and images.

### Supported providers

| Provider | Type | Description |
|----------|------|-------------|
| **Tesseract (Local)** | `tesseract` | Local Tesseract OCR. Free, no network needed. |
| **Tesseract (Remote)** | `tesseract_remote` | Remote Tesseract server via HTTP API. |
| **LLM Vision** | `llm_vision` | Send page images to an LLM for OCR only — the text then flows into the normal LLM extraction step. |
| **Google Cloud Vision** | `google_vision` | Google Cloud Vision API. |

!!! note "Single-step vision extraction moved"
    The old `vision_extraction` OCR provider type has been promoted to its own flow. See [Vision-LLM Providers](#vision-llm-providers) below. Existing `vision_extraction` OCR entries are auto-migrated into `vision.providers[]` at startup.

### LLM Vision OCR

The LLM Vision OCR engine sends page images directly to an LLM for text extraction. It produces the best results on handwritten documents, poorly scanned pages, and complex mixed text/image layouts.

Vision OCR can use a different LLM provider and model than the extraction LLM — for example, Chandra for OCR plus llama3.1 for extraction.

#### Supported vision backends

- **Ollama** — use vision-capable models like `llava:13b`, `llama3.2-vision`, or `chandra-ocr-2`
- **Claude** — uses Claude's native vision capability
- **OpenAI** — uses GPT-4o vision

#### Chandra OCR

For the highest OCR quality, use Chandra OCR as the vision model:

1. Pull the model: `ollama pull fredrezones55/chandra-ocr-2`
2. Add an LLM Vision OCR provider
3. Set Vision LLM Provider to **Ollama**
4. Set Vision Model to `fredrezones55/chandra-ocr-2`

### YAML configuration

```yaml
ocr:
  providers:
    - id: "tesseract-1"
      type: "tesseract"
      name: "Tesseract (Local)"
      enabled: true
      priority: 1
      language: "eng+ita+deu"
      confidence_threshold: 0.7
      # Local Tesseract has no credential — leave credential_id empty.
    - id: "llm-vision-1"
      type: "llm_vision"
      name: "Chandra Vision OCR"
      enabled: true
      priority: 2
      credential_id: "cred-ollama-main"     # shared with LLM/Vision providers
      llm_provider: "ollama"
      llm_model: "fredrezones55/chandra-ocr-2"
```

Tesseract-remote and Google Vision entries also accept `credential_id` (pointing at a credential of type `tesseract_remote` / `google_vision`). The old inline `remote_url` / `google_vision_key` fields are kept for backward compat and auto-migrated on startup.

## Vision-LLM providers

Vision-LLM is an alternative to the OCR + text-LLM flow. Instead of running OCR and then passing the resulting text to a language model, each page image is sent directly to a vision-capable LLM that returns both the transcription and the structured extraction in a single call.

This is useful when:

- Your OCR engine struggles with dense tables, handwriting, or complex layouts.
- You want to run a single model end to end (one pull, one GPU footprint).
- You prefer to send images rather than the output of a lossy OCR step.

### Supported provider types

| Provider | Type | Notes |
|----------|------|-------|
| **Claude** | `claude` | Anthropic Claude with native vision |
| **OpenAI** | `openai` | GPT-4o / GPT-4 vision |
| **Ollama** | `ollama` | Local vision model (e.g. `qwen2.5vl:7b`, `llama3.2-vision`, `minicpm-v`) |

### Adding a vision provider

1. Pull a vision model (example for Ollama): `ollama pull qwen2.5vl:7b`.
2. Go to **Settings** > **Document Analysis** > **Providers** and scroll to the **Vision-LLM** section.
3. Click **Add Provider**, pick the type, either select an existing credential or create a new one inline.
4. Fill in the model name (the credential already supplies URL + API key).
5. Click **Test Connection** — a trivial image round-trip confirms the wiring.
6. Drag to reorder priority in the **Priority** sub-tab and **Save Changes**.

Asclepius also runs Phase 2 type-specific extraction after the vision call, reusing the same provider you selected for vision. That way Haiku-for-vision stays Haiku-for-extraction instead of silently falling back to the default text-LLM.

### Turning on the Vision-LLM flow

Vision providers alone don't change what new uploads do. To switch the default:

1. Go to **Settings** > **Pipeline**.
2. Set **Default Processing Flow** to **Vision-LLM**.

Per-document override stays available in the document detail page's Reprocess menu (OCR+LLM, OCR only, LLM only, Vision-LLM).

### Custom prompt

The vision prompt is editable under **Settings** > **Document Analysis** > **Prompts** with key `vision_extraction`. Keep the JSON schema intact — the pipeline parses the response into `ocr_text` plus classification fields.

### YAML configuration

```yaml
vision:
  extraction_timeout: 600            # Per-page timeout (seconds)
  providers:
    - id: "qwen25vl-1"
      type: "ollama"
      name: "Qwen2.5-VL"
      enabled: true
      priority: 1
      credential_id: "cred-ollama-main"
      model: "qwen2.5vl:7b"
      timeout: 600
    - id: "claude-vision-1"
      type: "claude"
      name: "Claude (vision fallback)"
      enabled: false
      priority: 2
      credential_id: "cred-claude-1"
      model: "claude-haiku-4-5-20251001"
      timeout: 600
```

Retries and concurrency aren't configured on `vision.*` itself — they live on the credential each vision provider references.

### Recommended local models

| VRAM       | Ollama tag          | Notes                                  |
|------------|---------------------|----------------------------------------|
| ≥ 48 GB    | `qwen2.5vl:72b`     | Best quality, slow on consumer hardware |
| 24 GB      | `qwen2.5vl:32b`     | Best quality / VRAM trade-off          |
| 12–16 GB   | `qwen2.5vl:7b`      | Recommended default                    |
| 8 GB       | `qwen2.5vl:3b`      | Only for clean typed documents         |

`qwen2.5:14b` is **text-only** — there is no 14B vision variant. `minicpm-v` (8B) is a solid alternative to `qwen2.5vl:7b` when OCR on noisy scans matters more than strict JSON adherence. Avoid `llama3.2-vision` for dense tables and strict JSON output.

## General LLM

The **General LLM** is a single model used for everything that isn't the document-analysis pipeline: chat, auto-merge suggestions, auto-rename, link suggestions, event extraction from document text, and AI document edits. It's configured separately from the priority list: one credential, one model, no fallback chain.

Set it under **Settings → Document Analysis → Providers → General LLM**, or in YAML:

```yaml
llm:
  general:
    credential_id: "cred-claude-1"
    type: "claude"
    model: "claude-haiku-4-5-20251001"
    timeout: 120
```

When `credential_id` is empty, all non-pipeline AI features return HTTP 503 with a clear error. This lets you run the pipeline without exposing chat/edit features if you want a read-only deployment.

## Timeouts

Each provider has its own timeout setting (on the provider entry, not the credential).

- LLM providers default to 120 seconds.
- Vision providers default to 600 seconds (vision calls are slow).

Increase the provider timeout for very large documents, slow inference servers, or large models. For LLM-vision OCR the effective timeout is never lower than 300 seconds regardless of the configured value. Retries and backoff come from the **credential**, so two providers on the same endpoint share a retry policy.

## Custom prompts

All LLM prompts are editable from **Settings** > **Document Analysis** > **Prompts**.

### Available prompts

| Key | Description |
|-----|-------------|
| `classification` | Phase 1: Document classification and basic metadata extraction |
| `vision_extraction` | Vision-LLM flow: single-step image → OCR + classification + metadata |
| `extraction_bloodtest` | Phase 2: Extract lab results from blood test documents |
| `extraction_specialist_report` | Phase 2: Extract diagnoses, encounters, medications |
| `extraction_prescription` | Phase 2: Extract medications from prescriptions |
| `extraction_invoice` | Phase 2: Extract cost and line items from invoices |
| `extraction_discharge` | Phase 2: Extract data from discharge letters |
| `extraction_radiology` | Phase 2: Extract findings from radiology reports |
| `extraction_vaccination` | Phase 2: Extract vaccination records |
| `document_edit` | AI-powered document metadata editing |
| `sql_generation` | Chat: Generate SQL queries from natural language |
| `chat_system` | Chat: System prompt for the medical records assistant |
| `link_suggestion` | Suggest related documents for linking |
| `page_classification` | Classify pages of multi-page documents |

### Editing and resetting prompts

1. Go to **Settings** > **Document Analysis** > **Prompts**
2. Click a prompt to edit it
3. Modify and click **Save**
4. Click **Reset to Default** to revert to the hardcoded default

**Tips:**
- Keep JSON output format instructions intact — the pipeline depends on specific field names
- Test changes on a single document before bulk reprocessing

## Normalization

The Normalization sub-tab (under Document Analysis) manages canonical mappings for medical terms, doctors, and facilities. When the LLM extracts terms like lab test names, diagnoses, medications, specialties, doctor names, and facility names, they are auto-mapped to canonical entries. Use "Confirm all" to mark auto-mapped aliases as human-reviewed. Use "Merge" to consolidate duplicate entries (e.g., "Dr. M. Bianchi" and "Dr. Marco Bianchi").

See [Normalization](../user-guide/normalization.md) for details.

## Correction-driven learning

When you manually edit document metadata (doc_type, dates, doctor name, etc.) from the document detail page or via AI Edit, Asclepius captures the correction — what the LLM originally extracted vs. what you set. These corrections accumulate over time and are used to improve future extractions:

- Documents with user corrections are preferred as few-shot examples when processing new documents
- Corrections from the same facility are especially valuable, since documents from the same source tend to share formatting
- The system automatically injects 1–2 relevant examples into the classification prompt based on similarity

Extraction quality improves as you correct more documents. No fine-tuning or model retraining needed.

## Backward compatibility

Asclepius auto-migrates older layouts on startup:

- **Flat `llm.*` fields** (`provider`, `ollama_base_url`, `ollama_model`, `claude_api_key`, `claude_model`) are folded into `llm.providers[]`.
- **Flat `ocr.*` fields** (`engine`, `remote_url`, `llm_vision_*`, `google_vision_key`) are folded into `ocr.providers[]`.
- **OCR entries of type `vision_extraction`** are moved into `vision.providers[]` and dropped from the OCR list — the single-step flow is now a first-class sibling of OCR.
- **Inline `base_url` + `api_key`** on LLM/Vision/OCR provider entries are promoted to shared `credentials[]` entries and replaced with `credential_id`. Per-provider retry / concurrency knobs (`llm.max_retries`, `vision.max_concurrent_requests`, etc.) are preserved as a fallback when a credential isn't set, but new deployments should rely on the credential's values.

All migrations are transparent and the settings file is rewritten on first run so subsequent starts are clean.
