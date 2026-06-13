"""LLM-output salvage and coercion heuristics.

Small models routinely ignore the requested JSON schema: they invent
their own key names, drop array prefixes, embed abnormal markers in unit
fields, and emit placeholder strings like ``"unknown"`` where a real value
should be. The helpers here rescue / normalize that drift before the data
reaches the DB-write path. Moved verbatim out of :mod:`extractor`; this is
a leaf module (no imports from sibling pipeline modules).
"""

import logging
import re
from datetime import date

logger = logging.getLogger(__name__)

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _coerce_iso_date(value) -> str | None:
    """Return ``value`` as an ISO ``YYYY-MM-DD`` string, or None if unparseable.

    The LLM occasionally emits placeholders like ``"unknown"``, ``"n/a"``, or
    a malformed date such as ``"2024-13-40"``. We accept only strict ISO so
    the document's ``event_date`` fallback can fire downstream.
    """
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    if not s or not _ISO_DATE_RE.match(s):
        return None
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


def _salvage_classification(c: dict) -> None:
    """Try to map non-standard LLM keys to the expected classification schema.

    Small models (e.g. qwen2.5:7b) often ignore the requested JSON schema and
    return their own key names. This attempts to rescue useful data.
    """
    # Doctor name — LLM might use "responsible", "signing_doctor", "medico", etc.
    if not c.get("doctor") or (isinstance(c.get("doctor"), dict) and not c["doctor"].get("name")):
        for alt_key in ("responsible", "signing_doctor", "medico", "physician", "arzt"):
            val = c.get(alt_key)
            if val and isinstance(val, str):
                c["doctor"] = {"name": val}
                break
            elif val and isinstance(val, dict) and val.get("name"):
                c["doctor"] = val
                break

    # Facility — LLM might use "department", "hospital", "clinic", "struttura"
    if not c.get("facility") or (
        isinstance(c.get("facility"), dict) and not c["facility"].get("name")
    ):
        for alt_key in ("department", "hospital", "clinic", "struttura", "krankenhaus"):
            val = c.get(alt_key)
            if val and isinstance(val, str):
                c["facility"] = {"name": val.split("\n")[0].strip()}
                break
            elif val and isinstance(val, dict) and val.get("name"):
                c["facility"] = val
                break

    # Summary — LLM might use "conclusions", "summary", "riassunto", "zusammenfassung"
    if not c.get("summary_en"):
        for alt_key in ("conclusions", "summary", "riassunto", "zusammenfassung", "description"):
            val = c.get(alt_key)
            if val and isinstance(val, str):
                c["summary_en"] = val[:500]
                break
            elif val and isinstance(val, list):
                c["summary_en"] = "; ".join(str(x) for x in val[:5])[:500]
                break

    # Date — LLM might use "date", "visit_date", "data", "datum". We write
    # the salvaged value back into the legacy doc_date key; the caller
    # collapses doc_date/date_visit/date_issued/event_date into event_date
    # before the DB write.
    if not c.get("event_date") and not c.get("doc_date") and not c.get("date_visit"):
        for alt_key in ("date", "visit_date", "data", "datum", "consultation_date"):
            val = c.get(alt_key)
            if val and isinstance(val, str) and len(val) >= 8:
                c["doc_date"] = val
                break

    # Visit type → doc_type mapping
    if not c.get("doc_type"):
        visit_type = c.get("visit_type") or c.get("type") or c.get("document_type")
        if visit_type and isinstance(visit_type, str):
            c["doc_type"] = visit_type

    # Patient name
    if not c.get("patient_name"):
        patient = c.get("patient")
        if isinstance(patient, dict):
            c["patient_name"] = patient.get("name") or patient.get("full_name")
        elif isinstance(patient, str):
            c["patient_name"] = patient


# Aliases for extraction array keys. Small models (qwen2.5:14b and below)
# frequently drop the "lab_" / "-es" prefixes/suffixes from the requested
# schema. We remap anything list-shaped under a known alias into the
# canonical key, but only if the canonical key is absent or empty.
_ARRAY_KEY_ALIASES: dict[str, tuple[str, ...]] = {
    "lab_results": ("results", "tests", "lab_tests", "test_results", "labResults", "blood_tests"),
    "diagnoses": ("diagnosis", "diagnoses_list", "findings"),
    "medications": ("medication", "drugs", "prescriptions"),
    "vaccinations": ("vaccination", "vaccines", "immunizations"),
    "encounters": ("encounter", "visits"),
    "invoice_items": ("items", "line_items", "invoice_lines"),
}


def _salvage_array_keys(extraction: dict) -> None:
    """Remap common LLM key-naming drift back onto the canonical keys."""
    for canonical, aliases in _ARRAY_KEY_ALIASES.items():
        existing = extraction.get(canonical)
        if isinstance(existing, list) and existing:
            continue
        for alt in aliases:
            val = extraction.get(alt)
            if isinstance(val, list) and val:
                extraction[canonical] = val
                extraction.pop(alt, None)
                logger.info("Salvaged LLM key '%s' → '%s' (%d items)", alt, canonical, len(val))
                break


# Strings the LLM emits when it could not find a real value. We treat
# them as "no value" everywhere we read string fields, instead of letting
# them bleed into the DB and the UI as if they were real content.
_PLACEHOLDER_SENTINELS = {
    "",
    "*",
    "-",
    "—",
    "–",
    "_",
    ".",
    "..",
    "...",
    "n/a",
    "n/a.",
    "na",
    "n.a.",
    "n.a",
    "n/d",
    "nd",
    "null",
    "none",
    "nil",
    "nan",
    "*/*",
    "unknown",
    "unspecified",
    "not specified",
    "not available",
    "not provided",
    "not applicable",
    "no value",
    "missing",
    "illegible",
    "unreadable",
    "indecipherable",
    "(empty)",
    "(none)",
    "(null)",
    "(unknown)",
    "(blank)",
    "tbd",
    "to be determined",
}


def _is_missing(val) -> bool:
    """True if the LLM emitted a placeholder meaning 'no value'."""
    if val is None:
        return True
    if isinstance(val, str):
        return val.strip().lower() in _PLACEHOLDER_SENTINELS
    return False


def _clean(val):
    """Normalize an LLM-extracted string field for DB insert.

    Returns ``None`` for ``None``, empty strings, and any of the
    ``_PLACEHOLDER_SENTINELS`` markers (case- and whitespace-insensitive).
    Otherwise returns the value with surrounding whitespace stripped.
    Non-string values pass through unchanged so numeric / boolean / date
    fields aren't mangled.
    """
    if val is None:
        return None
    if not isinstance(val, str):
        return val
    stripped = val.strip()
    if not stripped:
        return None
    if stripped.lower() in _PLACEHOLDER_SENTINELS:
        return None
    return stripped


def _parse_reference_range(raw: str) -> tuple[float | None, float | None]:
    """Parse strings like '[12 - 43]', '0.5–2.1', '< 5', '* - *' → (low, high).

    Returns (None, None) when neither bound is a real number.
    """
    if not isinstance(raw, str):
        return None, None
    s = raw.strip().strip("[]()").strip()
    if not s:
        return None, None
    # Normalize dash variants (en/em/minus) into ASCII "-"
    for ch in ("–", "—", "−"):
        s = s.replace(ch, "-")
    low_s, high_s = None, None
    if s.startswith("<"):
        high_s = s[1:].strip().lstrip("=").strip()
    elif s.startswith(">"):
        low_s = s[1:].strip().lstrip("=").strip()
    elif "-" in s:
        parts = s.split("-", 1)
        low_s, high_s = parts[0].strip(), parts[1].strip()

    def _coerce(x):
        if x is None or _is_missing(x):
            return None
        try:
            return float(x.replace(",", "."))
        except (ValueError, AttributeError):
            return None

    return _coerce(low_s), _coerce(high_s)


def _normalize_lab_row(lab: dict) -> None:
    """Make a single LLM-produced lab_results item match our schema.

    Small models drift on key names (``analysis`` instead of ``test_name_original``,
    ``result`` instead of ``value``) and embed abnormal markers like ``*`` into
    the unit field. Rewrite the row in place so the caller doesn't have to
    duplicate the logic.
    """
    # 1. Test name — support more aliases including 'analysis' / 'exam' / 'item'.
    if not lab.get("test_name_original"):
        for alt in (
            "test_name",
            "name",
            "test",
            "test_name_canonical",
            "analyte",
            "parameter",
            "analysis",
            "exam",
            "item",
            "label",
        ):
            v = lab.get(alt)
            if isinstance(v, str) and v.strip():
                lab["test_name_original"] = v.strip()
                break

    # 2. Value — 'result' / 'measurement' / 'observed_value' etc.
    if lab.get("value") is None and not lab.get("value_text"):
        raw_val = None
        for alt in ("result", "measurement", "observed_value", "observed", "reading", "quantity"):
            if alt in lab:
                raw_val = lab[alt]
                break
        if not _is_missing(raw_val):
            if isinstance(raw_val, (int, float)):
                lab["value"] = float(raw_val)
            elif isinstance(raw_val, str):
                s = raw_val.strip().replace(",", ".")
                try:
                    lab["value"] = float(s)
                except ValueError:
                    lab["value_text"] = raw_val.strip()

    # 3. Reference range — accept a single 'reference_range' string.
    if lab.get("reference_range_low") is None and lab.get("reference_range_high") is None:
        raw_range = lab.get("reference_range") or lab.get("range") or lab.get("ref_range")
        low, high = _parse_reference_range(raw_range) if raw_range else (None, None)
        if low is not None:
            lab["reference_range_low"] = low
        if high is not None:
            lab["reference_range_high"] = high

    # 4. Unit — some models prepend '*' as an abnormal marker (e.g. '* U/L').
    #    Strip it and treat it as an abnormal hint if is_abnormal wasn't set.
    unit = lab.get("unit")
    if isinstance(unit, str):
        stripped = unit.strip()
        if stripped.startswith("*"):
            lab["unit"] = stripped.lstrip("*").strip() or None
            if lab.get("is_abnormal") is None:
                lab["is_abnormal"] = True
        elif _is_missing(stripped):
            lab["unit"] = None
