"""Guard: no module may open a raw aiosqlite connection.

``open_db()`` (db/connection.py) is the only sanctioned way to open a
connection outside the request lifecycle, because it sets the per-connection
PRAGMAs (foreign_keys=ON, busy_timeout, WAL, Row factory). A raw
``aiosqlite.connect()`` anywhere else silently disables ON DELETE CASCADE.
This static check fails if one slips back in.
"""

import re
from pathlib import Path

# connection.py legitimately calls aiosqlite.connect (it *is* the wrapper).
_ALLOWED_FILENAMES = {"connection.py"}
_PATTERN = re.compile(r"aiosqlite\.connect\(")


def test_no_raw_aiosqlite_connect_outside_connection_module():
    pkg_root = Path(__file__).resolve().parent.parent / "asclepius"
    offenders = []
    for py in pkg_root.rglob("*.py"):
        if py.name in _ALLOWED_FILENAMES:
            continue
        for lineno, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            if _PATTERN.search(line):
                offenders.append(f"{py.relative_to(pkg_root)}:{lineno}: {line.strip()}")
    assert not offenders, (
        "Raw aiosqlite.connect() found outside db/connection.py — use "
        "open_db() from asclepius.db.connection instead:\n" + "\n".join(offenders)
    )
