# LLM, OCR & Vision-LLM Configuration

## Overview

Asclepius supports two extraction flows and uses a **multi-provider priority system** for each one. For any flow, you configure one or more providers and set their order; the pipeline uses the highest-priority enabled provider and falls through to the next on failure.

The two flows are:

- **OCR + LLM** — extract text with an OCR engine, then send the text to a language model for classification and structured extraction. Uses `ocr.providers` + `llm.providers`.
- **Vision-LLM** — send page images straight to a vision-capable LLM that returns both the transcribed text and the structured extraction in a single call. Uses `vision.providers`.

Which flow runs for a **new upload** is controlled by `pipeline.default_flow` (Settings → Pipeline). On an **existing document** you can pick any flow on a per-document basis from the Reprocess menu (OCR+LLM, OCR only, LLM only, or Vision-LLM).

All provider configuration is done from **Settings** > **Document Analysis** in the web UI.

## LLM Providers

LLM providers handle document classification, data extraction, chat, and search.

### Supported Providers

| Provider | Type | Description |
|----------|------|-------------|
| **Ollama** | `ollama` | Self-hosted LLM via Ollama. Free, runs locally. |
| **vLLM** | `vllm` | High-performance inference server (OpenAI-compatible API). |
| **Claude** | `claude` | Anthropic Claude API. Best extraction quality. |
| **OpenAI** | `openai` | OpenAI API (GPT-4o, etc.). |

### Adding a Provider

1. Go to **Settings** > **Document Analysis** > **LLM Providers**
2. Click **Add Provider** and select the type
3. Configure the provider settings (model, URL, API key, timeout)
4. Use the arrow buttons to set priority order (top = highest priority)
5. Click **Save Changes**

### Provider Priority & Escalation

Providers are ordered by priority. The pipeline uses **priority 1** (topmost enabled provider) by default. If you're not satisfied with extraction results for a document, you can re-analyze it with the next provider from the document detail page.

Example setup:
1. **Ollama** (llama3.1) -- fast, free, good for most documents
2. **Claude** (claude-sonnet) -- higher quality, used for complex or failed documents

### YAML Configuration

Providers can also be configured in `settings.yaml`:

```yaml
llm:
  providers:
    - id: "ollama-1"
      type: "ollama"
      name: "Ollama (Local)"
      enabled: true
      priority: 1
      base_url: "http://ollama:11434"
      model: "llama3.1"
      timeout: 120
    - id: "claude-1"
      type: "claude"
      name: "Claude API"
      enabled: true
      priority: 2
      api_key: "sk-ant-..."
      model: "claude-sonnet-4-20250514"
      timeout: 120
    - id: "openai-1"
      type: "openai"
      name: "OpenAI"
      enabled: false
      priority: 3
      api_key: "sk-..."
      model: "gpt-4o"
      timeout: 120
    - id: "vllm-1"
      type: "vllm"
      name: "vLLM Server"
      enabled: false
      priority: 4
      base_url: "http://vllm:8000/v1"
      model: "meta-llama/Llama-3.1-8B-Instruct"
      timeout: 120
```

### Recommended Models

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

## OCR Providers

OCR providers extract text from scanned documents and images.

### Supported Providers

| Provider | Type | Description |
|----------|------|-------------|
| **Tesseract (Local)** | `tesseract` | Local Tesseract OCR. Free, no network needed. |
| **Tesseract (Remote)** | `tesseract_remote` | Remote Tesseract server via HTTP API. |
| **LLM Vision** | `llm_vision` | Send page images to an LLM for OCR only — the text then flows into the normal LLM extraction step. |
| **Google Cloud Vision** | `google_vision` | Google Cloud Vision API. |

!!! note "Single-step vision extraction moved"
    The old `vision_extraction` OCR provider type has been promoted to its own flow. See [Vision-LLM Providers](#vision-llm-providers) below. Existing `vision_extraction` OCR entries are auto-migrated into `vision.providers[]` at startup.

### LLM Vision OCR

The LLM Vision OCR engine sends page images directly to an LLM for text extraction. This produces the best results for handwritten documents, poorly scanned pages, complex layouts with tables, and mixed text/images.

Vision OCR can use a **different** LLM provider and model than the extraction LLM. For example: Chandra for OCR + llama3.1 for extraction.

#### Supported Vision Backends

- **Ollama** -- use vision-capable models like `llava:13b`, `llama3.2-vision`, or `chandra-ocr-2`
- **Claude** -- uses Claude's native vision capability
- **OpenAI** -- uses GPT-4o vision

#### Chandra OCR

For the highest OCR quality, use **Chandra OCR** as the vision model:

1. Pull the model: `ollama pull fredrezones55/chandra-ocr-2`
2. Add an LLM Vision OCR provider
3. Set Vision LLM Provider to **Ollama**
4. Set Vision Model to `fredrezones55/chandra-ocr-2`

### YAML Configuration

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
    - id: "llm-vision-1"
      type: "llm_vision"
      name: "Chandra Vision OCR"
      enabled: true
      priority: 2
      llm_provider: "ollama"
      llm_model: "fredrezones55/chandra-ocr-2"
      llm_base_url: "http://ollama:11434"
```

## Vision-LLM Providers

Vision-LLM is an **alternative to the OCR + text-LLM flow**. Instead of running OCR and then passing the resulting text to a language model, each page image is sent directly to a vision-capable LLM that returns both the transcription and the structured extraction in a single call.

This is useful when:

- Your OCR engine struggles with dense tables, handwriting, or complex layouts.
- You want to run a single model end-to-end (one pull, one GPU footprint).
- You prefer to send images rather than the output of a lossy OCR step.

### Supported Provider Types

| Provider | Type | Notes |
|----------|------|-------|
| **Claude** | `claude` | Anthropic Claude with native vision |
| **OpenAI** | `openai` | GPT-4o / GPT-4 vision |
| **Ollama** | `ollama` | Local vision model (e.g. `qwen2.5vl:7b`, `llama3.2-vision`, `minicpm-v`) |

### Adding a Vision Provider

1. Pull a vision model (example for Ollama): `ollama pull qwen2.5vl:7b`.
2. Go to **Settings** > **Document Analysis** > **Vision-LLM Providers**.
3. Click **Add Provider** and pick the type.
4. Fill in Model, Base URL (Ollama/OpenAI), and API key (Claude/OpenAI).
5. Click **Test Connection** — a trivial image round-trip confirms the wiring.
6. Use the arrow buttons to set priority and **Save Changes**.

### Turning on the Vision-LLM flow

Vision providers alone don't change what new uploads do. To switch the default:

1. Go to **Settings** > **Pipeline**.
2. Set **Default Processing Flow** to **Vision-LLM**.

Per-document override stays available in the document detail page's Reprocess menu (OCR+LLM, OCR only, LLM only, Vision-LLM).

### Custom prompt

The vision prompt is editable under **Settings** > **Document Analysis** > **Prompts** with key `vision_extraction`. Keep the JSON schema intact — the pipeline parses the response into `ocr_text` plus classification fields.

### YAML Configuration

```yaml
vision:
  extraction_timeout: 600            # Per-page timeout (seconds)
  max_concurrent_requests: 2         # Parallel vision calls across providers
  max_retries: 3                     # Retries on transient failures
  retry_backoff_seconds: [30, 60, 120]
  providers:
    - id: "qwen25vl-1"
      type: "ollama"
      name: "Qwen2.5-VL"
      enabled: true
      priority: 1
      base_url: "http://ollama:11434"
      model: "qwen2.5vl:7b"
      timeout: 600
    - id: "claude-vision-1"
      type: "claude"
      name: "Claude (vision fallback)"
      enabled: false
      priority: 2
      api_key: "sk-ant-..."
      model: "claude-sonnet-4-20250514"
      timeout: 600
```

### Recommended local models

| VRAM       | Ollama tag          | Notes                                  |
|------------|---------------------|----------------------------------------|
| ≥ 48 GB    | `qwen2.5vl:72b`     | Best quality, slow on consumer hardware |
| 24 GB      | `qwen2.5vl:32b`     | Best quality / VRAM trade-off          |
| 12–16 GB   | `qwen2.5vl:7b`      | Recommended default                    |
| 8 GB       | `qwen2.5vl:3b`      | Only for clean typed documents         |

`qwen2.5:14b` is **text-only** — there is no 14B vision variant. `minicpm-v` (8B) is a solid alternative to `qwen2.5vl:7b` when OCR on noisy scans matters more than strict JSON adherence. Avoid `llama3.2-vision` for dense tables and strict JSON output.

## Extraction Timeout

Each provider has its own timeout setting.

- LLM providers default to 120 seconds.
- Vision providers default to 600 seconds (vision calls are slow).

Increase the provider timeout for very large documents, slow inference servers, or large models. For LLM-vision OCR the effective timeout is never lower than 300 seconds regardless of the configured value.

## Custom Prompts

All LLM prompts are editable from **Settings** > **Document Analysis** > **Prompts**.

### Available Prompts

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

### Editing & Resetting Prompts

1. Go to **Settings** > **Document Analysis** > **Prompts**
2. Click a prompt to edit it
3. Modify and click **Save**
4. Click **Reset to Default** to revert to the hardcoded default

**Tips:**
- Keep JSON output format instructions intact -- the pipeline depends on specific field names
- Test changes with a single document before bulk reprocessing

## Normalization

The Normalization sub-tab (under Document Analysis) manages canonical mappings for medical terms, doctors, and facilities. When the LLM extracts terms like lab test names, diagnoses, medications, specialties, doctor names, and facility names, they are auto-mapped to canonical entries. Use "Confirm all" to mark auto-mapped aliases as human-reviewed. Use "Merge" to consolidate duplicate entries (e.g., "Dr. M. Bianchi" and "Dr. Marco Bianchi").

See [Normalization](../user-guide/normalization.md) for details.

## Correction-Driven Learning

When you manually edit document metadata (doc_type, dates, doctor name, etc.) in the document detail page or via AI Edit, Asclepius captures the correction — what the LLM originally extracted vs. what you set. These corrections accumulate over time and are used to improve future extractions:

- Documents with user corrections are **preferred as few-shot examples** when processing new documents
- Corrections from the same facility are especially valuable since documents from the same source share formatting patterns
- The system automatically injects 1-2 relevant examples into the classification prompt based on similarity

This means extraction quality improves progressively as you correct more documents — no fine-tuning or model retraining needed.

## Backward Compatibility

Asclepius auto-migrates older layouts on startup:

- **Flat `llm.*` fields** (`provider`, `ollama_base_url`, `ollama_model`, `claude_api_key`, `claude_model`) are folded into `llm.providers[]`.
- **Flat `ocr.*` fields** (`engine`, `remote_url`, `llm_vision_*`, `google_vision_key`) are folded into `ocr.providers[]`.
- **OCR entries of type `vision_extraction`** are moved into `vision.providers[]` and dropped from the OCR list — the single-step flow is now a first-class sibling of OCR.

All three migrations are transparent and the settings file is rewritten on first run so subsequent starts are clean.
