<div style="text-align: center; margin-bottom: 1rem;">
  <img src="assets/logo.svg" alt="Asclepius" width="96" height="96" style="border-radius: 12px;" />
</div>

# Asclepius

**Self-hosted medical records manager**

Asclepius is a self-hosted application that ingests, OCRs, extracts, organizes, and searches personal medical records. Drop documents into an inbox folder (or upload via the web UI), and the server automatically processes them -- extracting structured data using OCR and LLM, organizing files by patient and date, and making everything searchable through a modern web interface.

## Key Features

- **Automated ingestion** -- Drop PDFs, images, or DICOM files into the inbox, or upload via the web UI
- **OCR + LLM extraction** -- Four OCR engines (Tesseract, Tesseract Remote, LLM Vision, Google Cloud Vision) with LLM-powered structured data extraction
- **Two-phase extraction** -- Documents are classified first, then extracted with type-specific prompts for higher accuracy
- **Smart page-level sectioning** -- Large documents (>5 pages) are split into logical sections (lab results, clinical notes, discharge summary, etc.) and extracted individually
- **Medical events** -- Organize documents around medical stories (diagnosis, treatment, surgery) with AI-powered event suggestions
- **Multi-language** -- Handles documents in English, Italian, German, French, Spanish, and more
- **Multi-patient** -- Organize records by patient with role-based access control
- **Lab result tracking** -- Extracted, normalized, with interactive trend visualization
- **Medical imaging** -- DICOM viewer with windowing, zoom, and slice scrolling
- **Timeline view** -- Vertical timeline with mini-map navigation, jump-to-date, and color-coded event types
- **RAG chat** -- Ask questions about medical history, powered by SQL generation and structured DB queries
- **Full-text search** -- SQLite FTS5 across all document content and metadata
- **Normalization** -- Canonical mapping for lab tests, diagnoses, medications, specialties, doctors, and facilities across languages with merge and alias management
- **Customizable prompts** -- All LLM prompts are editable from the UI with reset-to-default
- **OIDC / SSO** -- Single sign-on with Authentik, Keycloak, or any OIDC provider
- **Self-hosted** -- Your data stays on your server, deployed as a single Docker container

## Quick Start

```bash
git clone https://github.com/giovi321/asclepius.git
cd asclepius
cp config/settings.example.yaml config/settings.yaml
# Edit settings.yaml with your LLM and OCR configuration
docker compose up -d
```

Then open [http://localhost:8070](http://localhost:8070). On first launch, a **setup wizard** will guide you through creating your admin account and first patient profile.

!!! tip "Setup Wizard"
    The wizard only appears once — when no users exist in the database. It creates your admin account and a first patient profile pre-filled with your name.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.12 + FastAPI |
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Database | SQLite with WAL mode + FTS5 |
| OCR | Tesseract 5, LLM Vision, Google Cloud Vision |
| LLM | Ollama (external) or Claude API |
| DICOM | pydicom + Cornerstone.js |
| Auth | bcrypt + signed cookies, OIDC/SSO |
| Deployment | Single Docker container |

## Architecture at a Glance

Asclepius runs as a **single Docker container**. The FastAPI backend serves both the REST API and the pre-built React frontend. All LLM inference happens on external services (your own Ollama instance or the Claude API) -- there is no bundled LLM server.

The processing pipeline runs in a separate background thread, so document ingestion never blocks the web server. Files are organized on the filesystem under a vault directory, with all metadata stored in SQLite.

See [Architecture Overview](architecture/overview.md) for details.
