<p align="center">
  <img src="docs/docs/assets/logo.svg" alt="Asclepius" width="160" />
</p>

<h1 align="center">Asclepius</h1>

<p align="center">
  <a href="https://github.com/giovi321/asclepius/actions/workflows/ci.yml"><img src="https://github.com/giovi321/asclepius/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/giovi321/asclepius/actions/workflows/docker.yml"><img src="https://github.com/giovi321/asclepius/actions/workflows/docker.yml/badge.svg" alt="Docker"></a>
  <a href="https://github.com/giovi321/asclepius/actions/workflows/docs.yml"><img src="https://github.com/giovi321/asclepius/actions/workflows/docs.yml/badge.svg" alt="Docs"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-blue" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/node-20%2B-green" alt="Node 20+">
</p>

A self-hosted application to ingest, OCR, extract, organize, and search personal medical records.

Documents go into an inbox folder, the server processes them (OCR + LLM extraction), stores structured metadata in SQLite, organizes files into a patient/year folder hierarchy, and serves a React web UI for browsing, searching, and chatting with your medical history.

## Quick Install

**Prerequisites:** Docker + Docker Compose, ~2 GB free disk, and at least one LLM provider (self-hosted Ollama/vLLM or an API key for Claude/OpenAI).

```bash
git clone https://github.com/giovi321/asclepius.git
cd asclepius
cp config/settings.example.yaml config/settings.yaml
# edit config/settings.yaml — at minimum configure one LLM provider
docker compose up -d
```

Open <http://localhost:8070> — a first-launch setup wizard creates your admin account and first patient. Drop files into the inbox folder to start ingestion.

## Features

- **Ingest** PDFs, images, and DICOM files from an inbox folder
- **Extract** text and structured fields via multi-provider OCR + LLM (Tesseract, Google Vision, Ollama, vLLM, Claude, OpenAI) with priority-based fallback
- **Organize** by patient with multi-user access control, medical events, and a chronological timeline
- **Lab results** normalized across languages, with trend charts
- **Search + chat** your records with SQLite FTS5 and RAG-powered Q&A
- **DICOM viewer** with windowing, zoom, and scroll
- **Learns from your edits** via correction-driven learning and retrieval-augmented extraction
- **Selective reprocessing** of OCR only, LLM only, or both — with per-document provider choice

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
