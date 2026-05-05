"""Shared text-cleanup helpers used across the pipeline."""

from __future__ import annotations

import re

# Vision-LLM (Chandra) emits structured DOM-like output ("<div data-bbox=...>")
# to preserve layout. The semantic content lives in alt=/data-label= attributes.
_ALT_OR_LABEL = re.compile(r'(?:alt|data-label)\s*=\s*"([^"]+)"', re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]*>")


def strip_chandra_markup(text: str) -> str:
    """Strip Chandra/Vision-LLM HTML tags while preserving line breaks.

    Pulls semantic ``alt`` / ``data-label`` values inline so meaningful
    captions ("Hospital logo featuring...") survive even though the raw
    ``<img>`` / ``<div>`` is removed. Keeps newlines intact so downstream
    consumers (translation, full-text reading) retain paragraph structure.
    No-op when ``text`` contains no ``<`` character.
    """
    if not text:
        return ""
    if "<" not in text:
        return text

    def _replace_tag(match: re.Match[str]) -> str:
        tag = match.group(0)
        labels = [m.group(1).strip() for m in _ALT_OR_LABEL.finditer(tag)]
        return (" ".join(labels) + " ") if labels else " "

    cleaned = _HTML_TAG.sub(_replace_tag, text)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()
