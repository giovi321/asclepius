"""Vision-LLM extraction flow — alternative to OCR + text-LLM.

Sends each page image directly to a vision-capable LLM with a prompt that asks
for both the transcribed text AND a structured extraction JSON in a single
call. Iterates across ``config.vision.providers`` in priority order so that a
failure on the top provider falls back to the next.
"""

import asyncio
import logging
from pathlib import Path

import httpx
import fitz  # pymupdf
from PIL import Image

from asclepius.config import AppConfig, VisionLlmProviderEntry
from asclepius.llm.json_utils import parse_llm_json
from asclepius.pipeline.extraction_merge import merge_extraction_dicts
from asclepius.pipeline.vision_io import (
    MAX_IMAGE_BYTES,
    MAX_VISION_PIXELS,
    VISION_PATCH_ALIGN,
    call_vision,
    compress_image_for_vision,
    render_page_for_vision,
    resolve_vision_gate_key,
)

logger = logging.getLogger(__name__)

# Canonical image-IO helpers now live in ``vision_io`` (shared with the OCR
# flow). Keep the patch-alignment constants re-exported for callers/tests
# that reference them via this module.
__all__ = [
    "MAX_IMAGE_BYTES",
    "MAX_VISION_PIXELS",
    "VISION_PATCH_ALIGN",
    "extract_with_vision",
]


async def _get_extraction_prompt(config: AppConfig) -> str:
    """Resolve the vision extraction prompt — honors user overrides via prompt_manager
    and prepends the canonical-language directive so free-form fields come back in
    the configured language.
    """
    from asclepius.llm.prompt_manager import get_prompt
    from asclepius.llm.prompts import canonical_language_directive

    prompt = await get_prompt(config.database.path, "vision_extraction")
    return canonical_language_directive(config.llm.canonical_language) + prompt


# ── Image rendering helpers (canonical impls in vision_io) ───────

# These are the patch-aligned, pixel-capped renderer/compressor shared with
# the OCR flow. Aliased here so existing call sites keep working.
_render_page_for_vision = render_page_for_vision
_compress_image_for_vision = compress_image_for_vision


# ── JSON parsing ─────────────────────────────────────────────────


def _parse_vision_extraction(raw: str) -> dict | None:
    """Parse JSON from a vision-LLM response.

    Delegates to the shared ``json_utils.parse_llm_json`` so the vision flow
    inherits its truncation-repair (balanced-brace) recovery in addition to
    the fenced-code-block / surrounding-prose tolerance the old local parser
    had. ``parse_llm_json`` always returns a dict; when parsing genuinely
    fails it returns an ``{"error": ...}`` marker dict, which we translate
    back to ``None`` so the callers' existing ``if parsed:`` branches keep
    treating the raw text as the OCR transcription.
    """
    parsed = parse_llm_json(raw)
    if not parsed or parsed.get("error") == "Failed to parse extraction":
        logger.warning("Failed to parse vision extraction JSON: %s", raw[:200])
        return None
    return parsed


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
    provider entry, honouring its credential when set.

    Thin wrapper over ``vision_io.resolve_vision_gate_key`` pinned to
    ``kind="vision"`` (legacy fallback cap floor of 2).
    """
    return resolve_vision_gate_key(provider, config, kind="vision")


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
    read_timeout = max(float(provider.timeout), 300.0)

    # Per-type model default. The actual transport lives in
    # ``vision_io.call_vision``; this function owns only the vision-flow
    # credential resolution.
    default_model = {
        "claude": "claude-sonnet-4-20250514",
        "openai": "gpt-4o",
    }.get(eff_type, "llama3.2-vision")

    # Note: we intentionally do NOT pass Ollama ``options`` (e.g.
    # {"format": "json"}). On qwen2.5-vl / llama3.2-vision the
    # constrained-grammar sampler interacts badly with the vision pipeline
    # and frequently returns HTTP 500. The prompt asks for strict JSON, and
    # ``_parse_vision_extraction`` already tolerates fenced code blocks /
    # surrounding prose, so the constraint buys us nothing here.
    # ``force_json`` is kept for API compatibility.
    _ = force_json
    return await call_vision(
        provider_type=eff_type,
        b64_image=b64_image,
        prompt=prompt,
        model=provider.model or default_model,
        api_key=eff_api_key,
        base_url=eff_base_url,
        read_timeout=read_timeout,
    )


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

    # Phase 4: route the per-page merge through the canonical merger. Scalar /
    # metadata fields keep their first-non-empty-value-wins behaviour, but the
    # extraction ARRAYS (lab_results, medications, …) now CONCATENATE across
    # pages and dedup by the shared composite keys instead of the old
    # first-page-list-wins. A lab table split across two page images is now
    # fully captured rather than dropped after the first page.
    merged = merge_extraction_dicts(all_extractions, fill_scalars=True)

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
