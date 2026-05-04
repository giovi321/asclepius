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

Settings → Document Analysis → Priority has a **Translation defaults** card. Pick an OCR provider and an LLM provider that should be used whenever someone (admin or doctor) translates a document or region. Leave empty to skip this layer.

Translation jobs walk a four-level cascade and use the first level that has a provider set. From most specific to least:

1. **A one-off pick from the admin Translate dropdown** on a document. If you, as admin, click Translate → Region and pick OCR/LLM in the dropdowns, those choices override everything else. (Doctors don't have this control.)
2. **The per-share preference** you saved when creating a doctor share. Applies to every translate the doctor does within that one share.
3. **The Translation defaults card itself.** Used whenever neither of the above is set, regardless of who's translating.
4. **The first enabled provider in the priority list** below the card. Final fallback if none of the layers above have anything to say.

This is why the Translation defaults are useful: they let you pin a specific OCR / LLM for translation across every document and every share, without having to set the preference per-share or remember to pick it from the dropdown each time. A common setup is to leave levels 1 and 2 empty and use level 3 to point translation at a fast remote model, while the main extraction pipeline keeps using a local one.

## Security model

- The URL token is 32 bytes of `secrets.token_urlsafe`. Stored both as a sha256 (for lookup) and in plaintext (so the dashboard can re-copy the link). In a self-hosted personal-records setup, DB read access already exposes everything else (PHI, audit, sessions), so the token doesn't expand the threat surface.
- Sessions are absolute 2-hour TTL with no sliding refresh. After 2 hours the doctor must request a new OTP.
- Cookie is `asclepius_share`, scoped to `/api/share`, `HttpOnly`, `Secure`, `SameSite=Strict` — distinct from the regular admin cookie so a share session can never be promoted into an account session.
- Translate is rate-limited per-session (1 request / 30s) and per-share (20 / rolling hour). Configurable via `share.translate_per_session_seconds` and `share.translate_per_share_per_hour`.
- Watermark on every page is faint vector text with the recipient name + UTC timestamp. Cannot prevent screenshots, but identifies the source if a screenshot ever surfaces externally.
- All file responses set `Cache-Control: no-store` and `Content-Disposition: inline; filename=""`. The doctor's PDF viewer fetches bytes via XHR into a `Uint8Array` — no Object URL, no `<a download>`, right-click and Ctrl+S/P intercepted.

## Publishing the share surface to the internet

The bundled `docker-compose.yml` ships two services. `asclepius-core` is the full app, kept on the LAN. `asclepius-share` runs the same image with `ASCLEPIUS_MODE=share` and is the **only** container you should ever bind to a public port.

### What share mode mounts

In share mode the FastAPI app starts with everything stripped except the doctor surface:

| Surface | Behaviour in share mode |
|---|---|
| `/api/share/{token}/request-otp`, `verify-otp`, `claim`, `queue`, `heartbeat`, `logout` | Mounted (public OTP / queue / session bootstrap) |
| `/api/share/me`, `/documents/{id}`, `/file`, `/translate-region`, region-translation thumbnails | Mounted (doctor read surface) |
| `/api/auth`, `/api/patients`, `/api/documents`, `/api/pipeline`, `/api/settings`, `/api/vault`, `/api/setup`, `/api/shares` (admin), every other admin router | **Not mounted — returns 404** |
| Inbox watcher, backup scheduler | **Not started** — only the core container watches the shared inbox |
| In-process pipeline worker | **Started** — drains the doctor's translate jobs locally (queue is per-process, not the SQLite `pipeline_queue` table) |
| SPA fallback | Only serves `index.html` for `/`, `/share`, and `/share/...`. `/admin`, `/login`, `/patients`, etc. return 404 |
| `/health` | Mounted; reports `{"status": "ok", "mode": "share"}` so you can verify the deployment |

Token minting and revocation stay on the core admin app — the share container has no `/api/shares` endpoint, so even leaking its environment cannot let anyone create a new token.

### Topology

```
    Internet  ──TLS──▶  Reverse proxy (nginx / Caddy / Traefik)
                              │
                              ▼
                        asclepius-share        (host port 8071, ASCLEPIUS_MODE=share)
                              │
              shared SQLite + vault bind mounts
                              │
                        asclepius-core         (host port 8070, LAN only)
```

Both containers read and write the same SQLite database and the same vault directory; cookies and tokens stay valid across processes because they share `ASCLEPIUS_SECRET_KEY`. Each container runs its own in-process pipeline worker: the core container drains admin uploads / reprocess / translate jobs from its own queue, the share container drains the doctor's translate jobs from its own queue. Both write the same `region_translations` and audit tables back to the shared SQLite, so results show up in the admin UI as well.

### Deployment checklist

1. **Bind the right ports.** Leave `asclepius-core` on `127.0.0.1:8070` (or a private subnet). Bind `asclepius-share` only behind your TLS reverse proxy. Override the host ports with `ASCLEPIUS_PORT` and `ASCLEPIUS_SHARE_PORT` if needed.
2. **Share `ASCLEPIUS_SECRET_KEY` between the two services** (the bundled compose file already does this via the `SECRET_KEY` env var). They must agree on the key for cookie signing and token hashing.
3. **Pin the share-link host with `ASCLEPIUS_SHARE_PUBLIC_URL`.** The admin reaches the app on the LAN host (e.g. `https://asclepius.lan.example.com`), so the link the **Share with doctor** dialog generates inherits that hostname by default — and the doctor cannot reach it. Set `ASCLEPIUS_SHARE_PUBLIC_URL=https://med.example.com` on `asclepius-core` and every generated link is rewritten to point at the public origin. Leave empty for single-address deployments where admin and doctor share the same hostname.
4. **Keep the LLM / OCR keys on the share container too** if you want region translation to work — those calls run in-process. Strip the keys (and the share container will return 503 from translate endpoints) only if you do not need that feature.
5. **Use HTTPS.** Keep `ASCLEPIUS_COOKIE_SECURE=1` (the production default) so the share session cookie carries the `Secure` attribute. Make sure your reverse proxy sends `X-Forwarded-Proto: https`; the bundled image launches uvicorn with `--proxy-headers` so that header is honored, and `FORWARDED_ALLOW_IPS=*` is the default trust list (override it to your proxy's IP if the container is reachable from anywhere else).
6. **Verify after deploy.** `curl -i https://share.example.com/api/auth/login` must return `404`. `curl -i https://share.example.com/api/share/zzz/request-otp -X POST` must return `204`. `curl -i https://share.example.com/health` must show `"mode":"share"`.
7. **Maintenance windows.** Each container drains its own queue, so doctor translates keep working even when `asclepius-core` is down — only admin-side uploads and reprocess jobs pause.

The threat model for what the doctor sees inside a session is unchanged from a LAN deployment — see [Security model](#security-model) above.

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
| `public_base_url` | `""` | Public origin pinned into every share link the admin copies. Override with env var `ASCLEPIUS_SHARE_PUBLIC_URL`. Set this when admin and doctor reach Asclepius on different hostnames; leave empty when they share one. |
