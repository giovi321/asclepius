"""Read-only lookup from drug/lab/diagnosis names to canonical external codes.

The auto-merge feature uses this layer BEFORE asking the LLM to find
duplicates. Entries that resolve to the same external code (ATC for drugs,
LOINC for lab tests, ICD-10 for diagnoses) are merged deterministically; the
LLM sees only the residual that lookup couldn't decide.

Knowledge files live under ``bundled_config/knowledge/{kind}.json`` (Docker
image), with a per-install override at ``<config>/knowledge/{kind}.json`` if
the user wants to ship their own. Same precedence as the seed loader.

File shape mirrors ``config/seeds/medications.json`` so future tooling can
treat seeds and knowledge interchangeably::

    [
      {
        "canonical_code": "amoxicillin",
        "external_code": "J01CA04",
        "canonical_display": "Amoxicillin",
        "aliases": [
          {"alias": "Amoxicillin", "language": "en"},
          {"alias": "Zimox", "language": "it"},
          ...
        ]
      }
    ]
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

# Mirrors db/init.py's SEEDS_DIR / BUNDLED_SEEDS_DIR pattern: the per-install
# override (under the user's config dir) wins, falling back to the bundled
# copy inside the Docker image.
_USER_KNOWLEDGE_DIR = (
    Path(os.environ.get("ASCLEPIUS_CONFIG_PATH", "/data/config/settings.yaml")).parent
    / "knowledge"
)
_BUNDLED_KNOWLEDGE_DIR = (
    Path(__file__).parent.parent.parent.parent / "bundled_config" / "knowledge"
)

Kind = Literal["medications", "lab_tests", "diagnoses"]

_CODE_LABEL: dict[str, str] = {
    "medications": "ATC",
    "lab_tests": "LOINC",
    "diagnoses": "ICD-10",
}

# Maps from the auto_merge.py main_table name to the knowledge kind.
_TABLE_TO_KIND: dict[str, Kind] = {
    "norm_medications": "medications",
    "norm_lab_tests": "lab_tests",
    "norm_diagnoses": "diagnoses",
}


# --- normalisation -----------------------------------------------------------

# Strip trailing dosage tokens like "500mg", "10 mg", "200 ui", "5%".
_DOSAGE_TAIL = re.compile(
    r"\s+\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|ml|l|ui|iu|%)\b.*$",
    re.IGNORECASE,
)
# Strip parenthesised content: "ibuprofen (oral)" -> "ibuprofen".
_PAREN = re.compile(r"\s*\([^)]*\)")
_NONALNUM_EDGES = re.compile(r"^[^0-9a-z]+|[^0-9a-z]+$")
_WS = re.compile(r"\s+")


def _normalize(text: str) -> str:
    """Casefold + strip punctuation/dosage so name variants collapse."""
    if not text:
        return ""
    s = text.casefold()
    s = _PAREN.sub("", s)
    s = _DOSAGE_TAIL.sub("", s)
    # Replace any non-alphanumeric inner chars with a space, then collapse.
    s = re.sub(r"[^0-9a-z]+", " ", s)
    s = _WS.sub(" ", s).strip()
    return s


# --- loader ------------------------------------------------------------------


class KnowledgeBase:
    """In-memory lookup from name -> external code, for one normalization kind."""

    def __init__(self, kind: Kind):
        self.kind = kind
        self.code_label = _CODE_LABEL[kind]
        self._lookup: dict[str, str] = {}
        self._entry_count = 0
        self._loaded_from: Path | None = None

    def resolve(self, text: str) -> str | None:
        """Return the external code (ATC / LOINC / ICD-10) for a name, or None."""
        key = _normalize(text)
        if not key:
            return None
        return self._lookup.get(key)

    @property
    def entry_count(self) -> int:
        return self._entry_count

    @property
    def alias_count(self) -> int:
        return len(self._lookup)

    def _load(self) -> None:
        """Read the knowledge JSON. Silently no-op if the file is missing."""
        path = self._resolve_path()
        if path is None:
            logger.info(
                "knowledge_base[%s]: no data file found (looked in %s and %s); "
                "auto-merge will skip deterministic resolution",
                self.kind, _USER_KNOWLEDGE_DIR, _BUNDLED_KNOWLEDGE_DIR,
            )
            return

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("knowledge_base[%s]: failed to load %s: %s", self.kind, path, e)
            return

        if not isinstance(data, list):
            logger.warning("knowledge_base[%s]: %s root is not a list", self.kind, path)
            return

        # Build the lookup. If two entries claim the same normalized alias, drop
        # it so we never falsely collapse — the LLM can still try.
        seen: dict[str, str] = {}
        conflicts: set[str] = set()
        for entry in data:
            if not isinstance(entry, dict):
                continue
            code = entry.get("external_code") or entry.get("atc_code") \
                or entry.get("loinc_code") or entry.get("icd10_code")
            if not code:
                continue
            self._entry_count += 1
            names: list[str] = []
            if entry.get("canonical_display"):
                names.append(entry["canonical_display"])
            for a in entry.get("aliases", []) or []:
                if isinstance(a, dict) and a.get("alias"):
                    names.append(a["alias"])
                elif isinstance(a, str):
                    names.append(a)
            for n in names:
                key = _normalize(n)
                if not key:
                    continue
                existing = seen.get(key)
                if existing is None:
                    seen[key] = code
                elif existing != code:
                    conflicts.add(key)

        for k in conflicts:
            seen.pop(k, None)

        self._lookup = seen
        self._loaded_from = path
        logger.info(
            "knowledge_base[%s] loaded from %s: %d entries, %d unique aliases"
            "%s",
            self.kind, path, self._entry_count, len(self._lookup),
            f", {len(conflicts)} ambiguous aliases dropped" if conflicts else "",
        )

    @staticmethod
    def _resolve_path_for(kind: Kind) -> Path | None:
        for base in (_USER_KNOWLEDGE_DIR, _BUNDLED_KNOWLEDGE_DIR):
            candidate = base / f"{kind}.json"
            if candidate.is_file():
                return candidate
        return None

    def _resolve_path(self) -> Path | None:
        return self._resolve_path_for(self.kind)


# Module-level cache, populated lazily on first use.
_CACHE: dict[Kind, KnowledgeBase] = {}


def get_knowledge_base(kind_or_table: str) -> KnowledgeBase | None:
    """Return the cached KB for a kind or main-table name, or None if N/A.

    Accepts either ``"medications"`` / ``"lab_tests"`` / ``"diagnoses"`` or
    the SQL table name (``"norm_medications"`` etc.) so callers in
    auto_merge.py can pass whatever they have in hand.
    """
    kind = _TABLE_TO_KIND.get(kind_or_table, kind_or_table)
    if kind not in _CODE_LABEL:
        return None  # doctors / facilities / specialties — no public KB applies
    cached = _CACHE.get(kind)  # type: ignore[arg-type]
    if cached is not None:
        return cached
    kb = KnowledgeBase(kind)  # type: ignore[arg-type]
    kb._load()
    _CACHE[kind] = kb  # type: ignore[index]
    return kb


def reset_cache() -> None:
    """Test hook: clear the module-level cache."""
    _CACHE.clear()
