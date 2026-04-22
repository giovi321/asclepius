<p align="center">
  <img src="docs/public/assets/logo.svg" alt="Asclepius" width="120" />
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

A self-hosted app for ingesting, OCRing, extracting, organizing, and searching personal medical records.

Drop a document into the inbox folder. The server runs OCR and an LLM extraction pass, writes the structured metadata to SQLite, files the document under `patients/{slug}/{year}/`, and serves a React web UI for browsing, searching, and asking questions about your medical history.

> [!WARNING]
> **Do not expose Asclepius directly to the public internet.** It is designed to run on a trusted LAN or behind a VPN/reverse proxy that handles authentication. The built-in username/password authentication is intentionally minimal — no rate limiting, no MFA, no account lockout, no password-strength enforcement, and session cookies cannot be revoked en masse without rotating the secret key. **For any deployment beyond a single-user LAN install, configure an OIDC provider (e.g. [Authentik](https://goauthentik.io/), Keycloak, Auth0) and disable the local password flow.** See [`SECURITY.md`](SECURITY.md).

<p align="center">
  <img src="docs/public/assets/diagrams/hero.svg" alt="Asclepius — drop a file in, get organized records out" width="900" />
</p>

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

- **Ingests** PDFs, images, and DICOM files from an inbox folder
- **Two extraction flows**, pickable per install and per document:
  - **OCR + LLM**: Tesseract, Google Vision, or LLM Vision for OCR, then Ollama, vLLM, Claude, or OpenAI for extraction
  - **Vision-LLM**: a single vision model (Qwen2.5-VL, Claude, GPT-4o, and friends) that OCRs and extracts in one call
- **Priority fallback** over every provider list (OCR, LLM, Vision-LLM), so a flaky endpoint hands off to the next one automatically
- **Organizes** by patient with multi-user access control, medical events, and a chronological timeline
- **Lab results** get normalized across languages and plotted as trend charts
- **Search and chat** over your records, backed by SQLite FTS5 and a small RAG layer
- **DICOM viewer** with windowing, zoom, and scroll
- **Learns from your corrections**: edits feed back into retrieval-augmented few-shot examples for later extractions
- **Selective reprocessing**: OCR only, LLM only, OCR+LLM, or Vision-LLM, with per-document provider choice

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python + FastAPI |
| Frontend | React + TypeScript + Vite + shadcn/ui |
| Database | SQLite (via aiosqlite) |
| OCR | Tesseract 5, LLM Vision, Google Vision |
| LLM | Ollama, vLLM, Claude API, OpenAI API |
| Vision-LLM | Ollama (Qwen2.5-VL, MiniCPM-V, …), Claude vision, GPT-4o |
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

Bundled medical reference data (LOINC, ATC, ICD-10) is covered by separate
third-party licenses — see [`NOTICE`](NOTICE) for required attributions,
including the LOINC short notice required by Section 10 of the LOINC
license.

This project handles personal health information and is **not hardened for
direct internet exposure**. Read [`SECURITY.md`](SECURITY.md) before
deploying anywhere outside a trusted LAN, and put it behind an OIDC
provider such as Authentik for any multi-user or remote-access scenario.
