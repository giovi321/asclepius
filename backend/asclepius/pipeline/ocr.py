"""OCR processing with Tesseract and optional cloud fallback."""

import base64
import logging
from pathlib import Path

import httpx
import fitz  # pymupdf
import pytesseract
from PIL import Image

from asclepius.config import AppConfig, OcrProviderEntry, resolve_credential
from asclepius.config.resolver import _first_enabled_llm
from asclepius.llm.gate import credential_slot, register_credential

logger = logging.getLogger(__name__)


def _resolve_vision_gate_key(
    provider_entry: OcrProviderEntry | None, config: AppConfig,
) -> tuple[str, str, int]:
    """Return ``(credential_id, credential_name, cap)`` for an LLM-vision
    OCR request.

    When the provider entry points at a configured credential, the gate
    keys off the credential's id and honours its ``max_concurrent`` cap.
    Legacy entries with no credential fall back to a synthetic id that
    respects the process-wide ``ocr.max_concurrent_vision_requests``
    setting so they still queue sensibly.
    """
    cred_id = getattr(provider_entry, "credential_id", "") or "" if provider_entry else ""
    cred = resolve_credential(config, cred_id) if cred_id else None
    if cred is not None:
        return cred.id, cred.name or cred.type, max(1, int(cred.max_concurrent or 1))
    synthetic_id = f"legacy-vision-{getattr(provider_entry, 'id', 'default') or 'default'}"
    name = (getattr(provider_entry, "name", "") or "Vision (legacy)") if provider_entry else "Vision (legacy)"
    cap = max(1, int(config.ocr.max_concurrent_vision_requests or 1))
    return synthetic_id, name, cap


async def extract_text(
    file_path: str,
    config: AppConfig,
    ocr_priority: int = 1,
    ocr_provider_id: str | None = None,
) -> tuple[str, float, str]:
    """Extract text from a file using OCR.

    Uses the OCR provider at the given priority rank from the provider list,
    or a specific provider by ID if ocr_provider_id is set.
    Falls back through lower-priority providers if text extraction is empty.
    Falls back to legacy config.ocr.engine if no provider list is configured.

    Returns: (text, confidence, engine_used)
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    # Use a specific OCR provider if requested
    if ocr_provider_id:
        for p in config.ocr.providers:
            if p.id == ocr_provider_id and p.enabled:
                text, confidence, engine = await _extract_with_provider(file_path, config, p)
                if text.strip():
                    return text, confidence, p.name or engine
                logger.warning("OCR provider %s returned empty text, trying next providers", p.name or p.id)
                break
        else:
            logger.warning("OCR provider %s not found or disabled, falling back to default", ocr_provider_id)

    # Try providers in priority order, falling back to next if empty
    enabled_providers = sorted(
        [p for p in config.ocr.providers if p.enabled],
        key=lambda p: p.priority,
    )
    for provider in enabled_providers:
        try:
            text, confidence, engine = await _extract_with_provider(file_path, config, provider)
            if text.strip():
                return text, confidence, provider.name or engine
            logger.warning("OCR provider '%s' (priority %d) returned empty text, trying next", provider.name or provider.id, provider.priority)
        except Exception as e:
            logger.warning("OCR provider '%s' (priority %d) failed: %s, trying next", provider.name or provider.id, provider.priority, e)

    # Legacy fallback (no provider list configured)
    if not enabled_providers:
        if config.ocr.engine == "llm_vision":
            return await _extract_llm_vision(file_path, config)
        if config.ocr.engine == "tesseract_remote" and config.ocr.remote_url:
            return await _extract_remote_ocr(file_path, config)

        if ext == ".pdf":
            return await _extract_from_pdf(path, config)
        elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
            return await _extract_from_image(path, config)

    return "", 0.0, "none"


async def _extract_with_provider(
    file_path: str, config: AppConfig, provider: OcrProviderEntry
) -> tuple[str, float, str]:
    """Route extraction to the correct engine based on provider entry type."""
    path = Path(file_path)
    ext = path.suffix.lower()

    if provider.type == "llm_vision":
        return await _extract_llm_vision(
            file_path, config, provider_entry=provider,
        )
    elif provider.type == "tesseract_remote" and provider.remote_url:
        return await _extract_remote_ocr(
            file_path, config, provider_entry=provider,
        )
    elif provider.type == "google_vision":
        # Google Vision — placeholder, uses the existing cloud fallback path
        logger.warning("Google Vision OCR not yet fully implemented, falling back to Tesseract")
        if ext == ".pdf":
            return await _extract_from_pdf(path, config, provider_entry=provider)
        elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
            return await _extract_from_image(path, config, provider_entry=provider)
        return "", 0.0, "none"
    else:  # tesseract (local)
        if ext == ".pdf":
            return await _extract_from_pdf(path, config, provider_entry=provider)
        elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
            return await _extract_from_image(path, config, provider_entry=provider)
        return "", 0.0, "none"


async def extract_text_per_page(file_path: str, config: AppConfig) -> list[str]:
    """Extract OCR text for each page separately. Returns list of strings, one per page."""
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext != ".pdf":
        # For non-PDF, return the whole text as a single-page list
        text, _, _ = await extract_text(file_path, config)
        return [text] if text.strip() else []

    # For LLM vision, each page is already processed individually
    if config.ocr.engine == "llm_vision":
        doc = fitz.open(str(path))
        pages = []
        for page_idx, page in enumerate(doc):
            b64_image = _render_page_for_vision(page)
            page_text = await _llm_vision_page_with_retry(
                b64_image, config,
                config.ocr.llm_vision_model,
            )
            pages.append(page_text)
        doc.close()
        return pages

    # Try embedded text first, per page
    doc = fitz.open(str(path))
    pages = []
    has_embedded = False

    for page in doc:
        text = page.get_text()
        pages.append(text)
        if text.strip():
            has_embedded = True

    doc.close()

    if has_embedded and any(len(p.strip()) > 20 for p in pages):
        return pages

    # Fall back to Tesseract OCR per page
    doc = fitz.open(str(path))
    ocr_pages = []

    for page in doc:
        pix = page.get_pixmap(dpi=300)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        page_text = pytesseract.image_to_string(img, lang=config.ocr.language)
        ocr_pages.append(page_text)

    doc.close()
    return ocr_pages


async def _extract_from_pdf(path: Path, config: AppConfig, provider_entry: OcrProviderEntry | None = None) -> tuple[str, float, str]:
    """Extract text from PDF — try embedded text first, fall back to OCR."""
    ocr_language = (provider_entry.language if provider_entry else None) or config.ocr.language
    confidence_threshold = (provider_entry.confidence_threshold if provider_entry else None) or config.ocr.confidence_threshold
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

    from asclepius.pipeline.processor import pipeline_status

    pipeline_status["processing_pages"] = total_pages

    for page_idx, page in enumerate(doc):
        pipeline_status["processing_page_current"] = page_idx + 1

        pix = page.get_pixmap(dpi=300)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Get OCR data with confidence
        ocr_data = pytesseract.image_to_data(
            img, lang=ocr_language, output_type=pytesseract.Output.DICT
        )

        page_text = pytesseract.image_to_string(img, lang=ocr_language)
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
    if avg_confidence < confidence_threshold and config.ocr.cloud_ocr_enabled:
        logger.info("Low OCR confidence (%.2f), attempting cloud OCR", avg_confidence)
        return full_text, avg_confidence, "tesseract"

    return full_text, avg_confidence, "tesseract"


async def _extract_from_image(path: Path, config: AppConfig, provider_entry: OcrProviderEntry | None = None) -> tuple[str, float, str]:
    """Extract text from an image file."""
    ocr_language = (provider_entry.language if provider_entry else None) or config.ocr.language
    img = Image.open(str(path))

    ocr_data = pytesseract.image_to_data(
        img, lang=ocr_language, output_type=pytesseract.Output.DICT
    )
    text = pytesseract.image_to_string(img, lang=ocr_language)

    confidences = [
        int(c) for c in ocr_data["conf"] if str(c).isdigit() and int(c) > 0
    ]
    avg_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0

    return text, avg_confidence, "tesseract"


async def _extract_llm_vision(file_path: str, config: AppConfig, provider_entry: OcrProviderEntry | None = None) -> tuple[str, float, str]:
    """Use LLM with vision capability to OCR document pages.

    Renders each page as an image and sends it to the LLM.
    Works with Claude (native vision), OpenAI, or Ollama vision models.
    """

    path = Path(file_path)
    ext = path.suffix.lower()

    from asclepius.pipeline.processor import pipeline_status

    # Determine which model/provider to use — prefer provider_entry if given
    if provider_entry:
        vision_model = provider_entry.llm_model
    else:
        vision_model = config.ocr.llm_vision_model

    if ext == ".pdf":
        doc = fitz.open(str(path))
        total_pages = len(doc)
        pipeline_status["processing_pages"] = total_pages
        text_parts = []

        for page_idx, page in enumerate(doc):
            pipeline_status["processing_page_current"] = page_idx + 1
            logger.info("LLM vision OCR: page %d/%d of %s", page_idx + 1, total_pages, path.name)

            b64_image = _render_page_for_vision(page)
            page_text = await _llm_vision_page_with_retry(b64_image, config, vision_model, provider_entry=provider_entry)
            text_parts.append(page_text)

        doc.close()
        full_text = "\n\n".join(text_parts)
        return full_text, 0.95, "llm_vision"

    elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
        img = Image.open(str(path))
        b64_image = _compress_image_for_vision(img)

        text = await _llm_vision_page_with_retry(b64_image, config, vision_model, provider_entry=provider_entry)
        return text, 0.95, "llm_vision"

    return "", 0.0, "none"


MAX_IMAGE_BYTES = 4_500_000  # Stay under Claude's 5MB limit


def _render_page_for_vision(page) -> str:
    """Render a PDF page to a base64 JPEG, sized to stay under the API limit."""
    # Start with 150 DPI, reduce if too large
    for dpi in [150, 100, 72]:
        pix = page.get_pixmap(dpi=dpi)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        b64 = _compress_image_for_vision(img)
        raw_size = len(base64.b64decode(b64))
        if raw_size <= MAX_IMAGE_BYTES:
            return b64
    # Last resort: very small
    pix = page.get_pixmap(dpi=50)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return _compress_image_for_vision(img, quality=60)


def _compress_image_for_vision(img: Image.Image, quality: int = 85) -> str:
    """Compress an image to JPEG base64, resizing if needed to stay under limit."""
    import io as _io

    # Resize if very large
    max_dim = 2000
    if img.width > max_dim or img.height > max_dim:
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

    # Convert to RGB if needed (RGBA, P, etc.)
    if img.mode != "RGB":
        img = img.convert("RGB")

    # Try JPEG at given quality
    for q in [quality, 70, 50]:
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=q)
        data = buf.getvalue()
        if len(data) <= MAX_IMAGE_BYTES:
            return base64.b64encode(data).decode("utf-8")

    # Absolute fallback
    buf = _io.BytesIO()
    img.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    img.save(buf, format="JPEG", quality=40)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


async def _llm_vision_page_with_retry(
    b64_image: str, config: AppConfig, vision_model: str,
    max_retries: int = 3, provider_entry: OcrProviderEntry | None = None,
) -> str:
    """Call _llm_vision_page with retry + backoff for rate limits and timeouts.

    The actual HTTP request is gated by the per-credential semaphore in
    ``asclepius.llm.gate`` so the vision request shows up as a chip in the
    UI and respects the credential's ``max_concurrent`` setting. Legacy
    entries without a credential fall back to ``ocr.max_concurrent_vision_requests``.
    """
    import asyncio as _asyncio

    cred_id, cred_name, cap = _resolve_vision_gate_key(provider_entry, config)
    # kind="ocr" so the top-bar chip matches the OCR colour/icon used on
    # the Priority/Providers tabs. The one-step Vision-LLM flow stays
    # kind="vision" over in vision_extractor.py.
    register_credential(cred_id, cap, kind="ocr", credential_name=cred_name)

    async def _call() -> str:
        async with credential_slot(
            cred_id, cap, model=vision_model or "", kind="ocr", credential_name=cred_name,
        ):
            return await _llm_vision_page(
                b64_image, config, vision_model, provider_entry=provider_entry,
            )

    for attempt in range(max_retries):
        try:
            return await _call()
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError) as e:
            wait = 30 * (attempt + 1)  # 30s, 60s, 90s
            logger.warning(
                "Vision OCR %s (attempt %d/%d), retrying in %ds...",
                type(e).__name__, attempt + 1, max_retries, wait,
            )
            if attempt < max_retries - 1:
                await _asyncio.sleep(wait)
            else:
                logger.error("Vision OCR failed after %d attempts: %s", max_retries, e)
                return ""  # Return empty text for this page rather than crash
        except Exception as e:
            error_str = str(e)
            if "rate_limit" in error_str or "429" in error_str:
                wait = 30 * (attempt + 1)
                logger.warning("Rate limited, waiting %ds before retry (attempt %d/%d)", wait, attempt + 1, max_retries)
                await _asyncio.sleep(wait)
            elif "exceeds" in error_str and "MB" in error_str:
                logger.error("Image still too large after compression: %s", error_str)
                return ""
            else:
                if attempt < max_retries - 1:
                    wait = 30 * (attempt + 1)
                    logger.warning("Vision OCR error (attempt %d/%d): %s, retrying in %ds...",
                                   attempt + 1, max_retries, e, wait)
                    await _asyncio.sleep(wait)
                else:
                    raise
    # Final attempt without catching
    return await _call()


async def _llm_vision_page(
    b64_image: str, config: AppConfig, vision_model: str,
    provider_entry: OcrProviderEntry | None = None,
) -> str:
    """Send a single page image to the LLM for text extraction.

    Uses the vision-specific provider/model/URL if configured,
    otherwise falls back to the main LLM settings.
    """
    prompt = (
        "Extract ALL text from this medical document image. "
        "Reproduce the text exactly as written, preserving the original language. "
        "Include all headers, dates, names, addresses, values, and notes. "
        "If there are tables, preserve the tabular structure using spaces or pipes. "
        "Do not translate, summarize, or interpret — just transcribe everything you see."
    )

    # Determine which provider to use for vision. When the OCR entry
    # references a credential, prefer the credential's type / base_url /
    # api_key — they're the canonical source. Fall back to the entry's
    # legacy inline fields for unmigrated configs.
    fallback_llm = _first_enabled_llm(config)
    cred = (
        resolve_credential(config, getattr(provider_entry, "credential_id", "") or "")
        if provider_entry else None
    )

    if cred is not None:
        vision_provider = cred.type
    elif provider_entry:
        vision_provider = provider_entry.llm_provider
    else:
        vision_provider = config.ocr.llm_vision_provider or (fallback_llm.type if fallback_llm else "ollama")

    # Get API key from credential, provider entry, or fall back to the
    # first matching LLM provider.
    if cred is not None:
        vision_api_key = cred.api_key
    else:
        vision_api_key = provider_entry.llm_api_key if provider_entry else ""
    if not vision_api_key and vision_provider in ("claude", "openai"):
        for p in config.llm.providers:
            if p.type == vision_provider and p.api_key:
                vision_api_key = p.api_key
                break

    if vision_provider == "claude" and vision_api_key:
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=vision_api_key)
        default_claude_model = next(
            (p.model for p in config.llm.providers if p.type == "claude" and p.enabled),
            "claude-sonnet-4-20250514",
        )
        model = vision_model or default_claude_model

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
                            "media_type": "image/jpeg",
                            "data": b64_image,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        return response.content[0].text

    elif vision_provider == "openai" and vision_api_key:
        # OpenAI vision (GPT-4o etc.)
        model = vision_model or "gpt-4o"
        if cred is not None and cred.base_url:
            base_url = cred.base_url.rstrip("/")
        elif provider_entry and provider_entry.llm_base_url:
            base_url = provider_entry.llm_base_url.rstrip("/")
        else:
            base_url = "https://api.openai.com/v1"
        read_timeout = max(float(config.llm.extraction_timeout), 300.0)
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {vision_api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"}},
                            {"type": "text", "text": prompt},
                        ],
                    }],
                    "max_tokens": 4096,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    else:
        # Ollama with vision model — can use a different URL than the extraction LLM
        default_ollama = next(
            (p for p in config.llm.providers if p.type == "ollama" and p.enabled),
            None,
        ) or fallback_llm
        model = vision_model or (default_ollama.model if default_ollama else "llama3.1")
        if cred is not None and cred.base_url:
            ollama_url = cred.base_url.rstrip("/")
        elif provider_entry and provider_entry.llm_base_url:
            ollama_url = provider_entry.llm_base_url.rstrip("/")
        else:
            ollama_url = (
                config.ocr.llm_vision_ollama_url
                or (default_ollama.base_url if default_ollama else "http://ollama:11434")
            ).rstrip("/")
        # Vision OCR needs a generous timeout — processing a single page image can be slow
        read_timeout = max(float(config.llm.extraction_timeout), 300.0)
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        logger.info("Vision OCR: model=%s, url=%s", model, ollama_url)

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{ollama_url}/api/generate",
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


async def _extract_remote_ocr(file_path: str, config: AppConfig, provider_entry: OcrProviderEntry | None = None) -> tuple[str, float, str]:
    """Send file to a remote Tesseract OCR server.

    The remote server is expected to accept POST with a file upload
    and return JSON: {"text": "...", "confidence": 0.95}
    """
    path = Path(file_path)
    remote_url = (provider_entry.remote_url if provider_entry else None) or config.ocr.remote_url
    remote_api_key = (provider_entry.remote_api_key if provider_entry else None) or config.ocr.remote_api_key
    ocr_language = (provider_entry.language if provider_entry else None) or config.ocr.language
    logger.info("Sending %s to remote OCR server: %s", path.name, remote_url)

    headers = {}
    if remote_api_key:
        headers["Authorization"] = f"Bearer {remote_api_key}"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            with open(file_path, "rb") as f:
                files = {"file": (path.name, f, "application/octet-stream")}
                params = {"language": ocr_language}
                response = await client.post(
                    remote_url,
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
