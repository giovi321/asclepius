# syntax=docker/dockerfile:1.7

# ── Stage 1: Build the frontend bundle ─────────────────────────────
FROM node:25-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY frontend/ .
RUN npm run build

# ── Stage 2: Python runtime + built frontend ───────────────────────
FROM python:3.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# System dependencies for Tesseract, PDF rendering, DICOM, libmagic.
# ``gosu`` lets the entrypoint drop privileges cleanly after fixing up
# ownership of the bind-mounted vault.
#
# ``APT_SECURITY_REFRESH`` busts the build cache for this layer so CI
# re-runs ``apt-get upgrade`` on every build and picks up freshly
# published Debian security patches (otherwise the cached layer keeps
# shipping vulnerable package versions and the Trivy scan fails). CI
# passes a per-run value (see docker.yml); locally it defaults to 0.
ARG APT_SECURITY_REFRESH=0
RUN echo "apt security refresh: ${APT_SECURITY_REFRESH}" \
    && apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        tzdata \
        gosu \
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

# Create the default unprivileged user. Its UID/GID can be overridden at
# runtime via ``PUID`` / ``PGID`` so the bind-mounted vault stays writable
# regardless of the host user's UID.
RUN groupadd --system --gid 1000 asclepius \
 && useradd  --system --uid 1000 --gid asclepius --home /app --shell /usr/sbin/nologin asclepius

WORKDIR /app

# Copy backend code, built frontend, and seed config. We install the
# package after the sources are in place so ``pip install .`` can find
# the ``asclepius`` package described by pyproject.toml.
COPY backend/ .
COPY --from=frontend-build /frontend/dist /app/static
COPY config/ /app/bundled_config/
# Knowledge bases (LOINC / ATC / ICD-10 lookup tables) used by auto-merge —
# separate from seeds because they're read-only side indexes loaded into
# memory, not seeded into the DB. Merges into the same /app/bundled_config/
# destination next to seeds/.
COPY bundled_config/ /app/bundled_config/
COPY docker/entrypoint.sh /usr/local/bin/asclepius-entrypoint
RUN chmod +x /usr/local/bin/asclepius-entrypoint

RUN pip install --no-cache-dir .

# Create data directories owned by the default unprivileged user. These
# are overridden by bind mounts at runtime; the entrypoint will chown
# them back to the target user before dropping privileges.
RUN mkdir -p /data/vault/inbox /data/vault/patients /data/vault/unclassified /data/config \
 && chown -R asclepius:asclepius /app /data

# We intentionally do NOT ``USER asclepius`` here — the entrypoint starts
# as root so it can repair ownership of the bind-mounted vault and then
# ``gosu`` down to the unprivileged user. See docker/entrypoint.sh.

EXPOSE 8000

# Built-in healthcheck — backend exposes /health without auth.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request,sys; p=os.environ.get('ASCLEPIUS_BIND_PORT','8000'); sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{p}/health', timeout=3).status == 200 else 1)" || exit 1

ENTRYPOINT ["/usr/local/bin/asclepius-entrypoint"]
# ``--proxy-headers`` makes uvicorn honor X-Forwarded-Proto / -For from a
# trusted reverse proxy. Tighten the trust list at runtime with the
# ``FORWARDED_ALLOW_IPS`` env var (default: every source — fine for a
# Docker network where only your reverse proxy can reach the container).
CMD ["uvicorn", "asclepius.main:app", "--timeout-keep-alive", "120", "--proxy-headers"]
