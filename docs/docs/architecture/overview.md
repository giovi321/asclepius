# Architecture Overview

Asclepius runs as a **single Docker container**. A Python/FastAPI backend serves both the REST API and the pre-built React frontend, and every LLM call goes out to an external service you point it at — there is no bundled model server.

<iframe src="../../assets/diagrams/architecture.html" width="100%" height="660" style="border:0;border-radius:8px;" title="Architecture diagram"></iframe>

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **FastAPI Backend** | REST API, authentication (session + OIDC), database access, file serving, settings management |
| **React Frontend** | Web UI for browsing, searching, managing records, uploading documents, and configuring settings |
| **Processing Pipeline** | File watcher (watchdog), OCR, LLM extraction, page sectioning, file organization. Runs in a background asyncio task |
| **SQLite + FTS5** | All structured data storage with WAL mode for concurrent reads. FTS5 virtual table for full-text search |
| **Tesseract OCR** | Local OCR engine bundled in the container (5 language packs) |
| **Ollama / Claude** | External LLM providers for document classification, data extraction, chat, and AI editing |
| **Vault** | Organized file storage on the filesystem, mounted as a Docker volume |

## Request Flow

1. User interacts with the React UI in the browser
2. UI makes REST API calls to the FastAPI backend
3. Backend validates authentication via signed session cookies (or OIDC)
4. Backend checks authorization via the `user_patient_access` table
5. Backend queries SQLite and serves files from the vault

## Pipeline Flow (High Level)

1. File watcher (watchdog) detects new files in `vault/inbox/`
2. Files are queued with priority (smallest files first)
3. For each file:
    - Compute SHA-256 hash for deduplication
    - Run OCR (Tesseract, LLM Vision, Google Vision, or Remote)
    - If document >5 pages: smart page-level sectioning
    - Phase 1: Classify document type and extract basic metadata
    - Phase 2: Type-specific extraction (lab results, medications, encounters, etc.)
    - Normalize doctor/facility names, match to existing records
    - Organize file into `vault/patients/{slug}/{year}/`
4. Per-document progress tracking (step + current page) visible on Dashboard

See [Processing Pipeline](pipeline.md) for the complete flow.

## Key Design Decisions

- **No ORM**. Raw SQL with aiosqlite. Easier to reason about, easier to optimize, fewer hidden N+1s.
- **SQLite with WAL**. Portable, no extra service to run, fast enough for single-instance use. WAL mode lets the web server keep reading while the pipeline writes.
- **Session-based auth**. Signed cookies via itsdangerous, bcrypt for passwords. No JWTs to rotate or revoke.
- **File-based storage**. Files live on disk under patient/year folders; metadata lives in the database.
- **No bundled LLM**. You point Asclepius at your own Ollama, vLLM, Claude, or OpenAI endpoint. The container stays small and the model lifecycle is yours to manage.
- **Two-phase extraction**. A cheap classification pass runs first; the second pass loads only the type-specific prompt. The LLM never sees a kitchen-sink schema.
- **Pipeline in a background asyncio task**. The web server never blocks on processing. Cancellation works through an in-memory set of cancelled document IDs that the pipeline checks between steps.
- **Runtime pipeline control**. The Settings UI starts and stops the pipeline at runtime via `app.state.pipeline_task`. After five consecutive provider connectivity failures, the pipeline pauses itself.
- **Settings are live**. Configuration changes are written back to YAML and applied to the in-memory config immediately, no restart.
