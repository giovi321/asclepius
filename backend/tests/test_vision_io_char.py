"""Characterization tests for the duplicated, DIVERGED vision image-IO helpers.

Two pipeline modules each ship their own copy of the page->image renderer,
the JPEG compressor, the ``MAX_IMAGE_BYTES`` ceiling, and a vision gate-key
resolver:

    * ``asclepius.pipeline.ocr`` — the OCR + text-LLM flow.
    * ``asclepius.pipeline.vision_extractor`` — the single-call vision flow.

The copies have DIVERGED in a way that matters at runtime:

    * ``vision_extractor`` clamps total pixels under ``MAX_VISION_PIXELS`` and
      crops each dimension to a multiple of ``VISION_PATCH_ALIGN`` (28). This
      keeps qwen2.5-vl's patch-merger matmul shape check happy.
    * ``ocr`` instead thumbnails the long edge to 2000px and applies NO patch
      alignment, so the SAME Ollama vision model can crash through the OCR
      path with ``GGML_ASSERT(a->ne[2] * 4 == b->ne[0])``.

These tests pin the BEFORE state of BOTH copies so the unification in
``vision_io.py`` is a visible, intentional diff. They are pure-function tests:
a synthetic PIL image / 1-page in-memory PDF, no network.

After the unification (Step 2/3) the ocr-path assertions are updated to the
UNIFIED, patch-aligned behavior — see the ``# BEHAVIOR CHANGE`` markers below.
The point of the before/after is that the two paths then produce IDENTICAL,
patch-aligned output.
"""

from __future__ import annotations

import base64
import io

import fitz  # pymupdf
from PIL import Image

from asclepius.config import AppConfig, OcrProviderEntry, VisionLlmProviderEntry

# --- modules under characterization ------------------------------------
from asclepius.pipeline import ocr as ocr_mod
from asclepius.pipeline import vision_extractor as vis_mod


# -----------------------------------------------------------------------
# Synthetic inputs (in-memory, no disk, no network).
# -----------------------------------------------------------------------


def _make_image(width: int, height: int) -> Image.Image:
    """A non-trivial RGB gradient so JPEG actually has something to encode."""
    img = Image.new("RGB", (width, height))
    px = img.load()
    for y in range(height):
        for x in range(width):
            px[x, y] = ((x * 7) % 256, (y * 5) % 256, ((x + y) * 3) % 256)
    return img


def _make_one_page_pdf_page(width_pt: float = 612.0, height_pt: float = 792.0):
    """Return a fitz page object for a 1-page in-memory PDF (US Letter)."""
    doc = fitz.open()
    page = doc.new_page(width=width_pt, height=height_pt)
    # Draw something so the rendered pixmap is not a blank white page.
    page.insert_text((72, 72), "Synthetic medical document — characterization")
    rect = fitz.Rect(72, 120, 540, 400)
    page.draw_rect(rect, color=(0, 0, 0), width=1)
    return doc, page


def _decode_jpeg_dims(b64: str) -> tuple[int, int]:
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw))
    return img.width, img.height


def _decoded_format(b64: str) -> str:
    raw = base64.b64decode(b64)
    return Image.open(io.BytesIO(raw)).format


def _decoded_bytes(b64: str) -> int:
    return len(base64.b64decode(b64))


# =======================================================================
# MAX_IMAGE_BYTES — both copies agree on the ceiling.
# =======================================================================


def test_max_image_bytes_constant():
    assert ocr_mod.MAX_IMAGE_BYTES == 4_500_000
    assert vis_mod.MAX_IMAGE_BYTES == 4_500_000


# =======================================================================
# vision_extractor compressor — patch-aligned, pixel-capped (REFERENCE).
# These assertions are UNCHANGED by the unification.
# =======================================================================


def test_vis_compress_format_is_jpeg():
    img = _make_image(640, 480)
    b64 = vis_mod._compress_image_for_vision(img)
    assert _decoded_format(b64) == "JPEG"


def test_vis_compress_under_max_bytes():
    img = _make_image(1500, 1500)
    b64 = vis_mod._compress_image_for_vision(img)
    assert _decoded_bytes(b64) <= vis_mod.MAX_IMAGE_BYTES


def test_vis_compress_dims_are_patch_aligned():
    # A non-multiple-of-28 input must come back cropped to a 28-multiple.
    img = _make_image(801, 603)  # neither dim divisible by 28
    b64 = vis_mod._compress_image_for_vision(img)
    w, h = _decode_jpeg_dims(b64)
    assert w % vis_mod.VISION_PATCH_ALIGN == 0
    assert h % vis_mod.VISION_PATCH_ALIGN == 0


def test_vis_compress_pixels_under_cap():
    # An image above MAX_VISION_PIXELS must be scaled down under the cap.
    img = _make_image(2000, 2000)  # 4,000,000 px > 1,003,520 cap
    b64 = vis_mod._compress_image_for_vision(img)
    w, h = _decode_jpeg_dims(b64)
    assert w * h <= vis_mod.MAX_VISION_PIXELS


def test_vis_render_page_patch_aligned():
    doc, page = _make_one_page_pdf_page()
    try:
        b64 = vis_mod._render_page_for_vision(page)
    finally:
        doc.close()
    assert _decoded_format(b64) == "JPEG"
    w, h = _decode_jpeg_dims(b64)
    assert w % vis_mod.VISION_PATCH_ALIGN == 0
    assert h % vis_mod.VISION_PATCH_ALIGN == 0
    assert w * h <= vis_mod.MAX_VISION_PIXELS
    assert _decoded_bytes(b64) <= vis_mod.MAX_IMAGE_BYTES


# =======================================================================
# ocr.py compressor / renderer.
#
# BEHAVIOR CHANGE (Step 2/3): the ocr-path now delegates to the canonical
# patch-aligned helpers in ``vision_io``. So these assertions are UPDATED
# from the pre-unification BEFORE state (thumbnail to 2000px, NO patch
# alignment, dims free to be any value) to the UNIFIED behavior: dims are
# multiples of VISION_PATCH_ALIGN and total pixels stay under the vision
# pixel cap — IDENTICAL to the vision_extractor path. This deliberate
# change is the qwen2.5-vl crash fix.
# =======================================================================


def test_ocr_compress_format_is_jpeg():
    img = _make_image(640, 480)
    b64 = ocr_mod._compress_image_for_vision(img)
    assert _decoded_format(b64) == "JPEG"


def test_ocr_compress_under_max_bytes():
    img = _make_image(1500, 1500)
    b64 = ocr_mod._compress_image_for_vision(img)
    assert _decoded_bytes(b64) <= ocr_mod.MAX_IMAGE_BYTES


def test_ocr_compress_dims_now_patch_aligned():
    # BEHAVIOR CHANGE: before unification the ocr-path applied no patch
    # alignment and an 801x603 input came back at its (thumbnailed) raw
    # size. After unification it is cropped to a 28-multiple, matching
    # vision_extractor.
    img = _make_image(801, 603)
    b64 = ocr_mod._compress_image_for_vision(img)
    w, h = _decode_jpeg_dims(b64)
    assert w % vis_mod.VISION_PATCH_ALIGN == 0
    assert h % vis_mod.VISION_PATCH_ALIGN == 0


def test_ocr_compress_pixels_now_under_cap():
    # BEHAVIOR CHANGE: before unification a 2000x2000 input was thumbnailed
    # to fit a 2000px box (4,000,000 px, well over the vision cap). After
    # unification it is scaled under MAX_VISION_PIXELS.
    img = _make_image(2000, 2000)
    b64 = ocr_mod._compress_image_for_vision(img)
    w, h = _decode_jpeg_dims(b64)
    assert w * h <= vis_mod.MAX_VISION_PIXELS


def test_ocr_render_page_now_patch_aligned():
    # BEHAVIOR CHANGE: the ocr-path renderer now produces patch-aligned,
    # pixel-capped output identical to vision_extractor's.
    doc, page = _make_one_page_pdf_page()
    try:
        b64 = ocr_mod._render_page_for_vision(page)
    finally:
        doc.close()
    assert _decoded_format(b64) == "JPEG"
    w, h = _decode_jpeg_dims(b64)
    assert w % vis_mod.VISION_PATCH_ALIGN == 0
    assert h % vis_mod.VISION_PATCH_ALIGN == 0
    assert w * h <= vis_mod.MAX_VISION_PIXELS
    assert _decoded_bytes(b64) <= ocr_mod.MAX_IMAGE_BYTES


def test_ocr_and_vis_paths_produce_identical_output():
    # The whole point of the unification: the two compressors now agree
    # byte-for-byte on the same input.
    img_a = _make_image(801, 603)
    img_b = _make_image(801, 603)
    out_ocr = ocr_mod._compress_image_for_vision(img_a)
    out_vis = vis_mod._compress_image_for_vision(img_b)
    assert out_ocr == out_vis

    doc1, page1 = _make_one_page_pdf_page()
    doc2, page2 = _make_one_page_pdf_page()
    try:
        r_ocr = ocr_mod._render_page_for_vision(page1)
        r_vis = vis_mod._render_page_for_vision(page2)
    finally:
        doc1.close()
        doc2.close()
    assert r_ocr == r_vis


# =======================================================================
# Gate-key resolver — parameterized by kind, but the two call sites keep
# their distinct defaults (ocr cap floor 1, vision cap floor 2).
# =======================================================================


def test_ocr_gate_key_legacy_entry_uses_ocr_cap():
    config = AppConfig()
    config.ocr.max_concurrent_vision_requests = 3
    entry = OcrProviderEntry(id="ocr1", type="llm_vision", name="My OCR")
    cred_id, name, cap = ocr_mod._resolve_vision_gate_key(entry, config)
    assert cred_id == "legacy-vision-ocr1"
    assert name == "My OCR"
    assert cap == 3


def test_ocr_gate_key_no_entry_falls_back():
    config = AppConfig()
    config.ocr.max_concurrent_vision_requests = 2
    cred_id, name, cap = ocr_mod._resolve_vision_gate_key(None, config)
    assert cred_id == "legacy-vision-default"
    assert cap == 2


def test_vis_gate_key_legacy_entry_uses_vision_cap():
    config = AppConfig()
    config.vision.max_concurrent_requests = 4
    entry = VisionLlmProviderEntry(id="vis1", type="ollama", name="My Vision")
    cred_id, name, cap = vis_mod._resolve_vision_gate_key(entry, config)
    assert cred_id == "legacy-vision-vis1"
    assert name == "My Vision"
    assert cap == 4
