"""File organization — rename and move files to vault structure."""

import logging
import re
import shutil
from pathlib import Path

from asclepius.config import AppConfig

logger = logging.getLogger(__name__)


def build_organized_path(
    config: AppConfig,
    patient_slug: str | None,
    doc_date: str | None,
    provider_slug: str | None,
    doc_type: str | None,
    original_filename: str,
    event_slug: str | None = None,
    summary_slug: str | None = None,
) -> str:
    """Build the organized file path.

    Format: patients/{slug}/{YYYY}/{event-slug}/{YYYYMMDD}_{summary_slug}.{ext}
    Falls back to doc_type if no summary_slug is provided.
    Date is compact format (20251231). If no event, the event-slug folder is omitted.
    If no patient, goes to unclassified/
    """
    ext = Path(original_filename).suffix.lower()
    year = doc_date[:4] if doc_date else "unknown"
    # Compact date: 2025-12-31 → 20251231
    date_prefix = doc_date.replace("-", "") if doc_date else "00000000"

    name_part = summary_slug or doc_type or "document"
    # Ensure max 60 chars, lowercase, alphanumeric + hyphens only
    name_part = name_part.lower()
    name_part = re.sub(r"[^a-z0-9]+", "-", name_part)
    name_part = re.sub(r"-+", "-", name_part).strip("-")
    name_part = name_part[:60]

    filename = f"{date_prefix}_{name_part}{ext}"
    # Sanitize
    filename = re.sub(r"[^\w\-.]", "-", filename)
    filename = re.sub(r"-+", "-", filename)

    if patient_slug:
        if event_slug:
            return f"patients/{patient_slug}/{year}/{event_slug}/{filename}"
        else:
            return f"patients/{patient_slug}/{year}/{filename}"
    else:
        return f"unclassified/{filename}"


def slugify_event(title: str) -> str:
    """Convert an event title to a folder-safe slug."""
    slug = title.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")[:60]  # limit length


def move_file(
    config: AppConfig,
    source_path: str,
    relative_dest: str,
) -> str:
    """Move file from source to organized location in vault.

    Returns: the relative path from vault root.
    """
    vault_root = Path(config.vault.root_path)
    dest_path = vault_root / relative_dest

    # Ensure directory exists
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # Handle filename conflicts
    if dest_path.exists():
        stem = dest_path.stem
        suffix = dest_path.suffix
        counter = 1
        while dest_path.exists():
            dest_path = dest_path.parent / f"{stem}_{counter}{suffix}"
            counter += 1
        relative_dest = str(dest_path.relative_to(vault_root))

    # Copy then delete (safer than move across filesystems)
    shutil.copy2(source_path, str(dest_path))
    Path(source_path).unlink()

    logger.info("Moved %s -> %s", source_path, relative_dest)
    return relative_dest
