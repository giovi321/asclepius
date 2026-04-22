---
title: "Contributing"
---

## Code style

### Backend (Python)

- Python 3.12+ with type hints
- No ORM — raw SQL with `aiosqlite`
- Async everywhere (`async def`, `await`)
- Pydantic models for request/response validation
- Logging via `logging.getLogger(__name__)`

### Frontend (TypeScript / React)

- React 18 with functional components and hooks
- TypeScript with strict mode
- Tailwind CSS for styling
- Lucide React for icons
- Vite for building

## Architecture guidelines

- **Keep it simple.** No unnecessary abstractions. Raw SQL is preferred over query builders.
- **Async by default.** All database and HTTP calls should be async.
- **No external state.** All state lives in SQLite or the filesystem. No Redis, no message queues.
- **Single container.** Everything runs in one Docker container. External services (Ollama, Claude) are accessed over HTTP.
- **Settings editable at runtime.** New settings should be persisted to YAML and updatable from the web UI without restart.

## Adding a new document type

1. Add the extraction prompt in `backend/asclepius/llm/prompts.py`
2. Register it in `backend/asclepius/llm/prompt_manager.py` (PROMPT_REGISTRY)
3. Add the type mapping in `backend/asclepius/pipeline/extractor.py`
4. If the type has new data fields, add a migration or table

## Adding a new API endpoint

1. Create or edit the router in the appropriate module under `backend/asclepius/`
2. Register the router in `backend/asclepius/main.py`
3. Add authentication via `Depends(get_current_user)`
4. Add patient access checks where needed via `check_patient_access()`
5. Document the endpoint in `docs/docs/api-reference/endpoints.md`

## Adding a new frontend page

1. Create a page component in `frontend/src/pages/`
2. Add the route in `frontend/src/App.tsx`
3. Add a sidebar entry in `frontend/src/components/layout/AppLayout.tsx`
4. Document the feature in the user guide

## Git workflow

- Direct push to `main` branch (solo developer project)
- Descriptive commit messages

## Reporting issues

Open an issue on [GitHub](https://github.com/giovi321/asclepius/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Relevant logs from `docker compose logs`
