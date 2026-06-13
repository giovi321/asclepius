"""Shared text-to-slug helpers.

Two slug shapes exist in the codebase and they are *not* interchangeable —
they differ on accented / punctuation-heavy input, so they are kept as two
distinct functions rather than collapsed into one:

- ``slugify`` (display-name shape): strips every char outside
  ``[a-z0-9\\s-]`` *before* turning whitespace into hyphens. Accented
  letters are dropped entirely ("Müller" → "mller"). Used for patient /
  event folder names where stability of an existing slug matters.

- ``slugify_loose`` (filename-stem shape): turns any run of non-alphanumeric
  characters straight into a single hyphen, so accented letters become a
  separator ("café" → "caf"). Used for AI-generated filename stems and the
  summary fallback.

Both lowercase, collapse repeated hyphens, and strip leading/trailing
hyphens. ``max_length`` truncates the final slug when given.
"""

from __future__ import annotations

import re

_SLUG_DROP_RE = re.compile(r"[^a-z0-9\s-]")
_SLUG_WS_RE = re.compile(r"[\s]+")
_SLUG_LOOSE_RE = re.compile(r"[^a-z0-9]+")
_SLUG_COLLAPSE_RE = re.compile(r"-+")


def slugify(name: str, *, max_length: int | None = None) -> str:
    """Display-name slug: ``"Dr. Hans Müller"`` -> ``"dr-hans-mller"``.

    Drops characters outside ``[a-z0-9\\s-]`` before collapsing whitespace
    to hyphens. When ``max_length`` is set the result is truncated to that
    many characters (applied after hyphen collapsing).
    """
    slug = name.lower().strip()
    slug = _SLUG_DROP_RE.sub("", slug)
    slug = _SLUG_WS_RE.sub("-", slug)
    slug = _SLUG_COLLAPSE_RE.sub("-", slug)
    slug = slug.strip("-")
    if max_length is not None:
        slug = slug[:max_length]
    return slug


def slugify_loose(text: str) -> str:
    """Filename-stem slug: any non-alphanumeric run becomes a single hyphen.

    ``"Knee MRI (report)"`` -> ``"knee-mri-report"``. Unlike :func:`slugify`,
    accented letters act as separators rather than being dropped.

    No length cap is applied here — callers that need one slice the input or
    the result themselves, because they historically truncated at different
    points (before vs. after substitution).
    """
    slug = text.lower()
    slug = _SLUG_LOOSE_RE.sub("-", slug)
    slug = _SLUG_COLLAPSE_RE.sub("-", slug)
    return slug.strip("-")
