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
- **OCR**: Multi-provider with priority (Tesseract, LLM Vision, Google Vision, remote Tesseract)
- **LLM extraction**: Multi-provider with priority and escalation (Ollama, vLLM, Claude, OpenAI)
- **Multi-patient**: Organize records by patient with access control
- **Lab results**: Extracted and normalized, with trend tracking
- **Medical imaging**: DICOM viewer (Cornerstone.js) with windowing, zoom, scroll
- **RAG chat**: Ask questions about medical history, powered by structured DB queries
- **Full-text search**: SQLite FTS5 across all document content
- **Normalization**: Canonical mapping for lab tests, diagnoses, medications, specialties across languages
- **Multi-language**: Handles documents in any language, extracts to English canonical forms

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

## License

Private — all rights reserved.
