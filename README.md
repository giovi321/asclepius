# Asclepius

A self-hosted application to ingest, OCR, extract, organize, and search personal medical records.

Documents go into an inbox folder, the server processes them (OCR + LLM extraction), stores structured metadata in SQLite, organizes files into a patient/year folder hierarchy, and serves a React web UI for browsing, searching, and chatting with your medical history.

## Quick Start

```bash
# Copy and edit config
cp config/settings.example.yaml config/settings.yaml
# Edit config/settings.yaml with your settings

# Start with Docker Compose
docker compose up -d
```

The application will be available at `http://localhost:8070`.

On first launch, a setup wizard guides you through creating your account and first patient.

## Features

- **Document ingestion**: Drop PDFs, images, or DICOM files into the inbox
- **OCR**: Multi-provider with priority (Tesseract, LLM Vision, Google Vision, remote Tesseract, Vision Extraction)
- **Vision Extraction**: Single-step mode where a vision LLM reads and extracts from page images directly
- **LLM extraction**: Multi-provider with priority and escalation (Ollama, vLLM, Claude, OpenAI)
- **Canonical output language**: Force every LLM-produced field (summaries, canonical names, findings) into the language of your choice
- **Multi-patient**: Organize records by patient with access control
- **Lab results**: Extracted and normalized, with trend tracking
- **Medical imaging**: DICOM viewer (Cornerstone.js) with windowing, zoom, scroll
- **RAG chat**: Ask questions about medical history, powered by structured DB queries
- **Full-text search**: SQLite FTS5 across all document content
- **Normalization**: Canonical mapping for lab tests, diagnoses, medications, specialties, doctors, and facilities across languages
- **Multi-language input**: Ingests documents in any language
- **Timeline view**: Visual chronological timeline with mini-map navigation
- **Medical events**: Group related documents into medical stories (diagnosis, surgery, treatment, etc.)
- **Correction-driven learning**: User edits are captured as training signals to improve future extractions
- **Retrieval-augmented extraction**: Similar previously-processed documents are injected as few-shot examples
- **Selective reprocessing**: Re-run OCR only, LLM only, or both, with specific provider selection

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python + FastAPI |
| Frontend | React + TypeScript + Vite + shadcn/ui |
| Database | SQLite (via aiosqlite) |
| OCR | Tesseract 5, LLM Vision, Google Vision |
| LLM | Ollama, vLLM, Claude API, OpenAI API |
| DICOM | pydicom + Cornerstone.js |
| Deployment | Docker Compose |

## Development

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
uvicorn asclepius.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Contributing

Contributions are welcome! Please read:

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup, coding style, PR checklist
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — expected behaviour
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability **privately**

Quick starts for contributors:

```bash
# Backend tests + lint
cd backend
pip install -e ".[dev]"
ruff check .
pytest

# Frontend type-check + build
cd frontend
npm install
npx tsc --noEmit
npm run build
```

## License

Released under the [MIT License](LICENSE).

This project handles personal health information. Read
[`SECURITY.md`](SECURITY.md) before deploying to the public internet.
