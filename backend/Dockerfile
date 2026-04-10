FROM python:3.12-slim AS base

# System dependencies for Tesseract, PDF rendering, DICOM
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-ita \
    tesseract-ocr-deu \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

# Copy application code
COPY . .

# Create vault directories
RUN mkdir -p /vault/inbox /vault/patients /vault/unclassified

EXPOSE 8000

CMD ["uvicorn", "asclepius.main:app", "--host", "0.0.0.0", "--port", "8000"]
