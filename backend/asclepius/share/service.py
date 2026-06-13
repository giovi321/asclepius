"""Share/OTP/session helpers.

Token and OTP code generation, hashing, lookup, and audit-log writes. All
state-changing functions take an ``aiosqlite.Connection`` and commit before
returning so the caller never has to remember.

This module is now a thin re-export shim. The implementation lives in the
focused modules below; ``service`` keeps the historical public API so every
existing ``from asclepius.share.service import X`` / ``share_service.X``
caller keeps working unchanged:

- :mod:`asclepius.share.tokens`   — token/OTP hashing + time helpers
- :mod:`asclepius.share.audit`    — share audit-log writes + listing
- :mod:`asclepius.share.shares`   — share-row CRUD / listing / doc projection
- :mod:`asclepius.share.otp`      — OTP issue/verify + failure lockout
- :mod:`asclepius.share.sessions` — session create/validate/revoke
- :mod:`asclepius.share.queue`    — single-session queue logic
"""

from __future__ import annotations

from asclepius.share.audit import list_audit, write_audit
from asclepius.share.otp import (
    OtpCooldownError,
    _last_otp_age_seconds,
    bump_consecutive_failures,
    count_email_otps_today,
    get_active_otp_clear,
    issue_otp,
    reset_consecutive_failures,
    verify_otp,
)
from asclepius.share.queue import (
    delete_queue_entry,
    delete_queue_entry_by_rowid,
    enqueue_for_share,
    get_queue_entry,
    list_queued_for_share,
    purge_expired_queue,
    queue_entry_active,
)
from asclepius.share.sessions import (
    create_session,
    get_active_session_for_share,
    get_session,
    list_active_sessions_for_share,
    revoke_session,
    revoke_session_by_rowid,
    session_active,
    touch_session,
)
from asclepius.share.shares import (
    _SHARE_LIST_COLUMNS,
    _SHARE_LIST_JOINS,
    add_share_documents,
    create_share,
    delete_share,
    get_share_by_id,
    get_share_by_token,
    is_share_active,
    list_shares_for_patient,
    list_shares_for_user,
    revoke_share,
    share_documents,
    share_has_document,
)
from asclepius.share.tokens import (
    generate_otp_code,
    generate_queue_token,
    generate_session_id,
    generate_share_token,
    hash_token,
    in_days,
    in_minutes,
    utcnow_iso,
)

__all__ = [
    # tokens
    "hash_token",
    "generate_share_token",
    "generate_otp_code",
    "generate_session_id",
    "generate_queue_token",
    "utcnow_iso",
    "in_minutes",
    "in_days",
    # audit
    "write_audit",
    "list_audit",
    # shares
    "get_share_by_token",
    "get_share_by_id",
    "is_share_active",
    "share_documents",
    "share_has_document",
    "create_share",
    "revoke_share",
    "add_share_documents",
    "delete_share",
    "_SHARE_LIST_COLUMNS",
    "_SHARE_LIST_JOINS",
    "list_shares_for_patient",
    "list_shares_for_user",
    # otp
    "OtpCooldownError",
    "_last_otp_age_seconds",
    "issue_otp",
    "bump_consecutive_failures",
    "reset_consecutive_failures",
    "count_email_otps_today",
    "verify_otp",
    "get_active_otp_clear",
    # sessions
    "create_session",
    "get_session",
    "touch_session",
    "revoke_session",
    "session_active",
    "get_active_session_for_share",
    "list_active_sessions_for_share",
    "revoke_session_by_rowid",
    # queue
    "enqueue_for_share",
    "get_queue_entry",
    "queue_entry_active",
    "delete_queue_entry",
    "purge_expired_queue",
    "list_queued_for_share",
    "delete_queue_entry_by_rowid",
]
