# Installation

## Prerequisites

- Docker and Docker Compose
- (Optional) An Ollama instance for local LLM, or a Claude API key

## Docker Compose (Recommended)

```bash
git clone https://github.com/giovi321/asclepius.git
cd asclepius

# Create your configuration
cp config/settings.example.yaml config/settings.yaml
```

Edit `config/settings.yaml` to configure your LLM provider, OCR languages, and other settings.

```bash
# Start the application
docker compose up -d
```

This starts two services:

- **asclepius** — the main application on port `8070`
- **ollama** — local LLM server on port `11434`

### Environment Variables

You can override settings via environment variables in `docker-compose.yml` or a `.env` file:

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Session signing key | `change-me-in-production` |
| `ANTHROPIC_API_KEY` | Claude API key (optional) | — |
| `GOOGLE_VISION_KEY` | Google Cloud Vision key (optional) | — |

### GPU Support for Ollama

To enable GPU acceleration for the local LLM, uncomment the GPU section in `docker-compose.yml`:

```yaml
ollama:
  deploy:
    resources:
      reservations:
        devices:
          - capabilities: [gpu]
```

## Manual Installation (Development)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Install Tesseract OCR
# Ubuntu/Debian: sudo apt install tesseract-ocr tesseract-ocr-ita tesseract-ocr-deu
# macOS: brew install tesseract
# Windows: download from https://github.com/UB-Mannheim/tesseract/wiki

uvicorn asclepius.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend dev server runs on port `5173` and proxies API calls to `localhost:8000`.
