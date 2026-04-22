---
title: "Asclepius"
---

<div style="text-align: center; margin-bottom: 1rem;">
  <img src="assets/logo.svg" alt="Asclepius" width="96" height="96" style="border-radius: 12px;" />
</div>

**Self-hosted medical records manager**

Asclepius ingests, OCRs, extracts, organizes, and searches your personal medical records. Drop documents into the inbox (or upload them through the web UI), and the server runs OCR plus an LLM extraction pass, files everything under `patients/{slug}/{year}/`, and makes the whole archive browsable and searchable in a single web app.

:::danger[Not safe to expose to the public internet]
Asclepius is designed to run on a **trusted LAN, a single-user workstation, or behind a VPN / authenticating reverse proxy** — never bound directly to a public IP. The bundled username/password authentication is intentionally minimal: no rate limiting, no MFA, no account lockout, and no brute-force protection.

**For any multi-user or remote-access deployment, configure an OIDC provider such as [Authentik](https://goauthentik.io/), Keycloak, or Auth0** and treat the local-password flow as a single-user convenience only. See [Installation](getting-started/installation.md) and [User Management](admin-guide/user-management.md).
:::

<p align="center">
  <img src="assets/diagrams/hero.svg" alt="Asclepius — drop a file in, get organized records out" />
</p>

## Key Features

- **Automated ingestion**. Drop PDFs, images, or DICOM files into the inbox, or upload them through the web UI.
- **OCR + LLM extraction**. Four OCR engines available (Tesseract, Tesseract Remote, LLM Vision, Google Cloud Vision), then an LLM extraction pass for structured data.
- **Two-phase extraction**. A cheap classification pass runs first; the second pass loads only the type-specific prompt the document needs.
- **Smart page-level sectioning** for documents over 5 pages. The pipeline splits them into logical sections (lab results, clinical notes, discharge summary, etc.) and extracts each one separately.
- **Canonical output language**. Pin every LLM-produced field (summaries, canonical names, findings) to the language you want, regardless of the document's source language.
- **Medical events** group documents around a story: a diagnosis, a treatment course, a surgery. The system suggests likely events.
- **Multi-language input**. Handles English, Italian, German, French, Spanish, and others.
- **Multi-patient** with role-based access control per patient.
- **Lab results** are extracted, normalized, and plotted as interactive trend charts.
- **Medical imaging**. Built-in DICOM viewer with windowing, zoom, and slice scrolling.
- **Timeline view** with mini-map navigation, jump-to-date, and color-coded event types.
- **RAG chat**. Ask questions about a patient's history; the system writes SQL against the structured tables to answer.
- **Full-text search** with SQLite FTS5 over OCR text and extracted metadata.
- **Normalization**. Canonical mapping for lab tests, diagnoses, medications, specialties, doctors, and facilities across languages, with merge and alias tooling.
- **Correction-driven learning**. When you edit an LLM-extracted field, the change is captured and used as a few-shot example next time a similar document arrives.
- **Customizable prompts**. Every LLM prompt is editable from the UI, with one-click reset to default.
- **OIDC / SSO**. Single sign-on with Authentik, Keycloak, or any OIDC provider.
- **Self-hosted**. Your data stays on your server, in one Docker container.

## Quick Start

```bash
git clone https://github.com/giovi321/asclepius.git
cd asclepius
cp config/settings.example.yaml config/settings.yaml
# Edit settings.yaml with your LLM and OCR configuration
docker compose up -d
```

Then open [http://localhost:8070](http://localhost:8070). On first launch, a **setup wizard** will guide you through creating your admin account and first patient profile.

:::tip[Setup Wizard]
The wizard only appears once — when no users exist in the database. It creates your admin account and a first patient profile pre-filled with your name.

:::

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

Asclepius runs as a **single Docker container**. The FastAPI backend serves the REST API and the pre-built React frontend out of the same process. LLM inference is always external — point Asclepius at your own Ollama, vLLM, Claude, or OpenAI endpoint.

The ingestion pipeline runs as a background asyncio task, so processing never blocks HTTP requests. Files live on disk inside a vault directory; all metadata sits in SQLite.

See [Architecture Overview](architecture/overview.md) for the full picture.
