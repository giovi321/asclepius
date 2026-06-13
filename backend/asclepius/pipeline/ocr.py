"""OCR processing with Tesseract and optional cloud fallback."""

import logging
from pathlib import Path

import httpx
import fitz  # pymupdf
import pytesseract
from PIL import Image

from asclepius.config import AppConfig, OcrProviderEntry, resolve_credential
from asclepius.config.resolver import _first_enabled_llm, first_enabled_provider
from asclepius.llm.gate import credential_slot, register_credential
from asclepius.pipeline.vision_io import (
    MAX_IMAGE_BYTES as MAX_IMAGE_BYTES,  # re-export for callers/tests
)
from asclepius.pipeline.vision_io import (
    call_vision,
    compress_image_for_vision,
    render_page_for_vision,
    resolve_vision_gate_key,
)

logger = logging.getLogger(__name__)

# Backwards-compatible aliases. The canonical implementations now live in
# ``vision_io`` (patch-aligned renderer/compressor shared with the vision
# flow). ``region_translator`` and a few tests still import these private
# names from ``ocr``, so re-export them here. ``MAX_IMAGE_BYTES`` is also
# re-exported for callers/tests that read it via this module.
_compress_image_for_vision = compress_image_for_vision
_render_page_for_vision = render_page_for_vision


def _resolve_vision_gate_key(
    provider_entry: OcrProviderEntry | None,
    config: AppConfig,
) -> tuple[str, str, int]:
    """Return ``(credential_id, credential_name, cap)`` for an LLM-vision
    OCR request.

    Thin wrapper over ``vision_io.resolve_vision_gate_key`` pinned to
    ``kind="ocr"`` so legacy entries without a credential fall back to
    ``ocr.max_concurrent_vision_requests``.
    """
    return resolve_vision_gate_key(provider_entry, config, kind="ocr")


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
                logger.warning(
                    "OCR provider %s returned empty text, trying next providers", p.name or p.id
                )
                break
        else:
            logger.warning(
                "OCR provider %s not found or disabled, falling back to default", ocr_provider_id
            )

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
            logger.warning(
                "OCR provider '%s' (priority %d) returned empty text, trying next",
                provider.name or provider.id,
                provider.priority,
            )
        except Exception as e:
            logger.warning(
                "OCR provider '%s' (priority %d) failed: %s, trying next",
                provider.name or provider.id,
                provider.priority,
                e,
            )

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
            file_path,
            config,
            provider_entry=provider,
        )
    elif provider.type == "tesseract_remote" and provider.remote_url:
        return await _extract_remote_ocr(
            file_path,
            config,
            provider_entry=provider,
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
                b64_image,
                config,
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


async def extract_text_for_pages(
    file_path: str,
    config: AppConfig,
    page_numbers: list[int],
    ocr_provider_id: str | None = None,
) -> dict[int, str]:
    """Re-OCR a subset of pages from a PDF using the chosen provider.

    Returns a dict mapping each *real* PDF page number (1-indexed) to its
    fresh OCR text. Pages outside the document are silently dropped from
    the result; the caller is expected to validate the request against
    ``documents.page_count`` before calling.

    Used by the AI editor's scoped page reprocess to avoid relying on a
    stale ``ocr_page_cache`` that may have fewer rows than the document
    actually has. The provider lookup mirrors ``extract_text``: an
    ``ocr_provider_id`` from ``config.ocr.providers`` selects the engine
    (Tesseract local/remote or vision LLM); when omitted, the
    highest-priority enabled provider is used.
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext != ".pdf":
        # Single-page formats can't be page-scoped — re-OCR the whole file
        # and surface it under page 1.
        text, _, _ = await extract_text(file_path, config, ocr_provider_id=ocr_provider_id)
        return {1: text} if text.strip() else {}

    # Resolve the provider to use. We mirror the priority logic from
    # ``extract_text`` (chosen id wins, otherwise highest-priority enabled).
    provider: OcrProviderEntry | None = first_enabled_provider(
        config.ocr.providers, ocr_provider_id
    )

    requested = sorted({int(n) for n in page_numbers if int(n) >= 1})
    if not requested:
        return {}

    out: dict[int, str] = {}
    doc = fitz.open(str(path))
    try:
        total_pages = len(doc)
        in_range = [n for n in requested if 1 <= n <= total_pages]
        if not in_range:
            return {}

        if provider is not None and provider.type == "llm_vision":
            vision_model = provider.llm_model or config.ocr.llm_vision_model
            for page_num in in_range:
                page = doc.load_page(page_num - 1)
                b64_image = _render_page_for_vision(page)
                page_text = await _llm_vision_page_with_retry(
                    b64_image, config, vision_model, provider_entry=provider
                )
                out[page_num] = page_text or ""
        elif provider is not None and provider.type == "tesseract_remote":
            # Remote OCR doesn't expose a per-page API; re-render the
            # selected pages locally with Tesseract instead so we still
            # honour the page-scoped request.
            language = (provider.language if provider else None) or config.ocr.language
            for page_num in in_range:
                page = doc.load_page(page_num - 1)
                pix = page.get_pixmap(dpi=300)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                page_text = pytesseract.image_to_string(img, lang=language)
                out[page_num] = page_text or ""
        else:
            # Default: local Tesseract.
            language = (provider.language if provider else None) or config.ocr.language
            for page_num in in_range:
                page = doc.load_page(page_num - 1)
                pix = page.get_pixmap(dpi=300)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                page_text = pytesseract.image_to_string(img, lang=language)
                out[page_num] = page_text or ""
    finally:
        doc.close()

    return out


def list_ocr_providers(config: AppConfig) -> list[dict]:
    """Return enabled OCR providers as a UI-friendly list.

    Used by the AI editor when the user asks to reprocess specific pages —
    the frontend prompts them to pick which engine to re-OCR with, then
    re-submits with ``ocr_provider_id``.
    """
    enabled = sorted(
        [p for p in config.ocr.providers if p.enabled],
        key=lambda p: p.priority,
    )
    items = [
        {
            "id": p.id,
            "name": p.name or p.id or p.type,
            "type": p.type,
            "priority": p.priority,
        }
        for p in enabled
    ]
    if not items:
        # Legacy single-engine config: surface the engine string so the
        # picker still has something selectable.
        items.append(
            {
                "id": "",
                "name": f"Default ({config.ocr.engine})",
                "type": config.ocr.engine,
                "priority": 1,
            }
        )
    return items


def list_llm_providers(config: AppConfig) -> list[dict]:
    """Return enabled text-LLM providers as a UI-friendly list.

    Mirrors ``list_ocr_providers`` for the LLM extraction step that runs
    after re-OCR in the AI editor's scoped page reprocess flow. The
    frontend lets the user pick which LLM should re-extract from the
    chosen pages.
    """
    enabled = sorted(
        [p for p in config.llm.providers if p.enabled],
        key=lambda p: p.priority,
    )
    return [
        {
            "id": p.id,
            "name": p.name or p.id or p.type,
            "type": p.type,
            "model": p.model,
            "priority": p.priority,
        }
        for p in enabled
    ]


async def _extract_from_pdf(
    path: Path, config: AppConfig, provider_entry: OcrProviderEntry | None = None
) -> tuple[str, float, str]:
    """Extract text from PDF — try embedded text first, fall back to OCR."""
    ocr_language = (provider_entry.language if provider_entry else None) or config.ocr.language
    confidence_threshold = (
        provider_entry.confidence_threshold if provider_entry else None
    ) or config.ocr.confidence_threshold
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
        confidences = [int(c) for c in ocr_data["conf"] if str(c).isdigit() and int(c) > 0]
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


async def _extract_from_image(
    path: Path, config: AppConfig, provider_entry: OcrProviderEntry | None = None
) -> tuple[str, float, str]:
    """Extract text from an image file."""
    ocr_language = (provider_entry.language if provider_entry else None) or config.ocr.language
    img = Image.open(str(path))

    ocr_data = pytesseract.image_to_data(
        img, lang=ocr_language, output_type=pytesseract.Output.DICT
    )
    text = pytesseract.image_to_string(img, lang=ocr_language)

    confidences = [int(c) for c in ocr_data["conf"] if str(c).isdigit() and int(c) > 0]
    avg_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0

    return text, avg_confidence, "tesseract"


async def _extract_llm_vision(
    file_path: str, config: AppConfig, provider_entry: OcrProviderEntry | None = None
) -> tuple[str, float, str]:
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
            page_text = await _llm_vision_page_with_retry(
                b64_image, config, vision_model, provider_entry=provider_entry
            )
            text_parts.append(page_text)

        doc.close()
        full_text = "\n\n".join(text_parts)
        return full_text, 0.95, "llm_vision"

    elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
        img = Image.open(str(path))
        b64_image = _compress_image_for_vision(img)

        text = await _llm_vision_page_with_retry(
            b64_image, config, vision_model, provider_entry=provider_entry
        )
        return text, 0.95, "llm_vision"

    return "", 0.0, "none"


async def _llm_vision_page_with_retry(
    b64_image: str,
    config: AppConfig,
    vision_model: str,
    max_retries: int = 3,
    provider_entry: OcrProviderEntry | None = None,
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
            cred_id,
            cap,
            model=vision_model or "",
            kind="ocr",
            credential_name=cred_name,
        ):
            return await _llm_vision_page(
                b64_image,
                config,
                vision_model,
                provider_entry=provider_entry,
            )

    for attempt in range(max_retries):
        try:
            return await _call()
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError) as e:
            wait = 30 * (attempt + 1)  # 30s, 60s, 90s
            logger.warning(
                "Vision OCR %s (attempt %d/%d), retrying in %ds...",
                type(e).__name__,
                attempt + 1,
                max_retries,
                wait,
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
                logger.warning(
                    "Rate limited, waiting %ds before retry (attempt %d/%d)",
                    wait,
                    attempt + 1,
                    max_retries,
                )
                await _asyncio.sleep(wait)
            elif "exceeds" in error_str and "MB" in error_str:
                logger.error("Image still too large after compression: %s", error_str)
                return ""
            else:
                if attempt < max_retries - 1:
                    wait = 30 * (attempt + 1)
                    logger.warning(
                        "Vision OCR error (attempt %d/%d): %s, retrying in %ds...",
                        attempt + 1,
                        max_retries,
                        e,
                        wait,
                    )
                    await _asyncio.sleep(wait)
                else:
                    raise
    # Final attempt without catching
    return await _call()


async def _llm_vision_page(
    b64_image: str,
    config: AppConfig,
    vision_model: str,
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
        if provider_entry
        else None
    )

    if cred is not None:
        vision_provider = cred.type
    elif provider_entry:
        vision_provider = provider_entry.llm_provider
    else:
        vision_provider = config.ocr.llm_vision_provider or (
            fallback_llm.type if fallback_llm else "ollama"
        )

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

    # The actual per-provider transport lives in ``vision_io.call_vision``;
    # this function owns only the OCR-flow config/credential resolution and
    # the OCR prompt. Vision OCR needs a generous read timeout — a single
    # dense page can be slow.
    read_timeout = max(float(config.llm.extraction_timeout), 300.0)

    if vision_provider == "claude" and vision_api_key:
        default_claude_model = next(
            (p.model for p in config.llm.providers if p.type == "claude" and p.enabled),
            "claude-sonnet-4-20250514",
        )
        return await call_vision(
            provider_type="claude",
            b64_image=b64_image,
            prompt=prompt,
            model=vision_model or default_claude_model,
            api_key=vision_api_key,
            read_timeout=read_timeout,
        )

    elif vision_provider == "openai" and vision_api_key:
        # OpenAI vision (GPT-4o etc.)
        if cred is not None and cred.base_url:
            base_url = cred.base_url
        elif provider_entry and provider_entry.llm_base_url:
            base_url = provider_entry.llm_base_url
        else:
            base_url = "https://api.openai.com/v1"
        return await call_vision(
            provider_type="openai",
            b64_image=b64_image,
            prompt=prompt,
            model=vision_model or "gpt-4o",
            api_key=vision_api_key,
            base_url=base_url,
            read_timeout=read_timeout,
        )

    else:
        # Ollama with vision model — can use a different URL than the extraction LLM
        default_ollama = (
            next(
                (p for p in config.llm.providers if p.type == "ollama" and p.enabled),
                None,
            )
            or fallback_llm
        )
        model = vision_model or (default_ollama.model if default_ollama else "llama3.1")
        if cred is not None and cred.base_url:
            ollama_url = cred.base_url
        elif provider_entry and provider_entry.llm_base_url:
            ollama_url = provider_entry.llm_base_url
        else:
            ollama_url = config.ocr.llm_vision_ollama_url or (
                default_ollama.base_url if default_ollama else "http://ollama:11434"
            )
        # Without an explicit num_predict, Ollama caps generation at the
        # model's Modelfile default (often 2048 or even 128 tokens). Dense
        # pages and HTML-tagged Chandra output blow past that and the
        # response gets cut mid-sentence. -1 = generate until the model
        # emits eos. num_ctx is also raised so the request doesn't quietly
        # truncate the input prompt + image embedding.
        return await call_vision(
            provider_type="ollama",
            b64_image=b64_image,
            prompt=prompt,
            model=model,
            base_url=ollama_url,
            read_timeout=read_timeout,
            ollama_options={"num_predict": -1, "num_ctx": 16384},
        )


async def _extract_remote_ocr(
    file_path: str, config: AppConfig, provider_entry: OcrProviderEntry | None = None
) -> tuple[str, float, str]:
    """Send file to a remote Tesseract OCR server.

    The remote server is expected to accept POST with a file upload
    and return JSON: {"text": "...", "confidence": 0.95}
    """
    path = Path(file_path)
    remote_url = (provider_entry.remote_url if provider_entry else None) or config.ocr.remote_url
    remote_api_key = (
        provider_entry.remote_api_key if provider_entry else None
    ) or config.ocr.remote_api_key
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
