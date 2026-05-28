"""Outbound email transport.

Currently a single use case (doctor-share email OTP), but kept as a
package so additional flows (password reset, admin notifications, etc.)
can be added without growing a single monolithic module.
"""

from asclepius.email.sender import EmailSendError, send_otp_email, send_test_email
from asclepius.email.templates import render_otp_body, render_otp_subject

__all__ = [
    "EmailSendError",
    "render_otp_body",
    "render_otp_subject",
    "send_otp_email",
    "send_test_email",
]
