"""Vision-LLM extraction flow — alternative to OCR + text-LLM.

Sends each page image directly to a vision-capable LLM with a prompt that asks
for both the transcribed text AND a structured extraction JSON in a single
call. Iterates across ``config.vision.providers`` in priority order so that a
failure on the top provider falls back to the next.
"""

import asyncio
import base64
import io
import json
import logging
import re
from pathlib import Path

import httpx
import fitz  # pymupdf
from PIL import Image

from asclepius.config import AppConfig, VisionLlmProviderEntry

logger = logging.getLogger(__name__)


MAX_IMAGE_BYTES = 4_500_000  # Stay under Claude's 5MB limit


async def _get_extraction_prompt(config: AppConfig) -> str:
    """Resolve the vision extraction prompt — honors user overrides via prompt_manager
    and prepends the canonical-language directive so free-form fields come back in
    the configured language.
    """
    from asclepius.llm.prompt_manager import get_prompt
    from asclepius.llm.prompts import canonical_language_directive
    prompt = await get_prompt(config.database.path, "vision_extraction")
    return canonical_language_directive(config.llm.canonical_language) + prompt


# ── Image rendering helpers ──────────────────────────────────────

def _render_page_for_vision(page) -> str:
    """Render a PDF page to a base64 JPEG, sized to stay under the API limit."""
    for dpi in [150, 100, 72]:
        pix = page.get_pixmap(dpi=dpi)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        b64 = _compress_image_for_vision(img)
        raw_size = len(base64.b64decode(b64))
        if raw_size <= MAX_IMAGE_BYTES:
            return b64
    pix = page.get_pixmap(dpi=50)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return _compress_image_for_vision(img, quality=60)


def _compress_image_for_vision(img: Image.Image, quality: int = 85) -> str:
    """Compress an image to JPEG base64, resizing if needed to stay under limit."""
    max_dim = 2000
    if img.width > max_dim or img.height > max_dim:
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

    if img.mode != "RGB":
        img = img.convert("RGB")

    for q in [quality, 70, 50]:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=q)
        data = buf.getvalue()
        if len(data) <= MAX_IMAGE_BYTES:
            return base64.b64encode(data).decode("utf-8")

    buf = io.BytesIO()
    img.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    img.save(buf, format="JPEG", quality=40)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


# ── JSON parsing ─────────────────────────────────────────────────

def _parse_vision_extraction(raw: str) -> dict | None:
    """Parse JSON from a vision-LLM response. Tolerant of fenced code blocks."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    logger.warning("Failed to parse vision extraction JSON: %s", raw[:200])
    return None


# ── Single vision call per provider ──────────────────────────────

async def _vision_call(
    b64_image: str, prompt: str, provider: VisionLlmProviderEntry,
    *, force_json: bool = True,
) -> str:
    """Send an image + prompt to a single vision provider and return raw text.

    ``force_json`` only affects the Ollama backend (sets ``format: "json"``).
    Disable it for health-check calls where the expected reply is plain text.
    """
    if provider.type == "claude":
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=provider.api_key)
        model = provider.model or "claude-sonnet-4-20250514"
        response = await client.messages.create(
            model=model, max_tokens=4096,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64_image}},
                {"type": "text", "text": prompt},
            ]}],
        )
        return response.content[0].text

    if provider.type == "openai":
        base_url = (provider.base_url or "https://api.openai.com/v1").rstrip("/")
        read_timeout = max(float(provider.timeout), 300.0)
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
        model = provider.model or "gpt-4o"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{base_url}/chat/completions", headers=headers,
                json={"model": model, "messages": [{"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"}},
                    {"type": "text", "text": prompt},
                ]}], "max_tokens": 4096},
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    # ollama
    ollama_url = (provider.base_url or "http://ollama:11434").rstrip("/")
    read_timeout = max(float(provider.timeout), 300.0)
    timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
    model = provider.model or "llama3.2-vision"
    logger.info("Vision extraction (ollama): model=%s, url=%s", model, ollama_url)
    payload: dict = {
        "model": model, "prompt": prompt, "images": [b64_image], "stream": False,
    }
    if force_json:
        payload["format"] = "json"
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{ollama_url}/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "")


async def _vision_call_with_retry(
    b64_image: str, prompt: str, provider: VisionLlmProviderEntry,
    max_retries: int, backoff: list[int],
) -> str:
    """Call the vision LLM with retry + backoff on transient failures."""
    attempts = max(max_retries, 0) + 1
    for attempt in range(attempts):
        try:
            return await _vision_call(b64_image, prompt, provider)
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError) as e:
            if attempt >= attempts - 1:
                raise
            wait = backoff[min(attempt, len(backoff) - 1)] if backoff else 30
            logger.warning("Vision %s (attempt %d/%d), retrying in %ds",
                           type(e).__name__, attempt + 1, attempts, wait)
            await asyncio.sleep(wait)
        except Exception as e:
            msg = str(e)
            if ("rate_limit" in msg or "429" in msg) and attempt < attempts - 1:
                wait = backoff[min(attempt, len(backoff) - 1)] if backoff else 30
                logger.warning("Vision rate limited (attempt %d/%d), waiting %ds",
                               attempt + 1, attempts, wait)
                await asyncio.sleep(wait)
                continue
            raise
    raise RuntimeError("vision retry loop exited without return")


# ── Per-provider extraction over all pages ───────────────────────

async def _extract_with_provider(
    file_path: str, config: AppConfig, provider: VisionLlmProviderEntry,
) -> tuple[str, float, str, dict]:
    """Render every page of the document and feed each to the vision provider.

    Returns (full_text, confidence, engine_label, merged_extraction).
    Raises on unrecoverable failure so the caller can fall through to the
    next provider.
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    from asclepius.pipeline.processor import pipeline_status

    max_retries = config.vision.max_retries
    backoff = config.vision.retry_backoff_seconds or [30, 60, 120]
    engine_label = f"vision_llm:{provider.name or provider.id or provider.type}"
    prompt = await _get_extraction_prompt(config)

    all_text_parts: list[str] = []
    all_extractions: list[dict] = []

    if ext == ".pdf":
        doc = fitz.open(str(path))
        total_pages = len(doc)
        pipeline_status["processing_pages"] = total_pages
        try:
            for page_idx, page in enumerate(doc):
                pipeline_status["processing_page_current"] = page_idx + 1
                logger.info("Vision-LLM extraction (provider=%s): page %d/%d of %s",
                            provider.name or provider.id, page_idx + 1, total_pages, path.name)
                b64_image = _render_page_for_vision(page)
                raw = await _vision_call_with_retry(
                    b64_image, prompt, provider, max_retries, backoff,
                )
                parsed = _parse_vision_extraction(raw)
                if parsed:
                    ocr_text = parsed.pop("ocr_text", "")
                    all_text_parts.append(ocr_text)
                    all_extractions.append(parsed)
                else:
                    all_text_parts.append(raw)
        finally:
            doc.close()

    elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".tif"}:
        img = Image.open(str(path))
        b64_image = _compress_image_for_vision(img)
        raw = await _vision_call_with_retry(
            b64_image, prompt, provider, max_retries, backoff,
        )
        parsed = _parse_vision_extraction(raw)
        if parsed:
            ocr_text = parsed.pop("ocr_text", "")
            all_text_parts.append(ocr_text)
            all_extractions.append(parsed)
        else:
            all_text_parts.append(raw)

    else:
        return "", 0.0, "none", {}

    full_text = "\n\n".join(all_text_parts)

    merged: dict = {}
    for ex in all_extractions:
        for key, val in ex.items():
            if val and not merged.get(key):
                merged[key] = val

    if not full_text.strip() and not merged:
        raise RuntimeError(f"vision provider '{provider.name or provider.id}' returned no usable content")

    logger.info("Vision-LLM extraction complete for %s: %d pages, keys=%s",
                path.name, len(all_extractions), list(merged.keys()))

    return full_text, 0.90, engine_label, merged


# ── Public entry point ───────────────────────────────────────────

async def extract_with_vision(
    file_path: str, config: AppConfig, provider_override_id: str | None = None,
) -> tuple[str, float, str, dict]:
    """Run the vision-LLM extraction flow for a file.

    Tries enabled vision providers in priority order. If ``provider_override_id``
    is given and matches an enabled provider, uses that one first; on failure
    still falls through to the rest of the priority list.

    Returns ``(ocr_text, confidence, engine_label, merged_extraction)``. The
    merged_extraction dict holds the classification + universal fields and is
    suitable for passing as ``extraction_override`` to ``extract_and_store``.
    """
    candidates: list[VisionLlmProviderEntry] = []

    if provider_override_id:
        override = next(
            (p for p in config.vision.providers if p.id == provider_override_id and p.enabled),
            None,
        )
        if override:
            candidates.append(override)
        else:
            logger.warning("Vision provider '%s' not found or disabled — falling back to priority order",
                           provider_override_id)

    seen_ids = {p.id for p in candidates}
    for p in sorted(config.vision.providers, key=lambda x: x.priority):
        if p.enabled and p.id not in seen_ids:
            candidates.append(p)
            seen_ids.add(p.id)

    if not candidates:
        raise RuntimeError(
            "No enabled Vision-LLM provider configured. "
            "Add one under Settings → Document Analysis → Vision-LLM Providers."
        )

    last_error: Exception | None = None
    for provider in candidates:
        try:
            return await _extract_with_provider(file_path, config, provider)
        except Exception as e:
            last_error = e
            logger.warning(
                "Vision provider '%s' (priority %d) failed: %s — trying next",
                provider.name or provider.id, provider.priority, e,
            )

    assert last_error is not None
    raise last_error
