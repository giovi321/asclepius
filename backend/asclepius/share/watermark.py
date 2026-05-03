"""Per-request PDF watermarking for share file responses.

Every PDF served to a share session gets a faint diagonal watermark
burned into each page identifying the recipient, the share id, and the
fetch timestamp. PyMuPDF's ``insert_textbox`` with a transformation
matrix produces a rotated, low-opacity overlay without re-rasterising
the underlying content — fast enough to do on every request.

We never modify the on-disk file: each share-served stream is a fresh
in-memory copy with the overlay applied. The original vault bytes stay
pristine.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime
from pathlib import Path

import fitz

logger = logging.getLogger(__name__)


def watermark_pdf_bytes(
    file_path: Path,
    *,
    label: str,
    opacity: float = 0.20,
) -> bytes:
    """Read ``file_path``, stamp every page, and return the new PDF bytes.

    A failure during stamping is logged and we fall back to streaming the
    raw file — better the doctor sees an unstamped doc than a hard error
    after the OTP flow. The audit log still records the file view, so a
    stamping outage is observable.
    """
    try:
        doc = fitz.open(str(file_path))
    except Exception:
        logger.exception("Failed to open PDF for watermark: %s", file_path)
        return file_path.read_bytes()

    try:
        ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        text = f"{label}  ·  {ts}"
        # Diagonal stamp across the page. Repeated three times along the
        # diagonal so screenshots of any region carry at least one full copy.
        for page in doc:
            rect = page.rect
            for offset in (-0.25, 0.0, 0.25):
                _stamp_diagonal(
                    page,
                    text=text,
                    rect=rect,
                    diagonal_offset=offset,
                    opacity=opacity,
                )

        buf = io.BytesIO()
        doc.save(buf, deflate=True, garbage=3)
        return buf.getvalue()
    except Exception:
        logger.exception("Watermark stamping failed for %s", file_path)
        try:
            return file_path.read_bytes()
        except Exception:
            return b""
    finally:
        try:
            doc.close()
        except Exception:
            pass


def _stamp_diagonal(
    page: "fitz.Page",
    *,
    text: str,
    rect: "fitz.Rect",
    diagonal_offset: float,
    opacity: float,
) -> None:
    """Stamp ``text`` along the page diagonal at low opacity.

    PyMuPDF's ``insert_textbox`` rejects rotations that aren't a multiple
    of 90, so we compose the 45-degree turn with a Shape + ``commit(morph=...)``
    instead. The Shape draws the text horizontally; the Matrix rotates it
    around the box centre, giving us a real diagonal text object — vector,
    selectable, and copy/paste-able from any PDF viewer.

    ``diagonal_offset`` shifts the stamp along the page diagonal: 0.0 is
    the centre, ±0.25 produce two flanking copies. We render three offsets
    so a screenshot of any quadrant carries at least one full copy of the
    label.
    """
    cx, cy = rect.width / 2, rect.height / 2
    dx = rect.width * diagonal_offset
    dy = rect.height * diagonal_offset
    box_w = rect.width * 0.6
    box_h = rect.height * 0.16
    box = fitz.Rect(
        cx + dx - box_w / 2,
        cy + dy - box_h / 2,
        cx + dx + box_w / 2,
        cy + dy + box_h / 2,
    )
    try:
        pivot = fitz.Point(cx + dx, cy + dy)
        rotation = fitz.Matrix(45)  # 45-degree rotation
        shape = page.new_shape()
        shape.insert_textbox(
            box,
            text,
            fontsize=20,
            fontname="helv",
            color=(0.5, 0.5, 0.5),
            fill_opacity=opacity,
            align=fitz.TEXT_ALIGN_CENTER,
            morph=(pivot, rotation),
        )
        shape.commit(overlay=True)
    except Exception:
        # PyMuPDF raises on a few odd page geometries; swallow so a single
        # bad page doesn't blank the whole document.
        logger.debug("diagonal stamp failed for page", exc_info=True)


def watermark_image_bytes(
    file_path: Path,
    *,
    label: str,
    opacity: float = 0.20,
) -> tuple[bytes, str]:
    """Stamp a raster image (jpg/png/tiff) and return (bytes, mime_type).

    We render via Pillow so we don't pull in another dep; the output is
    always PNG to dodge format-specific issues (TIFF transparency, JPEG
    re-compression artefacts).
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        logger.warning("Pillow not available for image watermark — passing through")
        return file_path.read_bytes(), _guess_mime(file_path)

    try:
        img = Image.open(file_path).convert("RGBA")
    except Exception:
        logger.exception("Failed to open image for watermark: %s", file_path)
        return file_path.read_bytes(), _guess_mime(file_path)

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    text = f"{label}  ·  {ts}"
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    alpha = max(0, min(255, int(opacity * 255)))
    # Three repetitions along the diagonal.
    for fraction in (0.25, 0.5, 0.75):
        x = int(img.size[0] * fraction)
        y = int(img.size[1] * fraction)
        draw.text((x, y), text, fill=(80, 80, 80, alpha), font=font)

    out = Image.alpha_composite(img, overlay)
    buf = io.BytesIO()
    out.convert("RGB").save(buf, format="PNG")
    return buf.getvalue(), "image/png"


def _guess_mime(path: Path) -> str:
    suf = path.suffix.lower()
    return {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
    }.get(suf, "application/octet-stream")
