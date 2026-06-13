"""Canonical vision image-IO and per-provider dispatch.

This module is the single source of truth for the helpers that ``ocr.py`` and
``vision_extractor.py`` used to each ship their own (diverged) copy of:

    * ``MAX_IMAGE_BYTES`` — the byte ceiling kept under Claude's 5 MB limit.
    * ``_render_page_for_vision`` — render a PDF page to a base64 JPEG.
    * ``_compress_image_for_vision`` — compress a PIL image to base64 JPEG.
    * ``_resolve_vision_gate_key`` — resolve the per-credential concurrency
      gate key (parameterized by ``kind`` here instead of two copies).
    * ``call_vision`` — send one image + prompt to Claude / OpenAI / Ollama.

The renderer + compressor are the patch-aligned, pixel-capped versions that
``vision_extractor`` used (the ones that DON'T crash qwen2.5-vl). ``ocr.py``
previously thumbnailed to a 2000 px box with no patch alignment, which fed
qwen2.5-vl odd dimensions and tripped ``GGML_ASSERT(a->ne[2]*4 == b->ne[0])``.
Routing both modules through here makes the OCR path inherit the safe sizing.
"""

from __future__ import annotations

import base64
import io
import logging

import httpx
from PIL import Image

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


# ── Image rendering helpers ──────────────────────────────────────


def _resize_for_vision_limits(img: Image.Image) -> Image.Image:
    """Scale down so total pixels stay under ``MAX_VISION_PIXELS``."""
    pixels = img.width * img.height
    if pixels <= MAX_VISION_PIXELS:
        return img
    scale = (MAX_VISION_PIXELS / pixels) ** 0.5
    new_w = max(VISION_PATCH_ALIGN, int(img.width * scale))
    new_h = max(VISION_PATCH_ALIGN, int(img.height * scale))
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)


def _align_to_patch_grid(img: Image.Image) -> Image.Image:
    """Crop the bottom/right edge so each dimension is a multiple of VISION_PATCH_ALIGN."""
    w = (img.width // VISION_PATCH_ALIGN) * VISION_PATCH_ALIGN
    h = (img.height // VISION_PATCH_ALIGN) * VISION_PATCH_ALIGN
    # Guard: never crop below one patch per side — fall back to whatever we have.
    if w < VISION_PATCH_ALIGN or h < VISION_PATCH_ALIGN:
        return img
    if w == img.width and h == img.height:
        return img
    return img.crop((0, 0, w, h))


def render_page_for_vision(page) -> str:
    """Render a PDF page to a base64 JPEG sized to satisfy both the byte and
    pixel budgets enforced in ``compress_image_for_vision``.
    """
    pix = page.get_pixmap(dpi=150)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return compress_image_for_vision(img)


def compress_image_for_vision(img: Image.Image, quality: int = 85) -> str:
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


# ── Concurrency gate-key resolution ──────────────────────────────


def resolve_vision_gate_key(
    provider_entry,
    config,
    *,
    kind: str,
    default_cap: int | None = None,
) -> tuple[str, str, int]:
    """Return ``(credential_id, credential_name, cap)`` for a vision request.

    When ``provider_entry`` references a configured credential, the gate keys
    off the credential's id and honours its ``max_concurrent`` cap. Legacy
    entries with no credential fall back to a synthetic id that respects the
    process-wide concurrency setting for the given ``kind`` so they still
    queue sensibly and show up in the top-bar metrics strip.

    ``kind`` is ``"ocr"`` (OCR + text-LLM flow, falling back to
    ``config.ocr.max_concurrent_vision_requests``) or ``"vision"`` (single-call
    flow, falling back to ``config.vision.max_concurrent_requests``).
    ``default_cap`` overrides the per-kind floor used when both the credential
    cap and the config setting are absent — ``1`` for OCR, ``2`` for vision,
    matching the historical defaults of the two diverged copies.
    """
    from asclepius.config import resolve_credential

    if default_cap is None:
        default_cap = 1 if kind == "ocr" else 2

    cred_id = (getattr(provider_entry, "credential_id", "") or "") if provider_entry else ""
    cred = resolve_credential(config, cred_id) if cred_id else None
    if cred is not None:
        return cred.id, cred.name or cred.type, max(1, int(cred.max_concurrent or default_cap))

    synthetic_id = f"legacy-vision-{getattr(provider_entry, 'id', 'default') or 'default'}"
    name = (
        (getattr(provider_entry, "name", "") or "Vision (legacy)")
        if provider_entry
        else "Vision (legacy)"
    )
    try:
        if kind == "ocr":
            cap = max(1, int(config.ocr.max_concurrent_vision_requests or default_cap))
        else:
            cap = max(1, int(config.vision.max_concurrent_requests or default_cap))
    except Exception:
        cap = default_cap
    return synthetic_id, name, cap


# ── Per-provider image-send dispatch ─────────────────────────────


async def call_vision(
    *,
    provider_type: str,
    b64_image: str,
    prompt: str,
    model: str,
    api_key: str = "",
    base_url: str = "",
    read_timeout: float = 300.0,
    max_tokens: int = 4096,
    ollama_options: dict | None = None,
) -> str:
    """Send one image + prompt to a vision provider and return the raw text.

    Covers the three backends both callers used — Claude (native vision via
    the Anthropic SDK), OpenAI-compatible ``/chat/completions``, and Ollama
    ``/api/generate``. Provider/credential resolution stays in each caller
    (the OCR flow and the vision-extractor flow resolve config differently);
    this function only owns the actual transport once the effective
    ``provider_type`` / ``model`` / ``api_key`` / ``base_url`` are known.

    ``ollama_options`` is passed straight through as the Ollama ``options``
    object — the OCR path sets ``{"num_predict": -1, "num_ctx": 16384}`` so
    dense pages aren't truncated; the vision-extractor path leaves it unset.
    """
    if provider_type == "claude":
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
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

    if provider_type == "openai":
        url = (base_url or "https://api.openai.com/v1").rstrip("/")
        timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{url}/chat/completions",
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
                    "max_tokens": max_tokens,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    # ollama
    ollama_url = (base_url or "http://ollama:11434").rstrip("/")
    timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=10.0, pool=10.0)
    logger.info("Vision dispatch (ollama): model=%s, url=%s", model, ollama_url)
    payload: dict = {
        "model": model,
        "prompt": prompt,
        "images": [b64_image],
        "stream": False,
    }
    if ollama_options:
        payload["options"] = ollama_options
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
