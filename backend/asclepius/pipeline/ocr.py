"""OCR processing with Tesseract and optional cloud fallback."""

import logging
from pathlib import Path

import fitz  # pymupdf
import pytesseract
from PIL import Image

from asclepius.config import AppConfig

logger = logging.getLogger(__name__)


async def extract_text(file_path: str, config: AppConfig) -> tuple[str, float, str]:
    """Extract text from a file using OCR.

    Returns: (text, confidence, engine_used)
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext == ".pdf":
        return await _extract_from_pdf(path, config)
    elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
        return await _extract_from_image(path, config)
    else:
        return "", 0.0, "none"


async def _extract_from_pdf(path: Path, config: AppConfig) -> tuple[str, float, str]:
    """Extract text from PDF — try embedded text first, fall back to OCR."""
    doc = fitz.open(str(path))
    text_parts = []
    has_text = False

    for page in doc:
        text = page.get_text()
        if text.strip():
            text_parts.append(text)
            has_text = True

    doc.close()

    if has_text:
        full_text = "\n\n".join(text_parts)
        if len(full_text.strip()) > 50:
            # Embedded text is sufficient
            return full_text, 0.95, "embedded"

    # Fall back to OCR — render pages as images
    doc = fitz.open(str(path))
    ocr_parts = []
    total_confidence = 0.0
    page_count = 0

    for page in doc:
        pix = page.get_pixmap(dpi=300)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Get OCR data with confidence
        ocr_data = pytesseract.image_to_data(
            img, lang=config.ocr.language, output_type=pytesseract.Output.DICT
        )

        page_text = pytesseract.image_to_string(img, lang=config.ocr.language)
        ocr_parts.append(page_text)

        # Calculate average confidence
        confidences = [
            int(c) for c in ocr_data["conf"] if str(c).isdigit() and int(c) > 0
        ]
        if confidences:
            total_confidence += sum(confidences) / len(confidences)
            page_count += 1

    doc.close()

    full_text = "\n\n".join(ocr_parts)
    avg_confidence = (total_confidence / page_count / 100.0) if page_count > 0 else 0.0

    # Check if we should use cloud OCR
    if avg_confidence < config.ocr.confidence_threshold and config.ocr.cloud_ocr_enabled:
        logger.info("Low OCR confidence (%.2f), attempting cloud OCR", avg_confidence)
        # Cloud OCR would go here — for now, return Tesseract result
        return full_text, avg_confidence, "tesseract"

    return full_text, avg_confidence, "tesseract"


async def _extract_from_image(path: Path, config: AppConfig) -> tuple[str, float, str]:
    """Extract text from an image file."""
    img = Image.open(str(path))

    ocr_data = pytesseract.image_to_data(
        img, lang=config.ocr.language, output_type=pytesseract.Output.DICT
    )
    text = pytesseract.image_to_string(img, lang=config.ocr.language)

    confidences = [
        int(c) for c in ocr_data["conf"] if str(c).isdigit() and int(c) > 0
    ]
    avg_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0

    return text, avg_confidence, "tesseract"
