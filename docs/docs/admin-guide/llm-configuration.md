# LLM Configuration

## Choosing a Provider

Asclepius supports two LLM providers:

### Ollama (Local)

Best for privacy — all processing stays on your server.

```yaml
llm:
  provider: "ollama"
  ollama_base_url: "http://ollama:11434"
  ollama_model: "llama3.1"
```

**Setup:**

```bash
# Pull the model (run inside the Ollama container)
docker compose exec ollama ollama pull llama3.1
```

Recommended models:

| Model | Size | Quality | Speed |
|-------|------|---------|-------|
| `llama3.1` | 8B | Good | Fast |
| `llama3.1:70b` | 70B | Excellent | Slow (needs GPU) |
| `mistral` | 7B | Good | Fast |
| `mixtral` | 47B | Very good | Medium |

### Claude API (Cloud)

Best extraction quality, but requires an API key and sends data to Anthropic.

```yaml
llm:
  provider: "claude"
  claude_api_key: "sk-ant-..."
  claude_model: "claude-sonnet-4-20250514"
```

Or via environment variable: `ANTHROPIC_API_KEY=sk-ant-...`

## Extraction Quality

The LLM is responsible for:

1. **Document classification** — determining the document type
2. **Patient matching** — identifying which patient the document belongs to
3. **Data extraction** — pulling structured data (lab results, diagnoses, etc.)
4. **Normalization** — mapping terms to canonical codes

Larger, more capable models produce better extraction results. Claude generally outperforms local models for medical document parsing.

## Chat Quality

The chat feature also uses the LLM for:

1. SQL query generation from natural language
2. Natural language answer generation from query results

## Timeout Configuration

```yaml
llm:
  extraction_timeout: 120  # seconds per document
```

Increase this for larger documents or slower models.
