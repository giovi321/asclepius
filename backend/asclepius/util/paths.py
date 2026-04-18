"""Path and filename safety helpers.

All endpoints that accept a user-supplied path or filename MUST go through
``safe_vault_join`` / ``safe_filename`` so that traversal primitives such as
``..``, absolute paths or NUL bytes can never escape the configured vault
root. This module centralises those checks so the invariant is obvious and
testable.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path, PurePosixPath

# Characters allowed in a sanitised filename. We intentionally exclude path
# separators, NUL, control chars and everything outside a conservative ASCII
# safe set — the vault is served over HTTP and some downstream tooling
# (Tesseract, pdf renderers) mishandles exotic filenames.
_FILENAME_ALLOWED = re.compile(r"[^A-Za-z0-9._\- ]")

# Reserved names on Windows; we reject them even on Linux so the vault stays
# portable if someone rsyncs it to another OS.
_RESERVED_WIN = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


class UnsafePathError(ValueError):
    """Raised when a user-supplied path would escape the vault root."""


def safe_filename(name: str, *, fallback: str = "file") -> str:
    """Return a sanitised filename safe to write inside the vault.

    - Strips any directory component (``foo/bar`` → ``bar``).
    - Normalises unicode and drops control chars.
    - Replaces disallowed chars with ``_``.
    - Collapses leading dots so ``..`` / ``.hidden`` cannot be produced.
    - Refuses empty / reserved names, substituting ``fallback``.
    """
    if not name:
        return fallback

    # Normalise and drop any path separators the caller may have kept.
    name = unicodedata.normalize("NFKC", name)
    name = name.replace("\x00", "")
    name = PurePosixPath(name.replace("\\", "/")).name  # last segment only

    # Replace disallowed characters with underscore.
    name = _FILENAME_ALLOWED.sub("_", name)

    # Strip leading dots / whitespace so ``..`` or ``.env`` cannot survive.
    name = name.lstrip(". ").rstrip(" ")

    if not name:
        return fallback

    stem = Path(name).stem.upper()
    if stem in _RESERVED_WIN:
        name = f"_{name}"

    # Cap length to a sane value; most filesystems accept 255 bytes but many
    # tools choke well before that.
    if len(name) > 200:
        suffix = Path(name).suffix[:20]
        name = name[: 200 - len(suffix)] + suffix

    return name


def safe_vault_join(vault_root: str | Path, *parts: str | Path) -> Path:
    """Join ``parts`` under ``vault_root`` and verify the result stays inside.

    Raises ``UnsafePathError`` if the resolved path escapes ``vault_root``
    (e.g. via ``..`` segments, absolute paths or symlinks that point outside).

    The returned path is absolute and fully resolved. The final target does
    not need to exist, but every existing intermediate component is
    resolved through symlinks for the check.
    """
    root = Path(vault_root).resolve()
    candidate = root
    for part in parts:
        p = Path(part)
        if p.is_absolute():
            raise UnsafePathError(f"Absolute path not allowed: {part!r}")
        if "\x00" in str(p):
            raise UnsafePathError("NUL byte in path")
        candidate = candidate / p

    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise UnsafePathError(
            f"Path {candidate!r} escapes vault root {root!r}"
        ) from exc
    return resolved


def is_within(root: str | Path, path: str | Path) -> bool:
    """Return True iff ``path`` (resolved) is inside ``root`` (resolved)."""
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
        return True
    except ValueError:
        return False
