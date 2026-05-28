"""FastAPI application entry point.

Wires together the lifespan (DB init, pipeline watcher), middleware stack
(security headers, CSRF, request-size limit, optional CORS), API routers,
and the frontend SPA fallback.

Two run modes, selected by the ``ASCLEPIUS_MODE`` env var:

* ``core`` (default) — full app: admin, doctor, pipeline, settings, every
  router. Background watcher and backup scheduler run here.
* ``share`` — public doctor-share surface only. Mounts ``share_public_router``
  and ``share_doctor_router`` (both at ``/api/share``) and refuses every
  other path. Used in a second container that is the only one exposed to
  the internet, so opening the share URL never reveals the rest of the app.
"""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from asclepius.config import get_config
from asclepius.db.init import initialize_database
from asclepius.middleware import (
    CsrfMiddleware,
    ErrorAuditMiddleware,
    MaxBodySizeMiddleware,
    SecurityHeadersMiddleware,
)
from asclepius.util.paths import is_within

# In-memory log buffer for the web UI
from collections import deque

LOG_BUFFER: deque[dict] = deque(maxlen=1000)


class BufferHandler(logging.Handler):
    """Captures log records into an in-memory ring buffer."""

    def emit(self, record):
        import time

        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        LOG_BUFFER.append(
            {
                "ts": ts,
                "time": record.created,
                "level": record.levelname,
                "module": record.name,
                "message": record.getMessage(),
            }
        )


# Configure logging — show all asclepius modules at INFO level
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
    force=True,
)

# Add buffer handler to capture logs for web UI
buffer_handler = BufferHandler()
buffer_handler.setLevel(logging.DEBUG)
buffer_handler.setFormatter(logging.Formatter("%(asctime)s", datefmt="%Y-%m-%d %H:%M:%S"))
logging.getLogger("asclepius").addHandler(buffer_handler)

# Set asclepius loggers to DEBUG for detailed output
logging.getLogger("asclepius").setLevel(logging.DEBUG)
# Keep noisy libraries at WARNING
logging.getLogger("watchdog").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("anthropic").setLevel(logging.WARNING)

# Uvicorn pre-configures its own loggers with handlers that lack timestamps and
# sets propagate=False, so its lines bypass our root formatter. Strip those
# handlers and let records propagate up so every line is timestamped.
for _uv_name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
    _uv_logger = logging.getLogger(_uv_name)
    for _h in list(_uv_logger.handlers):
        _uv_logger.removeHandler(_h)
    _uv_logger.propagate = True

STATIC_DIR = Path(__file__).parent.parent / "static"


def _get_mode() -> str:
    """Return the run mode (``core`` or ``share``); defaults to ``core``."""
    raw = os.environ.get("ASCLEPIUS_MODE", "core").strip().lower()
    return raw if raw in ("core", "share") else "core"


# Catch-all SPA paths allowed in share mode. Empty string covers the root URL.
SHARE_SPA_PATHS = {"", "share"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown."""
    config = get_config()
    mode = _get_mode()
    logging.getLogger("asclepius").info("Starting Asclepius in %s mode", mode)

    # Ensure vault directories exist
    for dir_path in [
        config.vault.root_path,
        config.vault.inbox_path,
        config.vault.patients_path,
        config.vault.unclassified_path,
    ]:
        Path(dir_path).mkdir(parents=True, exist_ok=True)

    # Initialize database
    await initialize_database(config.database.path)

    # Note: no default admin user is created — the setup wizard handles first-user creation

    # Background tasks: full inbox watcher + backup scheduler only in core
    # mode. Share mode still needs an in-process pipeline worker so the
    # doctor's translate requests have a local consumer for their queue
    # jobs, but without the inbox observer that would race the core
    # container.
    app.state.pipeline_task = None
    app.state.pipeline_auto_stopped = False
    app.state.pipeline_auto_stop_reason = ""
    app.state.backup_task = None

    if mode == "core":
        if config.pipeline.watch_enabled:
            import asyncio
            from asclepius.pipeline.watcher import start_watcher

            app.state.pipeline_task = asyncio.create_task(start_watcher(config, app.state))

        if config.backup.enabled:
            import asyncio
            from asclepius.backup.scheduler import start_backup_scheduler

            app.state.backup_task = asyncio.create_task(start_backup_scheduler(config, app.state))
    elif mode == "share":
        import asyncio
        from asclepius.pipeline.watcher import start_translate_worker

        app.state.pipeline_task = asyncio.create_task(start_translate_worker(config, app.state))

    yield

    # Shutdown
    if app.state.pipeline_task:
        app.state.pipeline_task.cancel()
    if app.state.backup_task:
        app.state.backup_task.cancel()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Asclepius",
        description="Self-hosted medical records manager",
        version="1.1.3",
        lifespan=lifespan,
    )

    config = get_config()

    # Middleware order matters — ASGI executes them in reverse-registration
    # order, so the *last* added middleware runs first on the way in. We
    # want: size-cap → CSRF → error-audit → security headers → app.
    app.add_middleware(SecurityHeadersMiddleware, config=config)
    app.add_middleware(ErrorAuditMiddleware)
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(MaxBodySizeMiddleware, max_bytes=config.server.max_upload_bytes)

    # CORS is only required when the frontend runs on a different origin
    # (Vite dev server). In production the SPA is served from the same
    # origin, so we skip CORS entirely to reduce attack surface.
    if config.server.environment.lower() != "production" and config.server.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=config.server.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "X-Requested-With"],
        )

    mode = _get_mode()

    # Health check
    @app.get("/health")
    async def health():
        return {"status": "ok", "mode": mode}

    # Doctor-share routers (public OTP/session bootstrap + read surface) are
    # mounted in BOTH modes — they are the entire purpose of share mode and
    # part of the regular admin app in core mode.
    from asclepius.share.public_routes import router as share_public_router

    app.include_router(share_public_router, prefix="/api/share", tags=["share-public"])

    from asclepius.share.doctor_routes import router as share_doctor_router

    app.include_router(share_doctor_router, prefix="/api/share", tags=["share-doctor"])

    # All other routers — admin auth, patient CRUD, pipeline, settings, vault,
    # setup wizard, plus the share *admin* router that mints/revokes tokens —
    # are core-only. The share container does NOT mount them, so they cannot
    # be reached from the public port even with a valid admin password.
    if mode == "core":
        from asclepius.auth.routes import router as auth_router

        app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

        from asclepius.auth.oidc import router as oidc_router

        app.include_router(oidc_router, prefix="/api/auth", tags=["oidc"])

        from asclepius.patients.routes import router as patients_router

        app.include_router(patients_router, prefix="/api/patients", tags=["patients"])

        from asclepius.documents.routes import router as documents_router

        app.include_router(documents_router, prefix="/api/documents", tags=["documents"])

        # Child-record edits live at /api/encounters/{id} and /api/medications/{id}
        # — separate prefix because they don't pivot on a document id in the URL.
        from asclepius.documents.child_routes import router as child_router

        app.include_router(child_router, prefix="/api", tags=["records"])

        from asclepius.events.routes import router as events_router

        app.include_router(events_router, prefix="/api/events", tags=["events"])

        from asclepius.lab_results.routes import router as lab_results_router

        app.include_router(lab_results_router, prefix="/api/lab-results", tags=["lab-results"])

        from asclepius.imaging.routes import router as imaging_router

        app.include_router(imaging_router, prefix="/api/imaging", tags=["imaging"])

        from asclepius.chat.routes import router as chat_router

        app.include_router(chat_router, prefix="/api/chat", tags=["chat"])

        from asclepius.normalization.routes import router as normalization_router

        app.include_router(
            normalization_router, prefix="/api/normalization", tags=["normalization"]
        )

        from asclepius.pipeline.routes import router as pipeline_router

        app.include_router(pipeline_router, prefix="/api/pipeline", tags=["pipeline"])

        from asclepius.settings.routes import router as settings_router

        app.include_router(settings_router, prefix="/api/settings", tags=["settings"])

        from asclepius.vault.routes import router as vault_router

        app.include_router(vault_router, prefix="/api/vault", tags=["vault"])

        from asclepius.setup.routes import router as setup_router

        app.include_router(setup_router, prefix="/api/setup", tags=["setup"])

        from asclepius.share.admin_routes import router as share_admin_router

        app.include_router(share_admin_router, prefix="/api/shares", tags=["shares"])

    # Serve frontend static files (production build)
    if STATIC_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

        @app.get("/{path:path}")
        async def serve_spa(path: str):
            """Serve frontend SPA — return index.html for all non-API routes.

            Guards against path traversal: any request that resolves outside
            ``STATIC_DIR`` (``..`` segments, symlinks pointing out, etc.)
            falls back to ``index.html`` instead of leaking host files.

            In ``share`` mode, the SPA shell is only returned for the share
            allowlist (``/``, ``/share``, ``/share/...``). Anything else,
            including unmounted ``/api/*`` paths that fall through to this
            handler, returns 404 so the public surface never reveals the
            admin app's existence.
            """
            file_path = STATIC_DIR / path
            if is_within(STATIC_DIR, file_path) and file_path.is_file():
                return FileResponse(str(file_path.resolve()))
            if mode == "share":
                first_segment = path.split("/", 1)[0]
                if first_segment not in SHARE_SPA_PATHS:
                    return JSONResponse({"detail": "Not found"}, status_code=404)
            index = STATIC_DIR / "index.html"
            if not index.exists():
                return JSONResponse({"detail": "Frontend not built"}, status_code=404)
            return FileResponse(str(index))

    return app


app = create_app()
