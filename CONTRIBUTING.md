# Contributing to Asclepius

Thanks for your interest in improving Asclepius! This guide covers the
mechanics of contributing code, docs, tests, and bug reports.

## Table of contents

- [Ground rules](#ground-rules)
- [Development environment](#development-environment)
- [Running the stack](#running-the-stack)
- [Testing and linting](#testing-and-linting)
- [Commit style](#commit-style)
- [Pull request checklist](#pull-request-checklist)
- [Architecture pointers](#architecture-pointers)
- [Security-sensitive changes](#security-sensitive-changes)

## Ground rules

- Be respectful — see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Open an issue before starting large changes so we can discuss design.
- **Do not open public issues for security problems.** See
  [`SECURITY.md`](SECURITY.md).
- Keep PRs focused. Split refactors from behavior changes.
- All contributions are licensed under the project's [MIT License](LICENSE).

## Development environment

Requirements:

- Python 3.11 or 3.12
- Node.js 20+
- Tesseract 5 (only if you are touching the OCR pipeline)
- `libmagic` (used for upload MIME sniffing)

Clone and set up both sides:

```bash
git clone https://github.com/<your-fork>/asclepius.git
cd asclepius

# Backend
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Frontend
cd ../frontend
npm install
```

Copy `.env.example` to `.env` and set `SECRET_KEY` to a random string (the
backend will refuse to start with the placeholder in production mode):

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

For local development, set `ASCLEPIUS_ENV=development` and
`ASCLEPIUS_COOKIE_SECURE=0` so the app works over plain HTTP.

## Running the stack

```bash
# Terminal 1 — backend
cd backend
uvicorn asclepius.main:app --reload

# Terminal 2 — frontend
cd frontend
npm run dev
```

The Vite dev server proxies `/api/*` to the backend. Hit
http://localhost:5173.

For a production-style run use Docker Compose:

```bash
docker compose up --build
```

## Testing and linting

Backend:

```bash
cd backend
ruff check .
ruff format --check .
pytest
```

Frontend:

```bash
cd frontend
npx tsc --noEmit
npm run build
```

New code should ship with tests where practical. The security-sensitive
areas (`auth/`, `chat/`, `documents/`, `pipeline/`) must have tests that
cover both the happy path and the failure modes.

## Commit style

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(chat): add per-patient source citation
fix(documents): reject paths that escape the vault root
docs(readme): note ASCLEPIUS_ENV=development
chore(deps): bump fastapi to 0.116
```

Keep commits small and self-explanatory — we squash on merge but a clean
history during review makes the work easier to follow.

## Pull request checklist

Before opening a PR, check:

- [ ] Tests pass locally (`pytest`, `npx tsc --noEmit`, `npm run build`).
- [ ] `ruff check .` and `ruff format --check .` are clean.
- [ ] Public/async functions you added have a short docstring.
- [ ] Any new environment variable is documented in `.env.example` and the
      docs.
- [ ] Schema changes include a migration in `backend/asclepius/db/init.py`.
- [ ] You did not commit API keys, real PHI, or binary fixtures larger
      than 100 KB.
- [ ] If you changed a security-relevant area, you added a test that
      exercises the failure mode.

## Architecture pointers

- `backend/asclepius/main.py` — FastAPI app factory, middleware stack.
- `backend/asclepius/auth/` — session cookies, OIDC, password hashing.
- `backend/asclepius/documents/` — CRUD, upload, file serving, rename.
- `backend/asclepius/pipeline/` — OCR → LLM extraction → organizer.
- `backend/asclepius/chat/` — RAG over the SQLite database; the SQL
  sanitiser lives here.
- `backend/asclepius/util/paths.py` — the **only** place filesystem paths
  from user input should be assembled. Use `safe_vault_join` and
  `safe_filename` unconditionally.
- `frontend/src/pages/` — one component per route.
- `frontend/src/api/client.ts` — shared axios instance (sends the CSRF
  header automatically).

## Security-sensitive changes

If your change touches auth, file handling, chat SQL, or ACL checks:

1. Open an issue first to agree on the approach.
2. Add or update tests under `backend/tests/` covering the failure mode
   (e.g. path-traversal attempts, CSRF-missing requests).
3. Update [`SECURITY.md`](SECURITY.md) if you are changing the threat
   model or adding a new configuration knob.

Thanks again for contributing!
