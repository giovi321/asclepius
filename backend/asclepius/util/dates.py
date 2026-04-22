"""Centralized date-selection helpers.

Documents carry three candidate date columns — `date_visit`, `date_issued`,
`doc_date` — and the canonical "best date" used on the timeline, in sorting,
and as the anchor for child rows is the first non-null in that priority order.
These helpers keep the priority rule in one place until the Phase 2 migration
collapses the three columns into `event_date` / `issued_date`.
"""

from __future__ import annotations

from typing import Any


def _row_get(row: Any, key: str) -> Any:
    """Retrieve ``key`` from ``row``, which may be a dict, an aiosqlite.Row,
    or any mapping-like object. Returns None for missing keys without raising.

    aiosqlite.Row is sqlite3.Row under the hood and exposes ``keys()`` +
    ``__getitem__`` but not ``.get()``, so we can't treat it as a plain dict.
    """
    if row is None:
        return None
    # Fast path for real dicts.
    if isinstance(row, dict):
        return row.get(key)
    # Row-like: probe via keys() so missing columns don't raise IndexError.
    try:
        if key in row.keys():
            return row[key]
    except (AttributeError, TypeError):
        pass
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return None

BEST_DATE_COLUMNS: tuple[str, str, str] = ("date_visit", "date_issued", "doc_date")
"""Candidate columns in priority order (highest wins)."""

BEST_DATE_SQL = "COALESCE(d.date_visit, d.date_issued, d.doc_date)"
"""SQL fragment for the best document date, assuming `documents AS d`."""

BEST_DATE_SQL_WITH_CREATED = (
    "COALESCE(d.date_visit, d.date_issued, d.doc_date, d.created_at)"
)
"""Same as BEST_DATE_SQL with `created_at` as a last-resort fallback."""


def best_date(row: Any) -> str | None:
    """Return the first non-empty candidate date from a document-like row.

    Accepts dicts and aiosqlite.Row objects. Missing keys and empty strings
    are both treated as absent.
    """
    if row is None:
        return None
    for key in BEST_DATE_COLUMNS:
        value = _row_get(row, key)
        if value:
            return value
    return None


def best_date_with_received(row: Any) -> str | None:
    """best_date() with `date_received` as a final fallback.

    Used by the file organizer, which needs *some* date to build a path even
    when no medical date was extracted.
    """
    value = best_date(row)
    if value:
        return value
    return _row_get(row, "date_received") or None
