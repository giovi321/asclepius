# Development Setup

## Prerequisites

- Python 3.12+
- Node.js 20+
- Tesseract OCR installed locally
- An Ollama instance or Claude API key for testing

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

### Install Tesseract OCR

=== "Ubuntu / Debian"

    ```bash
    sudo apt install tesseract-ocr tesseract-ocr-eng tesseract-ocr-ita tesseract-ocr-deu
    ```

=== "macOS"

    ```bash
    brew install tesseract
    ```

=== "Windows"

    Download from [UB Mannheim](https://github.com/UB-Mannheim/tesseract/wiki) and add to PATH.

### Run the Backend

```bash
# Create config
cp config/settings.example.yaml config/settings.yaml
# Edit settings.yaml - configure at least one entry in llm.providers (and, if using the Vision-LLM flow, vision.providers)

# Create vault directories
mkdir -p vault/inbox vault/patients vault/unclassified

# Run with auto-reload
uvicorn asclepius.main:app --reload --port 8000
```

The backend API is available at `http://localhost:8000`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend dev server runs on `http://localhost:5173` and proxies API calls to `http://localhost:8000` (configured in `vite.config.ts`).

## Project Structure

```
asclepius/
├── backend/
│   └── asclepius/
│       ├── main.py              # FastAPI app entry point
│       ├── config.py            # Configuration (YAML + env vars)
│       ├── auth/                # Authentication (session + OIDC)
│       ├── patients/            # Patient CRUD
│       ├── documents/           # Document CRUD + file serving
│       ├── events/              # Medical events CRUD
│       ├── lab_results/         # Lab results API
│       ├── imaging/             # Imaging studies + DICOM
│       ├── chat/                # RAG chat
│       ├── normalization/       # Normalization tables API
│       ├── pipeline/            # Ingestion pipeline
│       │   ├── watcher.py       # File watcher (watchdog)
│       │   ├── processor.py     # Main processing orchestrator
│       │   ├── ocr.py           # OCR engines
│       │   ├── extractor.py     # LLM extraction (classify + extract)
│       │   ├── section_processor.py  # Page-level sectioning
│       │   ├── organizer.py     # File organization
│       │   └── dicom_ingest.py  # DICOM-specific processing
│       ├── llm/                 # LLM providers
│       │   ├── base.py          # Abstract LLM provider
│       │   ├── ollama.py        # Ollama provider
│       │   ├── claude.py        # Claude provider
│       │   ├── prompts.py       # Default prompt templates
│       │   └── prompt_manager.py # Custom prompt management
│       ├── settings/            # Settings + user management API
│       └── db/                  # Database initialization + schema
├── frontend/
│   └── src/
│       ├── App.tsx              # Routes
│       ├── components/          # Reusable components
│       ├── contexts/            # React contexts (Auth, Patient)
│       ├── hooks/               # Custom hooks
│       └── pages/               # Page components
├── config/
│   └── settings.example.yaml   # Example configuration
├── docs/                        # MkDocs documentation
├── docker-compose.yml
└── Dockerfile
```

## Building for Production

The Dockerfile handles the full build:

1. **Stage 1:** Build the React frontend (`npm run build`)
2. **Stage 2:** Set up the Python backend with the built frontend as static files

```bash
docker compose build
docker compose up -d
```

The built frontend is served by FastAPI as static files from `/app/static`.

## Database

The database is initialized automatically on first startup. The schema is defined in `backend/asclepius/db/schema.sql`.

To reset the database during development:

```bash
rm vault/asclepius.sqlite
# Restart the backend
```

A default admin user (`admin` / `admin`) is created on each startup if no users exist.

## Testing

```bash
cd backend
pytest
```

## Useful Commands

```bash
# Rebuild and restart
docker compose up -d --build

# View logs
docker compose logs -f asclepius

# Access the container shell
docker compose exec asclepius bash

# Check database
sqlite3 vault/asclepius.sqlite ".tables"
```
