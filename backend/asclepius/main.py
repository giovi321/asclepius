"""FastAPI application entry point."""

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from asclepius.config import get_config
from asclepius.db.init import initialize_database

# In-memory log buffer for the web UI
from collections import deque

LOG_BUFFER: deque[dict] = deque(maxlen=1000)


class BufferHandler(logging.Handler):
    """Captures log records into an in-memory ring buffer."""
    def emit(self, record):
        try:
            LOG_BUFFER.append({
                "ts": self.format(record).split(" [")[0] if " [" in self.format(record) else "",
                "time": record.created,
                "level": record.levelname,
                "module": record.name,
                "message": record.getMessage(),
            })
        except Exception:
            pass


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

    # Create default admin user if needed
    import aiosqlite
    async with aiosqlite.connect(config.database.path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        from asclepius.auth.session import ensure_admin_exists
        await ensure_admin_exists(db)

    # Start pipeline watcher (imported here to avoid circular imports)
    pipeline_task = None
    if config.pipeline.watch_enabled:
        import asyncio
        from asclepius.pipeline.watcher import start_watcher
        pipeline_task = asyncio.create_task(start_watcher(config))

    yield

    # Shutdown
    if pipeline_task:
        pipeline_task.cancel()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Asclepius",
        description="Self-hosted medical records manager",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://localhost:8070"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
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

    # Serve frontend static files (production build)
    if STATIC_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

        @app.get("/{path:path}")
        async def serve_spa(path: str):
            """Serve frontend SPA — return index.html for all non-API routes."""
            file_path = STATIC_DIR / path
            if file_path.is_file():
                return FileResponse(str(file_path))
            return FileResponse(str(STATIC_DIR / "index.html"))

    return app


app = create_app()
