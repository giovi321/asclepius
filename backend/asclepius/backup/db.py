"""Shared SQLite snapshot helper.

Used by both the on-demand ``/settings/backup`` download endpoint and the
scheduled backup jobs so they stay on the same code path.
"""

import sqlite3


def snapshot_db(src_path: str, dest_path: str) -> None:
    """Write a consistent snapshot of ``src_path`` to ``dest_path``.

    Uses SQLite's backup API, which is safe to run against a live database
    — it coordinates with writers via the WAL and yields a transactionally
    consistent copy.
    """
    source = sqlite3.connect(src_path)
    dest = sqlite3.connect(dest_path)
    try:
        source.backup(dest)
    finally:
        dest.close()
        source.close()
