---
title: "Contributing"
---

## Code style

### Backend (Python)

- Python 3.12+ with type hints
- No ORM, raw SQL with `aiosqlite`
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

The `doc_type` enum is intentionally small (10 values, one axis: document
format). Specialty information lives on its own column and should not be
added to `doc_type`. Before adding a new type, check whether the document
format genuinely doesn't fit one of the existing values.

1. Add the new value to `VALID_DOC_TYPES` in `backend/asclepius/pipeline/extractor.py` and to `_DOC_TYPE_ALIASES` if there are obvious LLM-misspellings to catch.
2. Add the new value to `DOC_TYPE_OPTIONS` in `frontend/src/components/document-detail/MetadataEditor.tsx` and `DOC_TYPES` in `frontend/src/components/documents/columns.ts`.
3. Add a color entry in `TYPE_COLORS` in `frontend/src/pages/TimelinePage.tsx`.
4. Update the doc_type enum string in the three classification prompts: `classification.yaml`, `vision_extraction.yaml`, `extraction_legacy.yaml`.
5. (Optional) If the new type needs its own Phase-2 schema, add `extraction_<key>.yaml` under `prompts_data/` and register it in `PROMPT_REGISTRY` + `PROMPT_VARIABLE_KEYS` in `backend/asclepius/llm/prompt_manager.py`. Without an extraction yaml, Phase 2 is skipped for that type and only Phase-1 metadata + summary are stored.
6. If the type has new data fields, add a migration or table.

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

### Pre-commit hooks

The repo's `.pre-commit-config.yaml` ships hooks for `ruff` (backend lint + format), `prettier` (frontend / docs / yaml format), trailing-whitespace / EOL-fixer / yaml-syntax checks, large-file detection, and an **openapi-drift** check that auto-regenerates `frontend/src/openapi.json` + `frontend/src/api/schema.ts` whenever a backend `.py` file is staged. Install once per clone:

```bash
pip install pre-commit
pre-commit install
```

When the openapi-drift hook detects changes, it stages the regenerated artefacts and aborts the commit with `Files were modified by this hook`. Re-run `git commit` and it succeeds with the new artefacts included.

CI runs the same `ruff`, `prettier`, and `openapi-drift` checks on every push, so a PR that skipped the hook still fails the build.

## Reporting issues

Open an issue on [GitHub](https://github.com/giovi321/asclepius/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Relevant logs from `docker compose logs`
