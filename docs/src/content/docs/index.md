---
title: "Asclepius"
---

<div style="text-align: center; margin-bottom: 1rem;">
  <img src="assets/logo.svg" alt="Asclepius" width="96" height="96" style="border-radius: 12px;" />
</div>

**Self-hosted medical records manager**

Asclepius ingests, OCRs, extracts, organizes, and searches your personal medical records. Drop documents into the inbox (or upload them through the web UI), and the server runs OCR plus an LLM extraction pass, files everything under `patients/{slug}/{year}/`, and makes the whole archive browsable and searchable in a single web app.

:::danger[Personal-use software, not safe to expose to the public internet]
Asclepius is built for one person managing their own family's records, not a hardened service for the open internet. It is designed to run on a **trusted LAN, a single-user workstation, or behind a VPN / authenticating reverse proxy**, never bound directly to a public IP.

The bundled username/password authentication is intentionally minimal: no rate limiting, no MFA, no account lockout, and no brute-force protection. The chat feature lets the LLM author SQLite `SELECT` queries against your medical database, which makes it a prompt-injection target and exposes a SQL injection surface if untrusted users can reach the chat endpoint. Documents in the inbox flow into LLM prompts as well, so files from untrusted sources can carry injection payloads.

**For any multi-user or remote-access deployment, configure an OIDC provider such as [Authentik](https://goauthentik.io/), Keycloak, or Auth0** and treat the local-password flow as a single-user convenience only. See [Installation](getting-started/installation.md) and [User Management](admin-guide/user-management.md).
:::

<div class="diagram-frame">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 360" role="img" aria-label="Asclepius — drop a file in, get organized records out">
  <defs>
    <pattern id="dots-hero" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.9" fill="rgba(28,25,23,0.10)"/>
    </pattern>
    <marker id="arrow-hero" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#57534e"/>
    </marker>
    <marker id="arrow-hero-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#8E4449"/>
    </marker>
    <style>
      .eyebrow{font-family:'Geist Mono','SF Mono',Menlo,monospace;font-size:9px;letter-spacing:0.2em;fill:#78716c;}
      .name{font-family:'Geist','Inter',system-ui,sans-serif;font-weight:600;font-size:13px;fill:#1c1917;}
      .sub{font-family:'Geist Mono','SF Mono',Menlo,monospace;font-size:10px;fill:#57534e;}
      .label{font-family:'Geist Mono','SF Mono',Menlo,monospace;font-size:9px;fill:#57534e;letter-spacing:0.06em;}
      .label-accent{font-family:'Geist Mono','SF Mono',Menlo,monospace;font-size:9px;fill:#8E4449;letter-spacing:0.06em;}
      .title{font-family:'Instrument Serif',Georgia,serif;font-size:22px;fill:#1c1917;}
      .ital{font-family:'Instrument Serif',Georgia,serif;font-style:italic;font-size:14px;fill:#57534e;}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#faf7f2"/>
  <rect width="100%" height="100%" fill="url(#dots-hero)" opacity="0.6"/>
  <text x="40" y="44" class="eyebrow">ASCLEPIUS · OVERVIEW</text>
  <text x="40" y="76" class="title">Drop a file in, get organized medical records out</text>
  <line x1="208" y1="200" x2="288" y2="200" stroke="#57534e" stroke-width="1" marker-end="url(#arrow-hero)"/>
  <line x1="468" y1="200" x2="548" y2="200" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-hero-accent)"/>
  <line x1="728" y1="200" x2="808" y2="200" stroke="#57534e" stroke-width="1" marker-end="url(#arrow-hero)"/>
  <rect x="222" y="184" width="52" height="14" rx="2" fill="#faf7f2"/>
  <text x="248" y="194" class="label" text-anchor="middle">WATCH</text>
  <rect x="486" y="184" width="48" height="14" rx="2" fill="#faf7f2"/>
  <text x="510" y="194" class="label-accent" text-anchor="middle">EXTRACT</text>
  <rect x="742" y="184" width="48" height="14" rx="2" fill="#faf7f2"/>
  <text x="766" y="194" class="label" text-anchor="middle">STORE</text>
  <rect x="40" y="140" width="168" height="120" rx="6" fill="rgba(87,83,78,0.10)" stroke="#78716c" stroke-width="1"/>
  <rect x="48" y="148" width="44" height="14" rx="2" fill="transparent" stroke="rgba(120,113,108,0.40)" stroke-width="0.8"/>
  <text x="70" y="158" font-family="'Geist Mono','SF Mono',Menlo,monospace" font-size="8" fill="rgba(120,113,108,0.9)" text-anchor="middle" letter-spacing="0.08em">INBOX</text>
  <text x="124" y="190" class="name" text-anchor="middle">PDF · image · DICOM</text>
  <text x="124" y="208" class="sub" text-anchor="middle">vault/inbox/user-X/</text>
  <text x="124" y="232" class="ital" text-anchor="middle">drop or upload</text>
  <rect x="288" y="120" width="180" height="160" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
  <rect x="296" y="128" width="56" height="14" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
  <text x="324" y="138" font-family="'Geist Mono','SF Mono',Menlo,monospace" font-size="8" fill="#8E4449" text-anchor="middle" letter-spacing="0.08em">PIPELINE</text>
  <text x="378" y="170" class="name" text-anchor="middle">OCR + LLM</text>
  <text x="378" y="186" class="sub" text-anchor="middle">tesseract · gvision</text>
  <text x="378" y="200" class="sub" text-anchor="middle">ollama · vllm · claude</text>
  <text x="378" y="222" class="name" text-anchor="middle">— or —</text>
  <text x="378" y="244" class="name" text-anchor="middle">Vision-LLM</text>
  <text x="378" y="260" class="sub" text-anchor="middle">qwen2.5-vl · gpt-4o</text>
  <rect x="548" y="140" width="180" height="120" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
  <rect x="556" y="148" width="48" height="14" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
  <text x="580" y="158" font-family="'Geist Mono','SF Mono',Menlo,monospace" font-size="8" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">DATA</text>
  <text x="638" y="184" class="name" text-anchor="middle">Structured records</text>
  <text x="638" y="202" class="sub" text-anchor="middle">labs · meds · diagnoses</text>
  <text x="638" y="216" class="sub" text-anchor="middle">imaging · invoices</text>
  <text x="638" y="240" class="ital" text-anchor="middle">SQLite + FTS5</text>
  <rect x="808" y="140" width="132" height="120" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
  <rect x="816" y="148" width="44" height="14" rx="2" fill="transparent" stroke="rgba(87,83,78,0.40)" stroke-width="0.8"/>
  <text x="838" y="158" font-family="'Geist Mono','SF Mono',Menlo,monospace" font-size="8" fill="rgba(87,83,78,0.9)" text-anchor="middle" letter-spacing="0.08em">VAULT</text>
  <text x="874" y="186" class="name" text-anchor="middle">patient/year/</text>
  <text x="874" y="204" class="sub" text-anchor="middle">{date}_{provider}</text>
  <text x="874" y="216" class="sub" text-anchor="middle">_{doctype}.pdf</text>
  <text x="874" y="240" class="ital" text-anchor="middle">+ web UI</text>
  <line x1="40" y1="304" x2="940" y2="304" stroke="rgba(28,25,23,0.10)" stroke-width="0.8"/>
  <text x="40" y="324" class="ital">Self-hosted. Single Docker container. Bring your own LLM.</text>
  <text x="940" y="324" class="label" text-anchor="end">github.com/giovi321/asclepius</text>
</svg>
</div>

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
docker compose up -d
```

Then open [http://localhost:8070](http://localhost:8070). On first launch, a **setup wizard** will guide you through creating your admin account and first patient profile. Once logged in, configure your LLM and OCR providers from the **Settings** page; saved settings are persisted to `./data/settings.yaml`.

:::tip[Setup Wizard]
The wizard only appears once, when no users exist in the database. It creates your admin account and a first patient profile pre-filled with your name.

:::

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.13 + FastAPI |
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Database | SQLite with WAL mode + FTS5 |
| OCR | Tesseract 5, LLM Vision, Google Cloud Vision |
| LLM | Ollama (external) or Claude API |
| DICOM | pydicom + Cornerstone.js |
| Auth | bcrypt + signed cookies, OIDC/SSO |
| Deployment | Single Docker container |

## Architecture at a Glance

Asclepius runs as a **single Docker container**. The FastAPI backend serves the REST API and the pre-built React frontend out of the same process. LLM inference is always external, point Asclepius at your own Ollama, vLLM, Claude, or OpenAI endpoint.

The ingestion pipeline runs as a background asyncio task, so processing never blocks HTTP requests. Files live on disk inside a vault directory; all metadata sits in SQLite.

See [Architecture Overview](architecture/overview.md) for the full picture.
