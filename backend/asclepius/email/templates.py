"""Tiny template renderer for outbound mail.

Deliberately NOT Jinja: the only thing we substitute is a handful of
known placeholders (``{code}``, ``{recipient_label}``, etc.). Pure
``str.replace`` per known key means an admin who pastes hostile content
into the template cannot trigger code execution, file access, or even
attribute traversal — at worst they break their own rendering.

Unknown placeholders pass through unchanged (no ``KeyError`` like
``str.format`` would raise), so users can type ``{not_a_placeholder}``
in their template without crashing the send.
"""

from __future__ import annotations

# The full set of placeholders the templates support. Anything else is
# left intact in the output.
_PLACEHOLDERS = (
    "code",
    "recipient_label",
    "expires_minutes",
    "share_label",
    "from_name",
)


def _render(template: str, values: dict[str, str]) -> str:
    """Substitute ``{placeholder}`` tokens for known keys only."""
    out = template
    for key in _PLACEHOLDERS:
        out = out.replace("{" + key + "}", str(values.get(key, "")))
    return out


def render_otp_subject(
    template: str,
    *,
    code: str,
    recipient_label: str,
    expires_minutes: int,
    share_label: str,
    from_name: str,
) -> str:
    return _render(
        template,
        {
            "code": code,
            "recipient_label": recipient_label,
            "expires_minutes": str(expires_minutes),
            "share_label": share_label,
            "from_name": from_name,
        },
    )


def render_otp_body(
    template: str,
    *,
    code: str,
    recipient_label: str,
    expires_minutes: int,
    share_label: str,
    from_name: str,
) -> str:
    return _render(
        template,
        {
            "code": code,
            "recipient_label": recipient_label,
            "expires_minutes": str(expires_minutes),
            "share_label": share_label,
            "from_name": from_name,
        },
    )
