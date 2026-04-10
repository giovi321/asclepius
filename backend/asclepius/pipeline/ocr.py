"""OCR processing with Tesseract and optional cloud fallback."""

import logging
from pathlib import Path

import httpx
import fitz  # pymupdf
import pytesseract
from PIL import Image

from asclepius.config import AppConfig

logger = logging.getLogger(__name__)


async def extract_text(file_path: str, config: AppConfig) -> tuple[str, float, str]:
    """Extract text from a file using OCR.

    Routes to the appropriate engine based on config.ocr.engine:
    - 'tesseract': local Tesseract OCR (default)
    - 'tesseract_remote': remote Tesseract server
    - 'llm_vision': send page images to LLM for OCR (combined OCR+extraction)
    - 'google_vision': Google Cloud Vision API

    Returns: (text, confidence, engine_used)
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    # LLM Vision OCR — send page images directly to LLM
    if config.ocr.engine == "llm_vision":
        return await _extract_llm_vision(file_path, config)

    # Remote OCR — send the file directly
    if config.ocr.engine == "tesseract_remote" and config.ocr.remote_url:
        return await _extract_remote_ocr(file_path, config)

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
    total_pages = len(doc)
    ocr_parts = []
    total_confidence = 0.0
    page_count = 0

    # For large documents (>20 pages), process page by page with progress tracking
    from asclepius.pipeline.processor import pipeline_status

    if total_pages > 20:
        pipeline_status["processing_pages"] = total_pages

    for page_idx, page in enumerate(doc):
        if total_pages > 20:
            pipeline_status["processing_page_current"] = page_idx + 1

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


async def _extract_llm_vision(file_path: str, config: AppConfig) -> tuple[str, float, str]:
    """Use LLM with vision capability to OCR document pages.

    Renders each page as an image and sends it to the LLM.
    Works with Claude (native vision) or Ollama vision models (llava, llama3.2-vision).
    """
    import base64
    import io

    path = Path(file_path)
    ext = path.suffix.lower()

    from asclepius.pipeline.processor import pipeline_status

    # Determine which model/provider to use
    vision_model = config.ocr.llm_vision_model

    if ext == ".pdf":
        doc = fitz.open(str(path))
        total_pages = len(doc)
        pipeline_status["processing_pages"] = total_pages
        text_parts = []

        for page_idx, page in enumerate(doc):
            pipeline_status["processing_page_current"] = page_idx + 1
            logger.info("LLM vision OCR: page %d/%d of %s", page_idx + 1, total_pages, path.name)

            # Render page as PNG
            pix = page.get_pixmap(dpi=200)
            img_data = pix.tobytes("png")
            b64_image = base64.b64encode(img_data).decode("utf-8")

            page_text = await _llm_vision_page(b64_image, config, vision_model)
            text_parts.append(page_text)

        doc.close()
        full_text = "\n\n".join(text_parts)
        return full_text, 0.95, "llm_vision"

    elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
        img = Image.open(str(path))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64_image = base64.b64encode(buf.getvalue()).decode("utf-8")

        text = await _llm_vision_page(b64_image, config, vision_model)
        return text, 0.95, "llm_vision"

    return "", 0.0, "none"


async def _llm_vision_page(
    b64_image: str, config: AppConfig, vision_model: str
) -> str:
    """Send a single page image to the LLM for text extraction."""
    prompt = (
        "Extract ALL text from this medical document image. "
        "Reproduce the text exactly as written, preserving the original language. "
        "Include all headers, dates, names, addresses, values, and notes. "
        "If there are tables, preserve the tabular structure using spaces or pipes. "
        "Do not translate, summarize, or interpret — just transcribe everything you see."
    )

    if config.llm.provider == "claude" and config.llm.claude_api_key:
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=config.llm.claude_api_key)
        model = vision_model or config.llm.claude_model

        response = await client.messages.create(
            model=model,
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": b64_image,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        return response.content[0].text

    else:
        # Ollama with vision model
        model = vision_model or config.llm.ollama_model
        timeout = httpx.Timeout(connect=10.0, read=float(config.llm.extraction_timeout), write=10.0, pool=10.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{config.llm.ollama_base_url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "images": [b64_image],
                    "stream": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "")


async def _extract_remote_ocr(file_path: str, config: AppConfig) -> tuple[str, float, str]:
    """Send file to a remote Tesseract OCR server.

    The remote server is expected to accept POST with a file upload
    and return JSON: {"text": "...", "confidence": 0.95}
    """
    path = Path(file_path)
    logger.info("Sending %s to remote OCR server: %s", path.name, config.ocr.remote_url)

    headers = {}
    if config.ocr.remote_api_key:
        headers["Authorization"] = f"Bearer {config.ocr.remote_api_key}"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            with open(file_path, "rb") as f:
                files = {"file": (path.name, f, "application/octet-stream")}
                params = {"language": config.ocr.language}
                response = await client.post(
                    config.ocr.remote_url,
                    files=files,
                    params=params,
                    headers=headers,
                )
                response.raise_for_status()

            result = response.json()
            text = result.get("text", "")
            confidence = float(result.get("confidence", 0.0))
            return text, confidence, "tesseract_remote"

    except Exception as e:
        logger.error("Remote OCR failed for %s: %s — falling back to local", path.name, e)
        # Fallback to local Tesseract
        ext = path.suffix.lower()
        if ext == ".pdf":
            return await _extract_from_pdf(path, config)
        elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
            return await _extract_from_image(path, config)
        return "", 0.0, "none"
