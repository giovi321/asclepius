"""Centralized date-selection helpers.

Post-Phase-2 documents expose two dates: ``event_date`` (canonical timeline
anchor) and ``issued_date`` (administrative). ``event_date`` is the single
"best date" — sort orders, timeline anchors, and child-row fallbacks all use
it directly.
"""

from __future__ import annotations

from typing import Any


def _row_get(row: Any, key: str) -> Any:
    """Retrieve ``key`` from ``row``, which may be a dict, an aiosqlite.Row,
    or any mapping-like object. Returns None for missing keys without raising.
    """
    if row is None:
        return None
    if isinstance(row, dict):
        return row.get(key)
    try:
        if key in row.keys():
            return row[key]
    except (AttributeError, TypeError):
        pass
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return None


BEST_DATE_SQL = "d.event_date"
"""SQL fragment for the best document date, assuming `documents AS d`."""

BEST_DATE_SQL_WITH_CREATED = "COALESCE(d.event_date, d.created_at)"
"""Same as BEST_DATE_SQL with `created_at` as a last-resort fallback."""


def best_date(row: Any) -> str | None:
    """Return the canonical event date from a document-like row.

    Accepts dicts and aiosqlite.Row objects. Missing keys and empty strings
    are both treated as absent.
    """
    if row is None:
        return None
    value = _row_get(row, "event_date")
    return value or None


def best_date_with_received(row: Any) -> str | None:
    """best_date() with `date_received` as a final fallback.

    Used by the file organizer, which needs *some* date to build a path even
    when no medical date was extracted.
    """
    value = best_date(row)
    if value:
        return value
    return _row_get(row, "date_received") or None
