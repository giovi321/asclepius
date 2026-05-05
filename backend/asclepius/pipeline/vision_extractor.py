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

# Qwen2.5-VL uses 14x14 patches with a 2x2 spatial merger, so the model
# requires each dimension to be a multiple of 28 AND the resulting patch count
# per dimension to be even. If these constraints aren't met, Ollama's vision
# encoder crashes with ``GGML_ASSERT(a->ne[2] * 4 == b->ne[0])``.
# Llama3.2-vision uses 14x14 patches without the 2x2 merger, so 28-alignment
# is strictly more than it needs and causes no harm.
VISION_PATCH_ALIGN = 28

# Qwen2.5-VL's default ``max_pixels`` is ``28*28*1280 ≈ 1,003,520``. Images
# exceeding it get internally downscaled by Ollama to odd dimensions that no
# longer satisfy the patch-merger shape check, which is where the GGML_ASSERT
# fires. Scale images below this cap before we hand them off, so we control
# the final dimensions instead of the server.
MAX_VISION_PIXELS = 1_003_520


def _resize_for_vision_limits(img: "Image.Image") -> "Image.Image":
    """Scale down so total pixels stay under ``MAX_VISION_PIXELS``."""
    pixels = img.width * img.height
    if pixels <= MAX_VISION_PIXELS:
        return img
    scale = (MAX_VISION_PIXELS / pixels) ** 0.5
    new_w = max(VISION_PATCH_ALIGN, int(img.width * scale))
    new_h = max(VISION_PATCH_ALIGN, int(img.height * scale))
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)


def _align_to_patch_grid(img: "Image.Image") -> "Image.Image":
    """Crop the bottom/right edge so each dimension is a multiple of VISION_PATCH_ALIGN."""
    w = (img.width // VISION_PATCH_ALIGN) * VISION_PATCH_ALIGN
    h = (img.height // VISION_PATCH_ALIGN) * VISION_PATCH_ALIGN
    # Guard: never crop below one patch per side — fall back to whatever we have.
    if w < VISION_PATCH_ALIGN or h < VISION_PATCH_ALIGN:
        return img
    if w == img.width and h == img.height:
        return img
    return img.crop((0, 0, w, h))


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
    """Render a PDF page to a base64 JPEG sized to satisfy both the byte and
    pixel budgets enforced in ``_compress_image_for_vision``.
    """
    pix = page.get_pixmap(dpi=150)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return _compress_image_for_vision(img)


def _compress_image_for_vision(img: Image.Image, quality: int = 85) -> str:
    """Compress an image to JPEG base64, resizing if needed to stay under limits.

    Two constraints:
    - Total pixels stay under ``MAX_VISION_PIXELS`` (the vision model's cap)
      so the server doesn't downscale and produce unaligned dimensions.
    - Final dimensions are multiples of ``VISION_PATCH_ALIGN`` so qwen2.5-vl's
      patch-merger matmul shape check passes.
    """
    if img.mode != "RGB":
        img = img.convert("RGB")

    img = _resize_for_vision_limits(img)
    img = _align_to_patch_grid(img)

    for q in [quality, 70, 50]:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=q)
        data = buf.getvalue()
        if len(data) <= MAX_IMAGE_BYTES:
            return base64.b64encode(data).decode("utf-8")

    # Fallback: halve the dimensions and try again. Never exceed a patch grid.
    halved = img.resize(
        (max(VISION_PATCH_ALIGN, img.width // 2), max(VISION_PATCH_ALIGN, img.height // 2)),
        Image.Resampling.LANCZOS,
    )
    halved = _align_to_patch_grid(halved)
    buf = io.BytesIO()
    halved.save(buf, format="JPEG", quality=40)
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


# ── Concurrency guard ────────────────────────────────────────────

# Concurrency is gated per-credential by asclepius.llm.gate. When a vision
# provider entry references a credential, the credential's ``max_concurrent``
# sets the cap; legacy entries without a credential fall back to the
# process-wide ``vision.max_concurrent_requests`` via a synthetic id so
# they still queue sensibly and show up in the top-bar metrics strip.


def _resolve_vision_gate_key(
    provider: VisionLlmProviderEntry,
    config,
) -> tuple[str, str, int]:
    """Return ``(credential_id, credential_name, cap)`` for a vision
    provider entry, honouring its credential when set."""
    from asclepius.config import resolve_credential

    cred_id = getattr(provider, "credential_id", "") or ""
    cred = resolve_credential(config, cred_id) if cred_id else None
    if cred is not None:
        return cred.id, cred.name or cred.type, max(1, int(cred.max_concurrent or 2))
    synthetic_id = f"legacy-vision-{provider.id or 'default'}"
    name = provider.name or "Vision (legacy)"
    try:
        cap = max(1, int(config.vision.max_concurrent_requests or 2))
    except Exception:
        cap = 2
    return synthetic_id, name, cap


# ── Single vision call per provider ──────────────────────────────


async def _vision_call(
    b64_image: str,
    prompt: str,
    provider: VisionLlmProviderEntry,
    *,
    force_json: bool = True,
) -> str:
    """Send an image + prompt to a single vision provider and return raw text.

    ``force_json`` only affects the Ollama backend (sets ``format: "json"``).
    Disable it for health-check calls where the expected reply is plain text.
    """
    # Resolve credential (if referenced) — its base_url/api_key/type win
    # over the entry's legacy inline fields.
    from asclepius.config import get_config, resolve_credential

    cred = resolve_credential(get_config(), getattr(provider, "credential_id", "") or "")
    eff_type = cred.type if cred is not None else provider.type
    eff_base_url = (
        cred.base_url if cred is not None and cred.base_url else provider.base_url
    ) or ""
    eff_api_key = cred.api_key if cred is not None and cred.api_key else provider.api_key

    if eff_type == "claude":
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=eff_api_key)
        model = provider.model or "claude-sonnet-4-20250514"
        response = await client.messages.create(
            model=model,
            max_tokens=4096,
            messages=[
                {
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
                }
            ],
        )
        return response.content[0].text

    if eff_type == "openai":
        base_url = (eff_base_url or "https://api.openai.com/v1").rstrip("/")
        read_timeout = max(float(provider.timeout), 300.0)
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {eff_api_key}", "Content-Type": "application/json"}
        model = provider.model or "gpt-4o"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"},
                                },
                                {"type": "text", "text": prompt},
                            ],
                        }
                    ],
                    "max_tokens": 4096,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    # ollama
    ollama_url = (eff_base_url or "http://ollama:11434").rstrip("/")
    read_timeout = max(float(provider.timeout), 300.0)
    timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
    model = provider.model or "llama3.2-vision"
    logger.info("Vision extraction (ollama): model=%s, url=%s", model, ollama_url)
    payload: dict = {
        "model": model,
        "prompt": prompt,
        "images": [b64_image],
        "stream": False,
    }
    # Note: we intentionally do NOT set {"format": "json"} for Ollama. On
    # qwen2.5-vl / llama3.2-vision the constrained-grammar sampler interacts
    # badly with the vision pipeline and frequently returns HTTP 500. The
    # prompt asks for strict JSON, and ``_parse_vision_extraction`` already
    # tolerates fenced code blocks or surrounding prose, so the constraint
    # buys us nothing here. ``force_json`` is kept for API compatibility.
    _ = force_json
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{ollama_url}/api/generate", json=payload)
        if resp.status_code >= 400:
            body = resp.text[:500]
            raise httpx.HTTPStatusError(
                f"Ollama {resp.status_code} from {ollama_url}: {body}",
                request=resp.request,
                response=resp,
            )
        return resp.json().get("response", "")


async def _vision_call_with_retry(
    b64_image: str,
    prompt: str,
    provider: VisionLlmProviderEntry,
    max_retries: int,
    backoff: list[int],
) -> str:
    """Call the vision LLM with retry + backoff on transient failures.

    Transient = connect/read timeouts, connection errors, rate limits (429),
    and server errors (HTTP 5xx — Ollama's vision pipeline can return 500
    on a flaky page but succeed on a retry).
    """
    from asclepius.config import get_config
    from asclepius.llm.gate import credential_slot, register_credential

    cred_id, cred_name, cap = _resolve_vision_gate_key(provider, get_config())
    register_credential(cred_id, cap, kind="vision", credential_name=cred_name)

    attempts = max(max_retries, 0) + 1
    for attempt in range(attempts):
        try:
            async with credential_slot(
                cred_id,
                cap,
                model=provider.model or "",
                kind="vision",
                credential_name=cred_name,
            ):
                return await _vision_call(b64_image, prompt, provider)
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError) as e:
            if attempt >= attempts - 1:
                raise
            wait = backoff[min(attempt, len(backoff) - 1)] if backoff else 30
            logger.warning(
                "Vision %s (attempt %d/%d), retrying in %ds",
                type(e).__name__,
                attempt + 1,
                attempts,
                wait,
            )
            await asyncio.sleep(wait)
        except httpx.HTTPStatusError as e:
            status = e.response.status_code if e.response is not None else 0
            is_transient = status == 429 or status >= 500
            if is_transient and attempt < attempts - 1:
                wait = backoff[min(attempt, len(backoff) - 1)] if backoff else 30
                logger.warning(
                    "Vision HTTP %d (attempt %d/%d), retrying in %ds: %s",
                    status,
                    attempt + 1,
                    attempts,
                    wait,
                    str(e)[:300],
                )
                await asyncio.sleep(wait)
                continue
            raise
        except Exception as e:
            msg = str(e)
            if ("rate_limit" in msg or "429" in msg) and attempt < attempts - 1:
                wait = backoff[min(attempt, len(backoff) - 1)] if backoff else 30
                logger.warning(
                    "Vision rate limited (attempt %d/%d), waiting %ds", attempt + 1, attempts, wait
                )
                await asyncio.sleep(wait)
                continue
            raise
    raise RuntimeError("vision retry loop exited without return")


# ── Per-provider extraction over all pages ───────────────────────


async def _extract_with_provider(
    file_path: str,
    config: AppConfig,
    provider: VisionLlmProviderEntry,
) -> tuple[str, float, str, dict, VisionLlmProviderEntry]:
    """Render every page of the document and feed each to the vision provider.

    Returns (full_text, confidence, engine_label, merged_extraction, provider).
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
                logger.info(
                    "Vision-LLM extraction (provider=%s): page %d/%d of %s",
                    provider.name or provider.id,
                    page_idx + 1,
                    total_pages,
                    path.name,
                )
                b64_image = _render_page_for_vision(page)
                raw = await _vision_call_with_retry(
                    b64_image,
                    prompt,
                    provider,
                    max_retries,
                    backoff,
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
            b64_image,
            prompt,
            provider,
            max_retries,
            backoff,
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
        raise RuntimeError(
            f"vision provider '{provider.name or provider.id}' returned no usable content"
        )

    logger.info(
        "Vision-LLM extraction complete for %s: %d pages, keys=%s",
        path.name,
        len(all_extractions),
        list(merged.keys()),
    )

    return full_text, 0.90, engine_label, merged, provider


# ── Public entry point ───────────────────────────────────────────


async def extract_with_vision(
    file_path: str,
    config: AppConfig,
    provider_override_id: str | None = None,
) -> tuple[str, float, str, dict, VisionLlmProviderEntry]:
    """Run the vision-LLM extraction flow for a file.

    Tries enabled vision providers in priority order. If ``provider_override_id``
    is given and matches an enabled provider, uses that one first; on failure
    still falls through to the rest of the priority list.

    Returns ``(ocr_text, confidence, engine_label, merged_extraction, provider_used)``.
    The merged_extraction dict holds the classification + universal fields and
    is suitable for passing as ``extraction_override`` to ``extract_and_store``;
    ``provider_used`` is the VisionLlmProviderEntry that actually produced the
    result (after fallback), so the caller can reuse its config for Phase 2.
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
            logger.warning(
                "Vision provider '%s' not found or disabled — falling back to priority order",
                provider_override_id,
            )

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
                provider.name or provider.id,
                provider.priority,
                e,
            )

    assert last_error is not None
    raise last_error
