"""Imaging bundle directory walking / listing helpers (no FastAPI routing).

Moved verbatim from ``routes.py``: ``_bundle_root_for_study`` and
``_kind_for_extension``.
"""


def _bundle_root_for_study(folder_path: str) -> str | None:
    """Return the imaging-bundles directory path for a given study folder.

    Study folder layouts handled:
      - ``patients/{slug}/{year}/{study_folder}`` →
        ``patients/{slug}/imaging-bundles``
      - ``patients/{slug}/{year}/imaging/{study_folder}`` →
        ``patients/{slug}/imaging-bundles``
      - ``unclassified/{year}/{study_folder}`` (or with intermediate
        ``imaging/`` segment) →
        ``unclassified/imaging-bundles``

    Returns None if the path does not match any of the above shapes.
    """
    parts = folder_path.split("/")
    if not parts:
        return None
    # Trim the optional ``imaging`` segment when present.
    if "imaging" in parts:
        idx = parts.index("imaging")
        return "/".join(parts[:idx] + ["imaging-bundles"])
    # patients/{slug}/{year}/{study} → patients/{slug}/imaging-bundles
    # unclassified/{year}/{study}    → unclassified/imaging-bundles
    if parts[0] == "patients" and len(parts) >= 4:
        return f"{parts[0]}/{parts[1]}/imaging-bundles"
    if parts[0] == "unclassified" and len(parts) >= 3:
        return "unclassified/imaging-bundles"
    return None


def _kind_for_extension(ext: str) -> str:
    if ext in {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".gif", ".bmp"}:
        return "image"
    if ext == ".pdf":
        return "pdf"
    if ext in {".dcm", ".dicom"}:
        return "dicom"
    return "other"
