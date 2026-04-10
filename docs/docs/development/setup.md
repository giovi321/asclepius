# Development Setup

## Prerequisites

- Python 3.11+
- Node.js 20+
- Tesseract OCR installed locally

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

Create a local config:

```bash
cp config/settings.example.yaml config/settings.yaml
# Edit settings: set vault paths to local directories
```

Run the server:

```bash
uvicorn asclepius.main:app --reload --port 8000
```

### Running Tests

```bash
cd backend
pytest -v
```

Tests use temporary SQLite databases and don't require a running server.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on port 5173 and proxies `/api` to `localhost:8000`.

## Project Structure

```
asclepius/
├── backend/
│   ├── asclepius/                # Main application package
│   │   ├── auth/           # Authentication
│   │   ├── chat/           # RAG chat
│   │   ├── db/             # Database schema and access
│   │   ├── documents/      # Document CRUD
│   │   ├── imaging/        # Medical imaging
│   │   ├── lab_results/    # Lab result queries
│   │   ├── llm/            # LLM abstraction layer
│   │   ├── normalization/  # Term normalization
│   │   ├── patients/       # Patient CRUD
│   │   ├── pipeline/       # Ingestion pipeline
│   │   └── settings/       # Settings API
│   ├── tests/              # Test suite
│   └── pyproject.toml
├── frontend/
│   └── src/
│       ├── api/            # API client
│       ├── components/     # React components
│       ├── contexts/       # React contexts
│       └── pages/          # Page components
├── config/
│   ├── seeds/              # Normalization seed data
│   └── settings.example.yaml
├── docs/                   # MkDocs documentation
└── docker-compose.yml
```
