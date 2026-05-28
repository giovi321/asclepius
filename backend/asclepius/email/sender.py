"""Async SMTP sender for transactional mail.

Used today by the doctor-share email-OTP flow. The module exposes two
public coroutines: ``send_otp_email`` for the real flow and
``send_test_email`` for the admin's "Send test email" button in the
SMTP settings tab — both share a single ``_dispatch`` helper that owns
the TLS / timeout / header-injection plumbing so the two paths cannot
drift apart.

Design notes:

- **TLS is mandatory** for non-local SMTP hosts. Implicit TLS (port 465,
  ``use_tls``) and STARTTLS (port 587, ``use_starttls``) are both
  supported; pick one in settings. Plaintext is refused unless the host
  resolves to ``localhost`` / ``127.0.0.1`` (dev convenience).
- **Header injection** via the personalisable template is blocked by
  stripping every ``\\r`` / ``\\n`` from the Subject and From headers
  before assignment. The body is allowed to contain newlines (it is the
  body, after all); only headers are sanitised.
- **Recipient address** is validated against a strict regex. We do NOT
  accept comma-separated lists — every send is single-recipient.
- **Failures** raise :class:`EmailSendError` wrapping the underlying
  exception's class name. The caller writes an audit entry referencing
  that class name only — the raw SMTP server response (which can echo
  attacker-controlled bytes) is never logged or surfaced to the doctor.
"""

from __future__ import annotations

import logging
import re
from email.message import EmailMessage
from html import escape as html_escape

import aiosmtplib

from asclepius.config import AppConfig
from asclepius.email.templates import render_otp_body, render_otp_subject

logger = logging.getLogger(__name__)


# Strict-ish email regex — covers the realistic mailbox set the doctor
# share flow needs to accept while ruling out CRLF, spaces, and the
# "Display Name <addr>" notation. We refuse the latter on purpose: the
# template's display name comes from config, not from share-creation
# input, so there is no legitimate reason for it to appear here.
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class EmailSendError(Exception):
    """Raised when SMTP dispatch fails for any reason.

    Carries the class name of the underlying exception in
    :attr:`cause_class` so callers can audit-log a stable label without
    inviting attacker-controlled bytes from the SMTP response into the
    log buffer.
    """

    def __init__(self, message: str, *, cause_class: str = "EmailSendError") -> None:
        super().__init__(message)
        self.cause_class = cause_class


def _validate_recipient(addr: str) -> str:
    """Reject anything that does not look like a single bare mailbox."""
    addr = (addr or "").strip()
    if not _EMAIL_RE.match(addr):
        raise EmailSendError(
            "Recipient is not a valid email address",
            cause_class="InvalidRecipient",
        )
    return addr


def _sanitize_header(value: str) -> str:
    """Strip CR/LF from a value about to land in an email header.

    Header injection (e.g. an attacker inserting ``\\r\\nBcc: ...``)
    only works if the line break survives. Strip both characters and
    collapse the surrounding whitespace; if anything remains, it is
    a value an SMTP server will accept verbatim.
    """
    return value.replace("\r", " ").replace("\n", " ").strip()


def _require_tls_or_local(cfg_smtp) -> None:
    """Refuse plaintext SMTP to anything other than the loopback host."""
    if cfg_smtp.use_tls or cfg_smtp.use_starttls:
        return
    if (cfg_smtp.host or "").strip().lower() in _LOCAL_HOSTS:
        return
    raise EmailSendError(
        "Refusing to send over plaintext SMTP to a non-local host. "
        "Enable STARTTLS or implicit TLS in SMTP settings.",
        cause_class="PlaintextRefused",
    )


def _build_message(
    *,
    from_name: str,
    from_address: str,
    to: str,
    subject: str,
    body_text: str,
) -> EmailMessage:
    """Construct a multipart text+HTML EmailMessage with sanitised headers.

    HTML is a minimal ``<pre>``-wrapped copy of the text body so mail
    clients that hide the text part still show a readable rendering.
    HTML-escaping prevents the body content from being interpreted as
    markup.
    """
    msg = EmailMessage()
    msg["From"] = (
        f"{_sanitize_header(from_name)} <{_sanitize_header(from_address)}>"
        if from_name
        else _sanitize_header(from_address)
    )
    msg["To"] = to
    msg["Subject"] = _sanitize_header(subject)
    msg.set_content(body_text)
    msg.add_alternative(
        "<!doctype html><html><body>"
        f'<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;'
        f'font-size:14px;line-height:1.5;white-space:pre-wrap;">'
        f"{html_escape(body_text)}"
        "</pre></body></html>",
        subtype="html",
    )
    return msg


async def _dispatch(cfg: AppConfig, msg: EmailMessage, to: str) -> None:
    """Send a pre-built message; raises :class:`EmailSendError` on failure."""
    smtp = cfg.smtp
    if not smtp.enabled:
        raise EmailSendError("SMTP is disabled in settings", cause_class="SmtpDisabled")
    if not (smtp.host and smtp.from_address):
        raise EmailSendError(
            "SMTP host and from_address must be configured",
            cause_class="SmtpUnconfigured",
        )
    _require_tls_or_local(smtp)

    try:
        await aiosmtplib.send(
            msg,
            hostname=smtp.host,
            port=smtp.port,
            username=smtp.username or None,
            password=smtp.password or None,
            use_tls=smtp.use_tls,
            start_tls=smtp.use_starttls and not smtp.use_tls,
            timeout=smtp.timeout_seconds,
        )
    except EmailSendError:
        raise
    except Exception as exc:  # aiosmtplib raises several distinct types
        # Deliberately do NOT include str(exc) in the EmailSendError
        # message: SMTP servers echo back the rejected envelope which
        # can contain attacker-controlled bytes.
        cause = exc.__class__.__name__
        logger.warning("SMTP send to %s failed: %s", _mask_email(to), cause)
        raise EmailSendError(
            f"SMTP transport error ({cause})",
            cause_class=cause,
        ) from exc


def _mask_email(addr: str) -> str:
    """Reveal only the first character of the local-part for log entries."""
    addr = (addr or "").strip()
    if "@" not in addr:
        return "(invalid)"
    local, domain = addr.split("@", 1)
    if not local:
        return f"@{domain}"
    return f"{local[0]}***@{domain}"


async def send_otp_email(
    cfg: AppConfig,
    *,
    to: str,
    code: str,
    recipient_label: str,
    expires_minutes: int,
    share_label: str = "",
) -> None:
    """Send the share-OTP email. Raises :class:`EmailSendError` on failure.

    ``to`` MUST be the address recorded on the share row at creation
    time; the caller is responsible for never substituting an
    attacker-suppliable value here.
    """
    to_clean = _validate_recipient(to)
    subject = render_otp_subject(
        cfg.share.email_otp_subject,
        code=code,
        recipient_label=recipient_label,
        expires_minutes=expires_minutes,
        share_label=share_label,
        from_name=cfg.smtp.from_name,
    )
    body = render_otp_body(
        cfg.share.email_otp_body,
        code=code,
        recipient_label=recipient_label,
        expires_minutes=expires_minutes,
        share_label=share_label,
        from_name=cfg.smtp.from_name,
    )
    msg = _build_message(
        from_name=cfg.smtp.from_name,
        from_address=cfg.smtp.from_address,
        to=to_clean,
        subject=subject,
        body_text=body,
    )
    await _dispatch(cfg, msg, to_clean)


async def send_test_email(cfg: AppConfig, *, to: str) -> None:
    """Send a fixed diagnostic message — used by the SMTP test endpoint."""
    to_clean = _validate_recipient(to)
    msg = _build_message(
        from_name=cfg.smtp.from_name,
        from_address=cfg.smtp.from_address,
        to=to_clean,
        subject="Asclepius SMTP test",
        body_text=(
            "This is a test message from Asclepius.\n\n"
            "If you received it, outbound SMTP is configured correctly.\n"
        ),
    )
    await _dispatch(cfg, msg, to_clean)
