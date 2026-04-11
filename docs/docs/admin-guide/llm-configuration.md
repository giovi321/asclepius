# LLM Configuration

## LLM Providers

Asclepius supports two LLM providers for document extraction, chat, and AI editing:

### Ollama

Self-hosted LLM server. You must run your own Ollama instance.

```yaml
llm:
  provider: "ollama"
  ollama_base_url: "http://your-ollama-host:11434"
  ollama_model: "llama3.1"
  extraction_timeout: 120
```

**Recommended models:**

- `llama3.1` -- good balance of speed and quality
- `llama3.1:70b` -- better extraction quality, requires more VRAM
- `qwen2.5` -- alternative with strong multilingual support

Make sure to pull the model before use:

```bash
ollama pull llama3.1
```

### Claude API

Anthropic's Claude API. Requires an API key.

```yaml
llm:
  provider: "claude"
  claude_api_key: "sk-ant-..."
  claude_model: "claude-sonnet-4-20250514"
  extraction_timeout: 120
```

**Recommended models:**

- `claude-sonnet-4-20250514` -- best balance of cost and quality (default)

The API key can also be set via the `ANTHROPIC_API_KEY` environment variable.

### Switching Providers

You can switch between providers at any time from **Settings** > **LLM** in the web UI, or by editing `settings.yaml`. Changes take effect immediately without restarting.

## OCR with LLM Vision

The LLM Vision OCR engine sends page images directly to an LLM for text extraction. This produces the best results for:

- Handwritten documents
- Poorly scanned documents
- Complex layouts with tables and forms
- Documents with mixed text and images

### Separate Vision Model

You can use a **different** LLM model (and even a different Ollama server) for OCR than for data extraction. This is configured under the `ocr` section:

```yaml
ocr:
  engine: "llm_vision"
  llm_vision_provider: "ollama"            # or "claude"
  llm_vision_model: "llava:13b"            # vision-capable model
  llm_vision_ollama_url: "http://gpu-server:11434"  # optional separate server

llm:
  provider: "ollama"
  ollama_model: "llama3.1"                  # extraction model (can be different)
```

### Chandra OCR

For the highest OCR quality, use **Chandra OCR** as the vision model:

```yaml
ocr:
  engine: "llm_vision"
  llm_vision_provider: "ollama"
  llm_vision_model: "fredrezones55/chandra-ocr-2"
```

Chandra produces structured HTML output with semantic labels (`Page-Header`, `Section-Header`, `Text`, etc.), which significantly improves the downstream extraction accuracy. The classification prompt is designed to understand Chandra's HTML format.

Pull the model:

```bash
ollama pull fredrezones55/chandra-ocr-2
```

### Vision with Claude

When using Claude as the vision provider, Claude's native vision capability is used. No special model is needed:

```yaml
ocr:
  engine: "llm_vision"
  llm_vision_provider: "claude"
  # Uses the main claude_model by default
```

## Extraction Timeout

The `extraction_timeout` setting (default: 120 seconds) controls how long the system waits for an LLM response before timing out. Increase this for:

- Very large documents
- Slow Ollama instances
- Large models with slow inference

```yaml
llm:
  extraction_timeout: 300  # 5 minutes
```

## Custom Prompts

All LLM prompts used by Asclepius are editable from the web UI under **Settings** > **Prompts**.

### Available Prompts

| Key | Description |
|-----|-------------|
| `classification` | Phase 1: Document classification and basic metadata extraction |
| `extraction_bloodtest` | Phase 2: Extract lab results from blood test documents |
| `extraction_specialist_report` | Phase 2: Extract diagnoses, encounters, medications from specialist reports |
| `extraction_prescription` | Phase 2: Extract medications from prescriptions |
| `extraction_invoice` | Phase 2: Extract cost and line items from invoices |
| `extraction_discharge` | Phase 2: Extract data from discharge letters |
| `extraction_radiology` | Phase 2: Extract findings from radiology reports |
| `extraction_vaccination` | Phase 2: Extract vaccination records |
| `document_edit` | AI-powered document metadata editing |
| `sql_generation` | Chat: Generate SQL queries from natural language |
| `chat_system` | Chat: System prompt for the medical records assistant |
| `link_suggestion` | Suggest related documents for linking |
| `page_classification` | Classify pages of multi-page documents into content types |

### Editing Prompts

1. Go to **Settings** > **Prompts**
2. Select a prompt to edit
3. Modify the prompt text
4. Click **Save**

### Resetting Prompts

Click **Reset to Default** to revert a prompt to its hardcoded default. This deletes the custom entry from the database.

### Tips for Custom Prompts

- Keep the JSON output format instructions intact -- the extraction pipeline depends on specific field names
- Test changes with a single document before bulk reprocessing
- The classification prompt supports Chandra OCR's HTML format -- do not remove the HTML parsing instructions if you use LLM Vision with Chandra
