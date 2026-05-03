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

If you've ever spent twenty minutes hunting for a blood test from three years ago, this is for you.

Asclepius takes the pile of PDFs, scans, discharge letters, and phone photos of paper reports that builds up over a lifetime and turns it into something you can actually search. Drop a file into the inbox folder. The app runs OCR, asks an LLM to pull out the dates, diagnoses, lab values, and medications, and files everything under the right person and year.

After that, you can plot a hemoglobin trend across a decade, scroll a timeline of every appointment, or just ask plain-language questions about your history. When a specialist needs to look at part of your file, you can hand them a one-time link plus a 6-digit code instead of emailing PDFs around.

It runs in one Docker container on your own machine. Your records stay there unless you tell them otherwise.

<p align="center">
  <img src="docs/public/assets/diagrams/journey.svg" alt="From a stack of paper to one searchable archive" width="900" />
</p>

## Quick start

```bash
git clone https://github.com/giovi321/asclepius.git
cd asclepius
cp config/settings.example.yaml config/settings.yaml
# edit config/settings.yaml, at minimum point it at one LLM provider
docker compose up -d
```

Open <http://localhost:8070>. A first-launch wizard creates your admin account and your first patient profile, and you're ready to drop files into the inbox.

You'll need an LLM somewhere, a local Ollama instance, a vLLM server, or a Claude or OpenAI API key. The container is small on purpose; the model lives elsewhere.

## What it does

<p align="center">
  <img src="docs/public/assets/diagrams/hero.svg" alt="Asclepius pipeline overview" width="900" />
</p>

- Drops PDFs, images, DICOM files, and DICOM zip bundles (the format every imaging CD ships in) into the pipeline. OCR can be Tesseract, Google Vision, or any LLM with vision; extraction can be Ollama, vLLM, Claude, or OpenAI.
- Long documents (over 5 pages) get split into logical sections, lab block, clinical notes, discharge summary, and each section is extracted on its own.
- Lab results are normalized across visits and languages. A "ferritin" in Italian, a typo'd "Ferrytin" in a German report, and "ferritin (s)" with weird units all end up on the same trend chart.
- A built-in DICOM viewer handles MRI and CT studies with windowing, zoom, and pan, and can attach the radiology PDF report next to the frames so you read the doctor's narrative and the images in the same place.
- The timeline view groups documents into medical events, a diagnosis, a course of treatment, a surgery and the follow-ups around it.
- Full-text search (SQLite FTS5) and a small RAG chat layer let you ask things like _when did I last get a tetanus shot?_
- Multi-patient with role-based access, so you can keep records for a partner or your kids in the same install with separate access.
- When you correct an extracted field, the change is captured and used as a few-shot example for similar documents later.
- Every provider list (OCR, LLM, Vision-LLM) supports priority fallback, so a flaky endpoint hands off to the next one without you noticing.

## Sharing records with an outside doctor

When you need a second opinion, you don't want to attach a stack of scans to an email or hand over your whole archive. Asclepius has a dedicated share surface for outside clinicians: pick the documents that matter, give them a link, read out a code by phone, done.

- **Curated, not all-or-nothing.** Tick one document or many from the list, as long as they belong to the same patient. The doctor sees only what you ticked, never the rest of the file, and free-text encounter notes are hidden by default.
- **One-time link + out-of-band OTP.** The URL alone does nothing. The doctor has to request a 6-digit code on the landing page, and you read it back to them on a separate channel (typically a phone call). Five wrong attempts and the code burns; codes expire after 10 minutes; sessions are an absolute 2 hours with no refresh.
- **Watermarked, no-download viewer.** PDFs are rendered server-side with a faint vector watermark on every page carrying the recipient's name and UTC timestamp. The viewer fetches bytes into memory, so right-click, Ctrl+S, and Ctrl+P are intercepted.
- **Targeted translation, not a free LLM tunnel.** The doctor can translate the current page or drag a rectangle to translate a region. Whole-document translation isn't exposed. Rate-limited per session and per share. You pick which OCR and LLM provider runs the translation, per share or globally.
- **Full audit trail.** Every OTP request, view, file fetch, translate, and logout is logged with timestamp, IP, and user-agent. Revoke kills active sessions instantly.

Full reference: [Doctor shares](docs/src/content/docs/admin-guide/doctor-shares.md).

## Tech stack

| Component  | Technology                                                              |
| ---------- | ----------------------------------------------------------------------- |
| Backend    | Python + FastAPI                                                        |
| Frontend   | React + TypeScript + Vite + shadcn/ui                                   |
| Database   | SQLite (via aiosqlite)                                                  |
| OCR        | Tesseract 5, LLM Vision, Google Vision                                  |
| LLM        | Ollama, vLLM, Claude API, OpenAI API                                    |
| Vision-LLM | Ollama (Qwen2.5-VL, MiniCPM-V, …), Claude vision, GPT-4o                |
| DICOM      | pydicom (server-side render to PNG with optional window-level override) |
| Deployment | Docker Compose                                                          |

## Before you self-host

Asclepius is personal-use software. It is built for one person managing their own family's records on a trusted home network or a single laptop, not a hardened service for the open internet.

A few things stop being safe the moment strangers can reach it:

- The bundled username/password login has no rate limiting, no MFA, and no account lockout. Anyone who can reach port `8070` can hammer it.
- The chat feature lets the LLM author SQLite `SELECT` queries against your medical database. That makes it a prompt-injection target. Hostile content in a document, OCR result, or chat message can coerce the model into reading rows it should not, and SQL injection through the chat tool-call is a real concern if untrusted users can reach the endpoint.
- Files in the inbox flow into LLM prompts, so any document from an untrusted source is a potential injection vector.

For anything beyond a single user on a trusted LAN, front it with an OIDC provider like [Authentik](https://goauthentik.io/), Keycloak, or Auth0, or keep the whole thing behind a VPN. [`SECURITY.md`](SECURITY.md) has the full picture.

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

Contributions are welcome. Two files worth reading first:

- [`CONTRIBUTING.md`](CONTRIBUTING.md), dev setup, coding style, PR checklist
- [`SECURITY.md`](SECURITY.md), how to report a vulnerability privately

Quick starts:

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

Bundled medical reference data (LOINC, ATC, ICD-10) is covered by separate third-party licenses, see [`NOTICE`](NOTICE) for required attributions, including the LOINC short notice required by Section 10 of the LOINC license.
