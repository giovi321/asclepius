"""FastAPI application entry point.

Wires together the lifespan (DB init, pipeline watcher), middleware stack
(security headers, CSRF, request-size limit, optional CORS), API routers,
and the frontend SPA fallback.
"""

import logging
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
        LOG_BUFFER.append({
            "ts": ts,
            "time": record.created,
            "level": record.levelname,
            "module": record.name,
            "message": record.getMessage(),
        })


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

STATIC_DIR = Path(__file__).parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown."""
    config = get_config()

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

    # Start pipeline watcher (imported here to avoid circular imports)
    app.state.pipeline_task = None
    app.state.pipeline_auto_stopped = False
    app.state.pipeline_auto_stop_reason = ""
    if config.pipeline.watch_enabled:
        import asyncio
        from asclepius.pipeline.watcher import start_watcher
        app.state.pipeline_task = asyncio.create_task(start_watcher(config, app.state))

    # Start backup scheduler if enabled
    app.state.backup_task = None
    if config.backup.enabled:
        import asyncio
        from asclepius.backup.scheduler import start_backup_scheduler
        app.state.backup_task = asyncio.create_task(start_backup_scheduler(config, app.state))

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
        version="0.9.0",
        lifespan=lifespan,
    )

    config = get_config()

    # Middleware order matters — ASGI executes them in reverse-registration
    # order, so the *last* added middleware runs first on the way in. We
    # want: size-cap → CSRF → security headers → app.
    app.add_middleware(SecurityHeadersMiddleware, config=config)
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

    # Health check
    @app.get("/health")
    async def health():
        return {"status": "ok"}

    # Register routers (will be added as they're implemented)
    from asclepius.auth.routes import router as auth_router
    app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

    from asclepius.auth.oidc import router as oidc_router
    app.include_router(oidc_router, prefix="/api/auth", tags=["oidc"])

    from asclepius.patients.routes import router as patients_router
    app.include_router(patients_router, prefix="/api/patients", tags=["patients"])

    from asclepius.documents.routes import router as documents_router
    app.include_router(documents_router, prefix="/api/documents", tags=["documents"])

    from asclepius.events.routes import router as events_router
    app.include_router(events_router, prefix="/api/events", tags=["events"])

    from asclepius.lab_results.routes import router as lab_results_router
    app.include_router(lab_results_router, prefix="/api/lab-results", tags=["lab-results"])

    from asclepius.imaging.routes import router as imaging_router
    app.include_router(imaging_router, prefix="/api/imaging", tags=["imaging"])

    from asclepius.chat.routes import router as chat_router
    app.include_router(chat_router, prefix="/api/chat", tags=["chat"])

    from asclepius.normalization.routes import router as normalization_router
    app.include_router(normalization_router, prefix="/api/normalization", tags=["normalization"])

    from asclepius.pipeline.routes import router as pipeline_router
    app.include_router(pipeline_router, prefix="/api/pipeline", tags=["pipeline"])

    from asclepius.settings.routes import router as settings_router
    app.include_router(settings_router, prefix="/api/settings", tags=["settings"])

    from asclepius.vault.routes import router as vault_router
    app.include_router(vault_router, prefix="/api/vault", tags=["vault"])

    from asclepius.setup.routes import router as setup_router
    app.include_router(setup_router, prefix="/api/setup", tags=["setup"])

    # Serve frontend static files (production build)
    if STATIC_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

        @app.get("/{path:path}")
        async def serve_spa(path: str):
            """Serve frontend SPA — return index.html for all non-API routes.

            Guards against path traversal: any request that resolves outside
            ``STATIC_DIR`` (``..`` segments, symlinks pointing out, etc.)
            falls back to ``index.html`` instead of leaking host files.
            """
            file_path = (STATIC_DIR / path)
            if is_within(STATIC_DIR, file_path) and file_path.is_file():
                return FileResponse(str(file_path.resolve()))
            index = STATIC_DIR / "index.html"
            if not index.exists():
                return JSONResponse({"detail": "Frontend not built"}, status_code=404)
            return FileResponse(str(index))

    return app


app = create_app()
