# syntax=docker/dockerfile:1.7

# ── Stage 1: Build the frontend bundle ─────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY frontend/ .
RUN npm run build

# ── Stage 2: Python runtime + built frontend ───────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# System dependencies for Tesseract, PDF rendering, DICOM, libmagic.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tzdata \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-ita \
        tesseract-ocr-deu \
        tesseract-ocr-fra \
        tesseract-ocr-spa \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender-dev \
        libgl1 \
        libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user to own /app and /data. Running as UID 1000 keeps
# the bind-mounted vault easy to manage from the host.
RUN groupadd --system --gid 1000 asclepius \
 && useradd  --system --uid 1000 --gid asclepius --home /app --shell /usr/sbin/nologin asclepius

WORKDIR /app

# Copy backend code, built frontend, and seed config. We install the
# package after the sources are in place so ``pip install .`` can find
# the ``asclepius`` package described by pyproject.toml.
COPY backend/ .
COPY --from=frontend-build /frontend/dist /app/static
COPY config/ /app/bundled_config/

RUN pip install --no-cache-dir .

# Create data directories and hand ownership to the unprivileged user.
RUN mkdir -p /data/vault/inbox /data/vault/patients /data/vault/unclassified /data/config \
 && chown -R asclepius:asclepius /app /data

USER asclepius

EXPOSE 8000

# Built-in healthcheck — backend exposes /health without auth.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status == 200 else 1)" || exit 1

CMD ["uvicorn", "asclepius.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "120"]
