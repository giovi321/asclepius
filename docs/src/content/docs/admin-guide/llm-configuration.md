---
title: "LLM, OCR & Vision-LLM Configuration"
---

## Overview

Asclepius supports two extraction flows and uses a **multi-provider priority system** for each one. For any flow, you configure one or more providers and set their order; the pipeline uses the highest-priority enabled provider and falls through to the next on failure.

The two flows are:

- **OCR + LLM**, extract text with an OCR engine, then send the text to a language model for classification and structured extraction. Uses `ocr.providers` + `llm.providers`.
- **Vision-LLM**, send page images straight to a vision-capable LLM that returns both the transcribed text and the structured extraction in a single call. Uses `vision.providers`.

Which flow runs for a **new upload** is controlled by `pipeline.default_flow` (Settings → Pipeline). On an **existing document** you can pick any flow on a per-document basis from the Reprocess menu (OCR+LLM, OCR only, LLM only, or Vision-LLM).

All provider configuration is done from **Settings** > **Document Analysis** in the web UI. That page has four sub-tabs:

- **Providers**, add/edit/reorder LLM, OCR, and Vision-LLM providers, and manage the **Credentials** they share.
- **Priority**, drag-to-reorder priority across the providers you've defined.
- **Prompts**, edit classification / extraction / vision / chat / page-classification prompts.
- **Normalization**, canonical mappings for doctors, facilities, lab tests, specialties, diagnoses, medications.

## Credentials

A **credential** is a shared connection (URL + API key) that multiple providers can reference by `credential_id`. One credential per physical endpoint, a single Ollama server, a single Anthropic account, a single OpenAI project. Any number of LLM / Vision-LLM / OCR entries can point at the same credential and pick up changes to the URL, API key, retry policy, or concurrency cap automatically.

Key fields (per credential):

| Field | Default | Description |
|-------|---------|-------------|
| `type` | `ollama` | One of `ollama`, `vllm`, `claude`, `openai`, `google_vision`, `tesseract_remote` |
| `base_url` | | Only for self-hosted types (Ollama/vLLM/Tesseract-remote) |
| `api_key` | | Only for cloud types (Claude / OpenAI / Google Vision) |
| `max_concurrent` | `2` | Process-wide concurrency cap for this credential. Every provider referencing this credential shares the same queue, split per **kind** (`llm` / `ocr` / `vision`). This matches how a single Ollama or Claude account actually behaves, one physical endpoint, one real concurrency limit. |
| `max_retries` | `3` | Retries on transient failures (ReadTimeout, ConnectError, HTTP 429/5xx) |
| `retry_backoff_seconds` | `[30, 60, 120]` | Sleep between successive attempts; last value reused if list is shorter than `max_retries` |

Concurrency is enforced by a process-wide semaphore keyed by `credential_id`, **not** by `(credential, kind)`. `max_concurrent` is the absolute number of inflight calls allowed against a credential, `max_concurrent: 1` means at most one call total across LLM, Vision, and OCR purposes that share the credential, *not* "one extra per kind". The Dashboard renders a separate chip per `(credential, kind)` for visibility, so when both an LLM and an OCR call are pending against the same Ollama server you see two chips, but only one is actually inflight at any moment, the other is queued (annotated `(queued)` in the chip label since 0.9.12).

:::tip[Why per-credential instead of per-provider?]
Two Ollama models on the same server compete for the same GPU. Setting a concurrency cap on each provider entry would let the physical server get overrun as soon as you enabled a second provider on it. A credential-scoped cap means adding a new model to an existing endpoint doesn't silently multiply load.

:::

## Recommended stack

If you're setting up Asclepius for the first time and want a reasonable default, here's what we run. It fits on a single workstation with ~12 GB of VRAM and produces solid results on English and other European-language medical documents.

### Local (self-hosted, via Ollama)

| Role           | Model                              | Ollama tag                                |
|----------------|------------------------------------|-------------------------------------------|
| OCR primary    | Chandra OCR                        | `fredrezones55/chandra-ocr-2`             |
| OCR fallback   | Tesseract                          | `tesseract` (system package, no GPU)      |
| Text LLM       | Qwen 2.5 14B                       | `qwen2.5:14b`                             |
| Vision-LLM     | Qwen 2.5-VL 7B                     | `qwen2.5vl:7b`                            |
| Cloud fallback | Claude Haiku                       | `claude-haiku` (Anthropic API)            |

This four-tier stack runs comfortably on a 12 GB VRAM GPU. Tesseract sits as a CPU-only OCR fallback for the rare scan that throws Chandra (or for hosts without a GPU). Claude Haiku is wired as the lowest-priority LLM provider so anything the local Qwen 2.5 fails to extract cleanly can still escalate to a hosted model without manual retries. Pull the local models with:

```bash
ollama pull fredrezones55/chandra-ocr-2
ollama pull qwen2.5:14b
ollama pull qwen2.5vl:7b
# Tesseract is a system package, install via your distro:
#   apt install tesseract-ocr   (Debian / Ubuntu)
#   brew install tesseract      (macOS)
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
4. Click **Test Connection** to verify the credential, URL, and model name without spending tokens (see [Test Connection buttons](#test-connection-buttons))
5. Drag in the **Priority** sub-tab to reorder across all LLM providers (top = highest priority)
6. Click **Save Changes**

### Test Connection buttons

Every provider row in **Settings → Document Analysis → Providers** has a **Test Connection** button. Each button hits the provider's free metadata endpoint instead of running real inference, so:

- **Zero tokens consumed** — Anthropic, OpenAI, and any pay-per-call backend are billed nothing for a click.
- **Zero GPU contention** — clicking Test on a self-hosted Ollama provider while the pipeline is mid-page on the same server doesn't queue a real inference behind it. The probe is a `GET /api/tags`, not a `_generate(...)`.
- **Better diagnostics** — a wrong model name in the config returns *"Server reachable but model 'qwen2.5:14b' not found. Available: qwen2.5-coder:14b, llama3.2:3b, …"* instead of a generic timeout.

What each backend probes:

| Provider type | Probe |
|---|---|
| **Ollama** (LLM, Vision-LLM, LLM-vision OCR) | `GET /api/tags` — lists installed models, validates URL + that the configured model is pulled. |
| **OpenAI / vLLM** | `GET /v1/models` with the API key — validates auth + lists accessible models. |
| **Anthropic Claude** | `client.models.list()` (Anthropic SDK) — validates the API key + confirms the model id is in Anthropic's catalogue. |
| **Google Vision** | `POST images:annotate` with `{"requests": []}` — Google specifically returns 200/400 for empty payloads, so this validates the API key without consuming quota. |
| **Tesseract Remote** | `GET /` against the remote server — confirms it's up. |
| **Tesseract local** | `tesseract --version`. |

What a Test pass does **not** catch: weights that are installed but corrupt, prompt-template mismatches, or inference paths that error mid-call. For end-to-end verification, run a real reprocess on a small document.

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

Legacy inline form (`base_url` + `api_key` directly on the provider, no `credential_id`) is still honoured for backwards compatibility, on startup, Asclepius synthesises a credential per unique (type, base_url, api_key) triple and rewrites `settings.yaml` to reference it.

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
| **LLM Vision** | `llm_vision` | Send page images to an LLM for OCR only, the text then flows into the normal LLM extraction step. |
| **Google Cloud Vision** | `google_vision` | Google Cloud Vision API. |

:::note[Single-step vision extraction moved]
The old `vision_extraction` OCR provider type has been promoted to its own flow. See [Vision-LLM Providers](#vision-llm-providers) below. Existing `vision_extraction` OCR entries are auto-migrated into `vision.providers[]` at startup.

:::

### LLM Vision OCR

The LLM Vision OCR engine sends page images directly to an LLM for text extraction. It produces the best results on handwritten documents, poorly scanned pages, and complex mixed text/image layouts.

Vision OCR can use a different LLM provider and model than the extraction LLM, for example, Chandra for OCR plus llama3.1 for extraction.

#### Supported vision backends

- **Ollama**, use vision-capable models like `llava:13b`, `llama3.2-vision`, or `chandra-ocr-2`
- **Claude**, uses Claude's native vision capability
- **OpenAI**, uses GPT-4o vision

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
      # Local Tesseract has no credential, leave credential_id empty.
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
5. Click **Test Connection** — confirms the URL is reachable, the API key is valid, and the configured model is actually available on the server. The test only hits the provider's free metadata endpoint (`GET /api/tags` for Ollama, `GET /v1/models` for OpenAI/vLLM, `client.models.list()` for Anthropic), so it consumes no tokens and doesn't spin up the model. See [Test Connection buttons](#test-connection-buttons) below.
6. Drag to reorder priority in the **Priority** sub-tab and **Save Changes**.

Asclepius also runs Phase 2 type-specific extraction after the vision call, reusing the same provider you selected for vision. That way Haiku-for-vision stays Haiku-for-extraction instead of silently falling back to the default text-LLM.

### Turning on the Vision-LLM flow

Vision providers alone don't change what new uploads do. To switch the default:

1. Go to **Settings** > **Pipeline**.
2. Set **Default Processing Flow** to **Vision-LLM**.

Per-document override stays available in the document detail page's Reprocess menu (OCR+LLM, OCR only, LLM only, Vision-LLM).

### Custom prompt

The vision prompt is editable under **Settings** > **Document Analysis** > **Prompts** with key `vision_extraction`. Keep the JSON schema intact, the pipeline parses the response into `ocr_text` plus classification fields.

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

Retries and concurrency aren't configured on `vision.*` itself, they live on the credential each vision provider references.

### Recommended local models

| VRAM       | Ollama tag          | Notes                                  |
|------------|---------------------|----------------------------------------|
| ≥ 48 GB    | `qwen2.5vl:72b`     | Best quality, slow on consumer hardware |
| 24 GB      | `qwen2.5vl:32b`     | Best quality / VRAM trade-off          |
| 12, 16 GB   | `qwen2.5vl:7b`      | Recommended default                    |
| 8 GB       | `qwen2.5vl:3b`      | Only for clean typed documents         |

`qwen2.5:14b` is **text-only**, there is no 14B vision variant. `minicpm-v` (8B) is a solid alternative to `qwen2.5vl:7b` when OCR on noisy scans matters more than strict JSON adherence. Avoid `llama3.2-vision` for dense tables and strict JSON output.

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

### Wall-clock budget on Ollama

`timeout` is the httpx **read** timeout, the idle interval between bytes. On a genuinely wedged connection where the server accepts the POST but never replies (seen with stuck Ollama generate workers), the read timer can fail to fire and the request hangs indefinitely, holding the credential's gate slot with it.

Ollama POSTs are therefore also wrapped in `asyncio.wait_for` with a wall-clock budget of `timeout + 30s`. A hung socket raises `TimeoutError` at the wall-clock boundary regardless of what httpx sees. The error is treated the same as any other transient failure and feeds the credential's normal retry/backoff loop. Claude and OpenAI don't need this, their client libraries enforce wall-clock timeouts internally.

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

**Which prompts actually inject known-entity lists.** Only `classification`, `document_edit`, and the legacy `extraction_legacy` template expand `{patient_list}` / `{facility_list}` / `{doctor_list}` into the full JSON of known entities. The per-type extraction prompts (`extraction_bloodtest`, `extraction_prescription`, …) only receive `{ocr_text}`, canonical lab tests, medications, diagnoses, specialties, doctors and facilities are matched in Python *after* extraction (see [pipeline → Name Normalization](../architecture/pipeline.md#name-normalization)). `chat_system` receives a bounded `{patient_context}` rollup, not the full entity tables, and there is no MCP server or vector retrieval behind chat, the SQL-generation prompt is the tool-call.

### Available variables

Prompts are Python `str.format()` templates. Each prompt supports a specific set of `{placeholder}` variables that are substituted when the prompt is executed. **Using a placeholder not listed for a given prompt will raise a `KeyError` at runtime and break that extraction path**, stick to the variables below for each prompt.

The Prompts settings page shows the exact variables available for each prompt as clickable chips: click a chip to copy the placeholder into your clipboard.

#### Variable reference

| Variable | Description |
|----------|-------------|
| `{ocr_text}` | Full OCR-extracted text of the document |
| `{pages_text}` | Multi-page OCR text, formatted as `--- PAGE N ---\n<text>` |
| `{patient_list}` | JSON list of known patients (id, slug, name, DOB, sex) |
| `{facility_list}` | JSON list of known facilities (id, slug, name) |
| `{doctor_list}` | JSON list of known doctors (id, slug, name) |
| `{few_shot_examples}` | 1, 2 similar prior documents with their extractions, used as in-context examples |
| `{lab_test_mappings}` | JSON list of canonical lab-test aliases (optional) |
| `{specialty_mappings}` | JSON list of canonical specialty aliases (optional) |
| `{diagnosis_mappings}` | JSON list of canonical diagnosis/ICD-10 aliases (optional) |
| `{medication_mappings}` | JSON list of canonical medication aliases (optional) |
| `{doc_id}` | ID of the current document |
| `{doc_type}` | Classified document type (bloodtest, invoice, discharge, …) |
| `{doc_date}` | Document date (YYYY-MM-DD or `unknown`) |
| `{doctor_name}` | Treating/signing doctor's name from the extraction |
| `{facility_name}` | Facility/hospital/clinic name from the extraction |
| `{summary}` | English summary of the document |
| `{other_documents}` | Text list of other documents belonging to the same patient |
| `{schema}` | SQLite schema (tables + columns) for SQL generation |
| `{context}` | Patient context snippet used by chat / SQL generation |
| `{question}` | User's natural-language question (chat) |
| `{patient_context}` | Bounded patient rollup built on every chat turn: identity (name, DOB, sex) + last 10 documents + last 20 lab results + last 10 medications. Does **not** include the full patient / facility / doctor lists. |
| `{current_data}` | Current document extraction rendered as JSON (document_edit) |
| `{user_instruction}` | User's correction/edit instruction (document_edit) |
| `{json_schema}` | Expected JSON-schema response shape (document_edit) |

Variables labelled **optional** are substituted only if their placeholder actually appears in the (custom) template, they can be safely added to extend a prompt, but are not required.

#### Variables by prompt

| Prompt key | Variables |
|------------|-----------|
| `classification` | `{patient_list}`, `{facility_list}`, `{doctor_list}`, `{ocr_text}`, `{few_shot_examples}` |
| `vision_extraction` | *(none, self-contained)* |
| `extraction_bloodtest` | `{ocr_text}`, `{lab_test_mappings}`? |
| `extraction_specialist_report` | `{ocr_text}`, `{specialty_mappings}`?, `{diagnosis_mappings}`?, `{medication_mappings}`? |
| `extraction_prescription` | `{ocr_text}`, `{medication_mappings}`? |
| `extraction_invoice` | `{ocr_text}` |
| `extraction_discharge` | `{ocr_text}`, `{diagnosis_mappings}`?, `{medication_mappings}`? |
| `extraction_radiology` | `{ocr_text}` |
| `extraction_vaccination` | `{ocr_text}` |
| `document_edit` | `{current_data}`, `{patient_list}`, `{facility_list}`, `{doctor_list}`, `{user_instruction}`, `{json_schema}` |
| `sql_generation` | `{schema}`, `{context}`, `{question}` |
| `chat_system` | `{patient_context}` |
| `link_suggestion` | `{doc_id}`, `{doc_type}`, `{doc_date}`, `{doctor_name}`, `{facility_name}`, `{summary}`, `{other_documents}` |
| `page_classification` | `{pages_text}` |

Variables suffixed with `?` are optional.

### Editing and resetting prompts

1. Go to **Settings** > **Document Analysis** > **Prompts**
2. Click a prompt to edit it
3. Modify and click **Save**
4. Click **Reset to Default** to revert to the hardcoded default

**Tips:**
- Keep JSON output format instructions intact, the pipeline depends on specific field names
- Test changes on a single document before bulk reprocessing

## Normalization

The Normalization sub-tab (under Document Analysis) manages canonical mappings for medical terms, doctors, and facilities. When the LLM extracts terms like lab test names, diagnoses, medications, specialties, doctor names, and facility names, they are auto-mapped to canonical entries. Use "Confirm all" to mark auto-mapped aliases as human-reviewed. Use "Merge" to consolidate duplicate entries (e.g., "Dr. H. Mueller" and "Dr. Hans Mueller").

See [Normalization](../user-guide/normalization.md) for details.

## Correction-driven learning

When you manually edit document metadata (doc_type, dates, doctor name, etc.) from the document detail page or via AI Edit, Asclepius captures the correction, what the LLM originally extracted vs. what you set. These corrections accumulate over time and are used to improve future extractions:

- Documents with user corrections are preferred as few-shot examples when processing new documents
- Corrections from the same facility are especially valuable, since documents from the same source tend to share formatting
- The system automatically injects 1, 2 relevant examples into the classification prompt based on similarity

Extraction quality improves as you correct more documents. No fine-tuning or model retraining needed.

## Backward compatibility

Asclepius auto-migrates older layouts on startup:

- **Flat `llm.*` fields** (`provider`, `ollama_base_url`, `ollama_model`, `claude_api_key`, `claude_model`) are folded into `llm.providers[]`.
- **Flat `ocr.*` fields** (`engine`, `remote_url`, `llm_vision_*`, `google_vision_key`) are folded into `ocr.providers[]`.
- **OCR entries of type `vision_extraction`** are moved into `vision.providers[]` and dropped from the OCR list, the single-step flow is now a first-class sibling of OCR.
- **Inline `base_url` + `api_key`** on LLM/Vision/OCR provider entries are promoted to shared `credentials[]` entries and replaced with `credential_id`. Per-provider retry / concurrency knobs (`llm.max_retries`, `vision.max_concurrent_requests`, etc.) are preserved as a fallback when a credential isn't set, but new deployments should rely on the credential's values.

All migrations are transparent and the settings file is rewritten on first run so subsequent starts are clean.
