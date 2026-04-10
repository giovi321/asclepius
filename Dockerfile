# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend + built frontend
FROM python:3.12-slim

# System dependencies for Tesseract, PDF rendering, DICOM
RUN apt-get update && apt-get install -y --no-install-recommends \
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

WORKDIR /app

# Install Python dependencies
COPY backend/pyproject.toml .
RUN pip install --no-cache-dir -e .

# Copy backend code
COPY backend/ .

# Copy built frontend
COPY --from=frontend-build /frontend/dist /app/static

# Create vault directories
RUN mkdir -p /vault/inbox /vault/patients /vault/unclassified

EXPOSE 8000

CMD ["uvicorn", "asclepius.main:app", "--host", "0.0.0.0", "--port", "8000"]
