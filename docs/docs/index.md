# Asclepius

**Self-hosted medical records manager**

Asclepius is a self-hosted application that ingests, OCRs, extracts, organizes, and searches personal medical records. Drop documents into an inbox folder, and the server automatically processes them — extracting structured data using OCR and LLM, organizing files by patient and date, and making everything searchable through a modern web UI.

## Key Features

- **Automated ingestion** — Drop PDFs, images, or DICOM files into the inbox
- **OCR + LLM extraction** — Tesseract OCR with LLM-powered structured data extraction
- **Multi-language** — Handles documents in English, Italian, German, and more
- **Multi-patient** — Organize records by patient with user access control
- **Lab result tracking** — Extracted, normalized, with trend visualization
- **Medical imaging** — DICOM viewer with windowing, zoom, and slice scrolling
- **RAG chat** — Ask questions about medical history, powered by structured DB queries
- **Full-text search** — SQLite FTS5 across all document content
- **Normalization** — Canonical mapping for lab tests, diagnoses, medications across languages
- **Self-hosted** — Your data stays on your server, deployed via Docker Compose

## Quick Start

```bash
git clone https://github.com/giovi321/asclepius.git
cd asclepius
cp config/settings.example.yaml config/settings.yaml
# Edit settings.yaml with your configuration
docker compose up -d
```

Then open [http://localhost:8070](http://localhost:8070) and log in with `admin` / `admin`.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python + FastAPI |
| Frontend | React + TypeScript + Vite + Tailwind |
| Database | SQLite (via aiosqlite) |
| OCR | Tesseract 5 |
| LLM | Ollama (local) or Claude API |
| DICOM | pydicom + Cornerstone.js |
| Deployment | Docker Compose |
