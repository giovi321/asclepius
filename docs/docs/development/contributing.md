# Contributing

## Code Style

### Backend (Python)

- Formatter: ruff
- Line length: 100
- Type hints for function signatures
- No ORM — raw SQL with aiosqlite
- Pydantic models for API request/response

### Frontend (TypeScript)

- React with TypeScript
- Tailwind CSS for styling
- Functional components with hooks

## Testing

Run the test suite before submitting changes:

```bash
cd backend
pytest -v
```

Add tests for new features. Test files go in `backend/tests/`.

## Architecture Guidelines

- **No external services in MVP** — SQLite, filesystem, optionally Ollama/Claude
- **Files never move after ingestion** — all updates are DB-only
- **Every document goes through the LLM** — no metadata-only state
- **Access control on every endpoint** — check `user_patient_access`
- **Normalization over hardcoding** — use the norm tables for translatable terms
