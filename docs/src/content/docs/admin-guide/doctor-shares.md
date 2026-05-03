---
title: "Doctor shares"
---

Doctor shares let you hand a curated subset of one patient's records to an outside doctor for consultation, without creating a real account for them. The doctor opens a one-time link, verifies a 6-digit code you give them out-of-band, and gets a short, read-only session that can view the listed documents and translate them. PDFs are watermarked with the doctor's name on every page; nothing can be downloaded from the UI.

## What the doctor sees

A stripped-down surface mounted at `/share/{token}`:

- **Landing page** — single button to "Request access code". Clicking it issues a fresh OTP server-side; the response gives the doctor no information either way.
- **OTP entry** — six numeric digits. Five attempts then the code burns. Codes expire after ten minutes.
- **Dashboard** — every shared document, with patient name, expiry countdown ("you will be logged out automatically in 1h 23m 45s"), and a sun/moon toggle for dark mode (defaults to the doctor's system preference).
- **Document detail** — the watermarked PDF on the left, structured data on the right (lab results, medications, vaccinations, summaries, region translations). No edit buttons, no delete, no download. Encounters are deliberately hidden — those often contain free-text physician notes that don't belong on an outside surface.
- **Translate** — a popover with two options: "Translate current page" or "Translate selected region" (drag a rectangle on the PDF). Whole-document translation is not exposed. The button stays disabled while a translation is in flight, and the new translation appears automatically in the "Region translations" panel — no manual refresh.

## What you control

### Creating a share

From any document detail page, click **Share with doctor** next to Delete. Or from the documents list, tick one or more rows and use the bulk-share button — a single share link can cover multiple documents as long as they belong to the same patient.

The dialog asks for:

- **Recipient name** — shown on the watermark and in the audit log. Free text.
- **Contact** — for your records only. Could be a phone number or anything else; the doctor never sees this field.
- **Expires after (days)** — absolute, no extensions.
- **OCR + LLM provider** — the providers used when the doctor clicks Translate. "Default" falls back to the system-wide [Translation Defaults](#translation-defaults) below.

The dialog returns a URL exactly once. Send that to the doctor however you like — the link itself is useless without the OTP.

### Conveying the code

The doctor's "Request access code" click puts a fresh OTP into the share's audit log. Open the share row in the **Doctor Shares** dashboard (`/shares` in the sidebar), click **Show**, and read the 6-digit number. Convey it by phone or in person — anywhere except a channel the same person could have intercepted to see the link.

A small copy button next to the code copies it to the clipboard.

### Watching the audit trail

Every interaction the doctor (or anyone with the URL) makes is recorded:

- `otp_request` — fresh code issued
- `otp_verify_ok` / `otp_verify_fail`
- `view_doc` — opened a document
- `view_file` — fetched the PDF bytes
- `translate` — queued a translation
- `logout` / `session_expired`

Each row carries timestamp, IP address, and user-agent. Click the chevron on the left of a share row to expand the audit panel inline. The total access count and last access timestamp are also surfaced as columns on the table for at-a-glance review.

### Revoking

The Revoke button in the share row marks the share inactive and immediately invalidates any active doctor session. Subsequent OTP requests against the same token still respond `204` (we don't leak token validity) but the verify call rejects.

## Translation defaults

Settings → Document Analysis → Priority has a **Translation defaults** card. Pick an OCR provider and an LLM provider that should be used whenever someone (admin or doctor) translates a document or region. Empty means "fall through to first-enabled".

Resolution order at translate time:

1. Explicit override in the request body (admin-side region picker only)
2. Per-share defaults the admin set when creating that share
3. System translation defaults from this card
4. First-enabled provider in the priority list

This lets you dedicate a fast / cheap model to translation without touching the main extraction pipeline.

## Security model

- The URL token is 32 bytes of `secrets.token_urlsafe`. Stored both as a sha256 (for lookup) and in plaintext (so the dashboard can re-copy the link). In a self-hosted personal-records setup, DB read access already exposes everything else (PHI, audit, sessions), so the token doesn't expand the threat surface.
- Sessions are absolute 2-hour TTL with no sliding refresh. After 2 hours the doctor must request a new OTP.
- Cookie is `asclepius_share`, scoped to `/api/share`, `HttpOnly`, `Secure`, `SameSite=Strict` — distinct from the regular admin cookie so a share session can never be promoted into an account session.
- Translate is rate-limited per-session (1 request / 30s) and per-share (20 / rolling hour). Configurable via `share.translate_per_session_seconds` and `share.translate_per_share_per_hour`.
- Watermark on every page is faint vector text with the recipient name + share id + UTC timestamp. Cannot prevent screenshots, but identifies the source if a screenshot ever surfaces externally.
- All file responses set `Cache-Control: no-store` and `Content-Disposition: inline; filename=""`. The doctor's PDF viewer fetches bytes via XHR into a `Uint8Array` — no Object URL, no `<a download>`, right-click and Ctrl+S/P intercepted.

## Configuration knobs

In `settings.yaml` under `share:`:

| Key | Default | Effect |
|---|---|---|
| `session_ttl_minutes` | 120 | How long a verified doctor session lives before re-OTP |
| `otp_ttl_minutes` | 10 | OTP code lifetime from request |
| `otp_max_attempts` | 5 | Wrong-code attempts before the code burns |
| `default_share_days` | 7 | Default share expiry when admin doesn't override |
| `translate_per_session_seconds` | 30 | Debounce for the doctor's translate button |
| `translate_per_share_per_hour` | 20 | Rolling-hour cost cap per share |
| `watermark_opacity` | 0.20 | Watermark text opacity (0.0–1.0) |
