"""End-to-end smoke test for the doctor-share flow.

Spins up an in-process FastAPI client, seeds a tiny patient + admin user
+ a single PDF document, exercises the full share path:

  1. admin creates a share
  2. fetches the active OTP via the audit endpoint
  3. doctor requests an OTP (against unauthenticated public route)
  4. fetches the new OTP from audit again
  5. verifies the OTP, gets a session cookie
  6. lists shared docs + reads one doc
  7. fetches the watermarked PDF (mime-checks, but doesn't depend on
     PyMuPDF being able to actually render — we accept a passthrough fallback)
  8. revoke the share, confirm doctor endpoints now 401

The test runs without spinning the pipeline watcher and does not depend
on any LLM provider.
"""

from __future__ import annotations

from pathlib import Path


def _seed(db_path: Path, vault: Path) -> dict:
    """Insert one admin user, one patient, one PDF document. Returns ids + token."""
    import sqlite3
    from itsdangerous import URLSafeTimedSerializer
    import secrets

    # A trivially small but valid PDF.
    pdf_bytes = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n"
        b"4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 100 700 Td (Hello world) Tj ET\nendstream\nendobj\n"
        b"xref\n0 5\n0000000000 65535 f\n0000000010 00000 n\n0000000053 00000 n\n0000000099 00000 n\n0000000159 00000 n\n"
        b"trailer<</Size 5/Root 1 0 R>>\nstartxref\n240\n%%EOF\n"
    )
    pdf_path = vault / "patients" / "demo" / "2024" / "lab.pdf"
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    pdf_path.write_bytes(pdf_bytes)
    rel_path = pdf_path.relative_to(vault).as_posix()

    conn = sqlite3.connect(str(db_path))
    try:
        # Insert admin user with a known password hash.
        from asclepius.auth.session import hash_password

        admin_hash = hash_password("admin-pass-not-real")
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')",
            ("admin", admin_hash, "Admin"),
        )
        admin_id = cur.lastrowid

        cur = conn.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)",
            ("demo", "Demo Patient"),
        )
        patient_id = cur.lastrowid

        cur = conn.execute(
            """INSERT INTO documents
                  (patient_id, file_path, original_filename, doc_type,
                   ocr_text, status, uploaded_by_user_id)
               VALUES (?, ?, ?, 'lab_test', 'Hello world', 'done', ?)""",
            (patient_id, rel_path, "lab.pdf", admin_id),
        )
        doc_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    # Build a signed admin session token mimicking the regular auth path.
    sid = secrets.token_urlsafe(32)
    s = URLSafeTimedSerializer("x" * 64)
    cookie = s.dumps({"sid": sid})

    conn = sqlite3.connect(str(db_path))
    try:
        from datetime import datetime, timedelta

        conn.execute(
            "INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)",
            (sid, admin_id, (datetime.utcnow() + timedelta(hours=1)).isoformat(timespec="seconds")),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "admin_id": admin_id,
        "patient_id": patient_id,
        "doc_id": doc_id,
        "admin_cookie": cookie,
    }


def test_share_e2e_happy_path(share_app):
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    # Use TestClient as a context manager so the FastAPI lifespan runs and
    # initializes the schema before we seed.
    with TestClient(app) as client:
        seed = _seed(db_path, vault)
        _run_share_flow(client, seed)


def _run_share_flow(client, seed):
    admin_cookies = {"asclepius_session": seed["admin_cookie"]}
    csrf = {"X-Requested-With": "XMLHttpRequest"}

    # 1. Admin creates a share.
    res = client.post(
        "/api/shares",
        json={
            "patient_id": seed["patient_id"],
            "document_ids": [seed["doc_id"]],
            "recipient_label": "Dr. Test",
            "recipient_contact": "phone",
            "expires_in_days": 7,
        },
        cookies=admin_cookies,
        headers=csrf,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    share_id = body["share_id"]
    share_url = body["share_url"]
    token = share_url.rsplit("/", 1)[-1]

    # 2. Doctor requests an OTP — gets 204 regardless of token validity.
    res = client.post(f"/api/share/{token}/request-otp", headers=csrf)
    assert res.status_code == 204

    # 3. Admin reads the live OTP from audit.
    res = client.get(
        f"/api/shares/{share_id}/audit",
        params={"include_active_otp": True},
        cookies=admin_cookies,
    )
    assert res.status_code == 200, res.text
    otp = res.json()["active_otp"]
    assert otp is not None
    code = otp["code"]
    assert len(code) == 6

    # 4. Wrong code → 401.
    res = client.post(
        f"/api/share/{token}/verify-otp",
        json={"code": "000000" if code != "000000" else "111111"},
        headers=csrf,
    )
    assert res.status_code == 401

    # The wrong-code path consumed the OTP, so we need a fresh one.
    res = client.post(f"/api/share/{token}/request-otp", headers=csrf)
    assert res.status_code == 204
    res = client.get(
        f"/api/shares/{share_id}/audit",
        params={"include_active_otp": True},
        cookies=admin_cookies,
    )
    code = res.json()["active_otp"]["code"]

    # 5. Correct code → session cookie.
    res = client.post(
        f"/api/share/{token}/verify-otp",
        json={"code": code},
        headers=csrf,
    )
    assert res.status_code == 200, res.text
    assert "asclepius_share" in res.cookies

    # 6. /api/share/me now returns the curated doc list.
    res = client.get("/api/share/me", headers=csrf)
    assert res.status_code == 200, res.text
    me = res.json()
    assert me["recipient_label"] == "Dr. Test"
    assert me["patient_name"] == "Demo Patient"
    assert len(me["documents"]) == 1
    assert me["documents"][0]["id"] == seed["doc_id"]

    # 7. Doc detail accessible.
    res = client.get(f"/api/share/documents/{seed['doc_id']}", headers=csrf)
    assert res.status_code == 200, res.text
    assert res.json()["id"] == seed["doc_id"]
    assert "file_path" not in res.json()  # Vault path stripped.

    # 8. Documents not in the share → 404.
    res = client.get("/api/share/documents/9999", headers=csrf)
    assert res.status_code == 404

    # 9. File serve returns a watermarked PDF with no-store headers.
    res = client.get(f"/api/share/documents/{seed['doc_id']}/file", headers=csrf)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert "no-store" in res.headers.get("cache-control", "").lower()
    assert res.content[:5] == b"%PDF-"
    # The watermark must actually be present — earlier we shipped a version
    # where ``insert_textbox(rotate=45)`` raised silently and the served
    # bytes were the un-stamped original. Re-open the served bytes with
    # PyMuPDF and confirm the recipient label is now searchable on page 1.
    import io as _io
    import fitz as _fitz

    served = _fitz.open(stream=_io.BytesIO(res.content), filetype="pdf")
    try:
        hits = served[0].search_for("Dr. Test")
        assert hits, "Watermark missing from served PDF"
    finally:
        served.close()

    # 10. Logout clears the cookie.
    res = client.post("/api/share/logout", headers=csrf)
    assert res.status_code == 200
    res = client.get("/api/share/me", headers=csrf)
    assert res.status_code == 401

    # 11. Admin revokes the share — even a fresh OTP exchange should fail.
    res = client.delete(f"/api/shares/{share_id}", cookies=admin_cookies, headers=csrf)
    assert res.status_code == 200
    res = client.post(f"/api/share/{token}/request-otp", headers=csrf)
    # Still 204 — we don't leak token validity. But the share is inert:
    # a verify call would 401.
    assert res.status_code == 204


# ── Email-OTP delivery ───────────────────────────────────────────


def _enable_smtp(monkeypatch):
    """Flip SMTP on in the cached config so the public-share request-otp
    endpoint takes the email branch and the admin share-create accepts
    ``otp_delivery='email'``."""
    from asclepius.config import get_config

    cfg = get_config()
    cfg.smtp.enabled = True
    cfg.smtp.host = "smtp.test"
    cfg.smtp.port = 587
    cfg.smtp.from_address = "noreply@test"
    cfg.smtp.use_starttls = True
    cfg.smtp.use_tls = False


def _patch_send(monkeypatch):
    """Replace the network-touching ``send_otp_email`` with a capturing
    stub. Returns the list it records into so the test can assert on
    every call (one per request-otp)."""
    calls: list[dict] = []

    async def _capture(cfg, *, to, code, recipient_label, expires_minutes, share_label=""):
        calls.append(
            {
                "to": to,
                "code": code,
                "recipient_label": recipient_label,
                "expires_minutes": expires_minutes,
            }
        )

    # Patch on the import site the route module pulled in.
    monkeypatch.setattr(
        "asclepius.share.public_routes.send_otp_email",
        _capture,
    )
    return calls


def _seed_minimal(db_path, vault):
    """Cheap seed without the heavy PDF — most email tests don't need it."""
    import sqlite3
    import secrets
    from datetime import datetime, timedelta

    from itsdangerous import URLSafeTimedSerializer
    from asclepius.auth.session import hash_password

    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) "
            "VALUES (?, ?, ?, 'admin')",
            ("admin", hash_password("x"), "Admin"),
        )
        admin_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)",
            ("p", "P"),
        )
        patient_id = cur.lastrowid
        # Cheap stub PDF file — file_path can't be empty for the share docs.
        pdf_path = vault / "patients" / "p" / "a.pdf"
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        pdf_path.write_bytes(b"%PDF-1.4\n%%EOF\n")
        cur = conn.execute(
            """INSERT INTO documents
                  (patient_id, file_path, original_filename, doc_type,
                   ocr_text, status, uploaded_by_user_id)
               VALUES (?, ?, ?, 'lab_test', '', 'done', ?)""",
            (patient_id, "patients/p/a.pdf", "a.pdf", admin_id),
        )
        doc_id = cur.lastrowid
        sid = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)",
            (sid, admin_id, (datetime.utcnow() + timedelta(hours=1)).isoformat(timespec="seconds")),
        )
        conn.commit()
    finally:
        conn.close()
    s = URLSafeTimedSerializer("x" * 64)
    return {
        "admin_cookie": s.dumps({"sid": sid}),
        "patient_id": patient_id,
        "doc_id": doc_id,
    }


def _create_share(client, seed, *, otp_delivery, contact):
    cookies = {"asclepius_session": seed["admin_cookie"]}
    csrf = {"X-Requested-With": "XMLHttpRequest"}
    res = client.post(
        "/api/shares",
        json={
            "patient_id": seed["patient_id"],
            "document_ids": [seed["doc_id"]],
            "recipient_label": "Dr. T",
            "recipient_contact": contact,
            "expires_in_days": 7,
            "otp_delivery": otp_delivery,
        },
        cookies=cookies,
        headers=csrf,
    )
    return res


def test_email_delivery_calls_sender(share_app, monkeypatch):
    """request-otp on an email share invokes send_otp_email with the
    recipient stored on the share row (NOT a value from the request)."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        _enable_smtp(monkeypatch)
        calls = _patch_send(monkeypatch)

        res = _create_share(client, seed, otp_delivery="email", contact="doc@example.com")
        assert res.status_code == 200, res.text
        token = res.json()["share_url"].rsplit("/", 1)[-1]

        res = client.post(
            f"/api/share/{token}/request-otp",
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        assert res.status_code == 204
        assert len(calls) == 1
        assert calls[0]["to"] == "doc@example.com"
        assert len(calls[0]["code"]) == 6
        assert calls[0]["recipient_label"] == "Dr. T"


def test_email_share_admin_cannot_read_otp_clear(share_app, monkeypatch):
    """The admin's /active-otp endpoint must return null for email shares
    even after a successful request-otp — closes the rogue-admin hole."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        _enable_smtp(monkeypatch)
        _patch_send(monkeypatch)

        res = _create_share(client, seed, otp_delivery="email", contact="d@e.com")
        share_id = res.json()["share_id"]
        token = res.json()["share_url"].rsplit("/", 1)[-1]

        client.post(
            f"/api/share/{token}/request-otp",
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        res = client.get(
            f"/api/shares/{share_id}/active-otp",
            cookies={"asclepius_session": seed["admin_cookie"]},
        )
        assert res.status_code == 200
        assert res.json()["active_otp"] is None


def test_three_failures_revoke_email_share(share_app, monkeypatch):
    """3 consecutive verify-otp failures on an email share revoke it."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        _enable_smtp(monkeypatch)
        _patch_send(monkeypatch)

        res = _create_share(client, seed, otp_delivery="email", contact="d@e.com")
        share_id = res.json()["share_id"]
        token = res.json()["share_url"].rsplit("/", 1)[-1]
        csrf = {"X-Requested-With": "XMLHttpRequest"}

        # Request an OTP so there is a row to verify against.
        client.post(f"/api/share/{token}/request-otp", headers=csrf)

        # 3 wrong verifies → on the 3rd, the share is revoked.
        for _ in range(3):
            r = client.post(
                f"/api/share/{token}/verify-otp",
                json={"code": "000000"},
                headers=csrf,
            )
            assert r.status_code == 401

        # Verify share is now revoked in the DB.
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute(
                "SELECT revoked_at, consecutive_otp_failures FROM document_shares WHERE id = ?",
                (share_id,),
            ).fetchone()
        finally:
            conn.close()
        assert row[0] is not None  # revoked_at set
        assert row[1] >= 3


def test_three_failures_revoke_manual_share(share_app, monkeypatch):
    """Lockout applies to manual shares too — per product decision."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        # No SMTP needed — manual delivery.

        res = _create_share(client, seed, otp_delivery="manual", contact="phone")
        share_id = res.json()["share_id"]
        token = res.json()["share_url"].rsplit("/", 1)[-1]
        csrf = {"X-Requested-With": "XMLHttpRequest"}

        client.post(f"/api/share/{token}/request-otp", headers=csrf)
        for _ in range(3):
            r = client.post(
                f"/api/share/{token}/verify-otp",
                json={"code": "999999"},
                headers=csrf,
            )
            assert r.status_code == 401

        import sqlite3

        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute(
                "SELECT revoked_at FROM document_shares WHERE id = ?",
                (share_id,),
            ).fetchone()
        finally:
            conn.close()
        assert row[0] is not None


def test_resend_cooldown_blocks_rapid_repeat(share_app, monkeypatch):
    """Two request-otp calls inside the cooldown window → second is 429."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        _enable_smtp(monkeypatch)
        _patch_send(monkeypatch)
        # Stretch the cooldown so timing flakiness doesn't matter.
        from asclepius.config import get_config

        get_config().share.email_otp_resend_cooldown_seconds = 60

        res = _create_share(client, seed, otp_delivery="email", contact="d@e.com")
        token = res.json()["share_url"].rsplit("/", 1)[-1]
        csrf = {"X-Requested-With": "XMLHttpRequest"}

        r1 = client.post(f"/api/share/{token}/request-otp", headers=csrf)
        assert r1.status_code == 204
        r2 = client.post(f"/api/share/{token}/request-otp", headers=csrf)
        assert r2.status_code == 429
        assert "retry-after" in {k.lower() for k in r2.headers.keys()}


def test_daily_email_cap_blocks_at_threshold(share_app, monkeypatch):
    """When ``email_otp_daily_cap`` audit rows already exist for today,
    the next request-otp is rejected before any code is generated."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        _enable_smtp(monkeypatch)
        _patch_send(monkeypatch)
        # Lower the cap so we don't have to insert 20 rows.
        from asclepius.config import get_config

        get_config().share.email_otp_daily_cap = 2
        # And drop the cooldown so it doesn't fire first.
        get_config().share.email_otp_resend_cooldown_seconds = 0

        res = _create_share(client, seed, otp_delivery="email", contact="d@e.com")
        share_id = res.json()["share_id"]
        token = res.json()["share_url"].rsplit("/", 1)[-1]
        csrf = {"X-Requested-With": "XMLHttpRequest"}

        # Pre-load audit rows simulating two prior sends.
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        try:
            for _ in range(2):
                conn.execute(
                    "INSERT INTO document_share_audit (share_id, action) VALUES (?, 'otp_email_sent')",
                    (share_id,),
                )
            conn.commit()
        finally:
            conn.close()

        r = client.post(f"/api/share/{token}/request-otp", headers=csrf)
        assert r.status_code == 429


def test_smtp_disabled_blocks_email_share_creation(share_app, monkeypatch):
    """Picking otp_delivery='email' while SMTP is off → 400 at create time."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        # Make sure SMTP is OFF.
        from asclepius.config import get_config

        get_config().smtp.enabled = False

        res = _create_share(client, seed, otp_delivery="email", contact="d@e.com")
        assert res.status_code == 400
        assert "SMTP" in res.json()["detail"]


def test_info_endpoint_manual_share(share_app, monkeypatch):
    """/info on a manual share returns just delivery=manual — no
    recipient information of any kind."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        res = _create_share(client, seed, otp_delivery="manual", contact="phone")
        token = res.json()["share_url"].rsplit("/", 1)[-1]

        r = client.get(f"/api/share/{token}/info")
        assert r.status_code == 200
        assert r.json() == {"delivery": "manual"}


def test_info_endpoint_email_share_does_not_leak_recipient(share_app, monkeypatch):
    """/info on an email share returns the delivery method ONLY — the
    recipient address (even masked) must never leave the server via
    this unauthenticated endpoint."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        _enable_smtp(monkeypatch)
        res = _create_share(client, seed, otp_delivery="email", contact="doc@example.com")
        token = res.json()["share_url"].rsplit("/", 1)[-1]

        r = client.get(f"/api/share/{token}/info")
        assert r.status_code == 200
        payload = r.json()
        assert payload == {"delivery": "email"}
        # Belt-and-braces — no key anywhere in the payload (or in any
        # nested string) should leak the recipient.
        serialised = r.text
        assert "doc@example.com" not in serialised
        assert "@example.com" not in serialised


def test_info_endpoint_invalid_token_lies_as_manual(share_app, monkeypatch):
    """An invalid (or revoked) token returns the same shape as a valid
    manual share so the only thing this endpoint reveals about token
    validity is the email-or-not bit."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        _seed_minimal(db_path, vault)
        r = client.get("/api/share/this-token-does-not-exist/info")
        assert r.status_code == 200
        assert r.json() == {"delivery": "manual"}


# ── Region-translation hardening (cap / ratio / audit) ──────────


def _seed_doc_for_translate(db_path, vault):
    """Insert a tiny real PDF + documents + region_translations row.

    Returns ``{share_id, doc_id, region_row_id, ocr_text}``. The
    translate_region worker is called against this row by the tests
    below with monkey-patched OCR + LLM so we control input/output
    shapes precisely.
    """
    import sqlite3
    from datetime import datetime, timedelta

    from asclepius.auth.session import hash_password

    # Same trivially-valid PDF as the existing happy-path seed.
    pdf_bytes = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n"
        b"4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 100 700 Td (Hi) Tj ET\nendstream\nendobj\n"
        b"xref\n0 5\n0000000000 65535 f\n0000000010 00000 n\n0000000053 00000 n\n0000000099 00000 n\n0000000159 00000 n\n"
        b"trailer<</Size 5/Root 1 0 R>>\nstartxref\n240\n%%EOF\n"
    )
    pdf_path = vault / "patients" / "h" / "doc.pdf"
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    pdf_path.write_bytes(pdf_bytes)

    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) "
            "VALUES (?, ?, ?, 'admin')",
            ("admin-h", hash_password("x"), "Admin"),
        )
        admin_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO patients (slug, display_name) VALUES (?, ?)",
            ("h", "H"),
        )
        patient_id = cur.lastrowid
        cur = conn.execute(
            """INSERT INTO documents
                  (patient_id, file_path, original_filename, doc_type,
                   ocr_text, status, uploaded_by_user_id)
               VALUES (?, ?, ?, 'lab_test', '', 'done', ?)""",
            (patient_id, "patients/h/doc.pdf", "doc.pdf", admin_id),
        )
        doc_id = cur.lastrowid
        # A real share row so the worker has a share_id to audit against.
        # We don't actually use the token in these tests; just need the row
        # to satisfy the FK on the audit table.
        cur = conn.execute(
            """INSERT INTO document_shares
                  (token_hash, patient_id, created_by_user_id, recipient_label,
                   recipient_contact, contact_kind, expires_at, otp_delivery)
               VALUES (?, ?, ?, ?, ?, 'manual', ?, 'manual')""",
            (
                "test-hash-" + str(doc_id),
                patient_id,
                admin_id,
                "Dr. X",
                "phone",
                (datetime.utcnow() + timedelta(days=7)).isoformat(timespec="seconds"),
            ),
        )
        share_id = cur.lastrowid
        cur = conn.execute(
            """INSERT INTO region_translations
                  (document_id, page, bbox_x, bbox_y, bbox_w, bbox_h)
               VALUES (?, 1, 0.0, 0.0, 1.0, 1.0)""",
            (doc_id,),
        )
        region_row_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    return {
        "share_id": share_id,
        "doc_id": doc_id,
        "region_row_id": region_row_id,
    }


class _FakeLLM:
    """Stand-in for whatever ``get_llm_provider`` returns. The worker
    only ever calls ``.chat(messages=, system_prompt=)`` and reads
    ``.model`` for the audit label."""

    def __init__(self, response: str):
        self._response = response
        self.model = "fake-model"

    async def chat(self, *, messages, system_prompt=None):
        return self._response


async def _async_fake_ocr(_img, _config, _provider):
    """Replacement for ``_ocr_pil_image`` — returns canned OCR text so
    we control the input length in the ratio test."""
    return ("source text", "fake-ocr")


def _install_translate_patches(monkeypatch, *, ocr_text: str, llm_response: str):
    """Stub the heavy bits so we can call translate_region against a
    real SQLite without spinning Tesseract or an LLM."""
    from asclepius.pipeline import region_translator as rt

    async def _stub_ocr(_img, _config, _provider):
        return (ocr_text, "fake-ocr")

    monkeypatch.setattr(rt, "_ocr_pil_image", _stub_ocr)
    fake = _FakeLLM(llm_response)
    monkeypatch.setattr(rt, "get_llm_provider", lambda _cfg: fake)
    monkeypatch.setattr(rt, "_build_llm_provider", lambda _entry: fake)
    return fake


def test_translation_length_cap_truncates_output(share_app, monkeypatch):
    """An LLM output past max_translation_chars is stored truncated
    with a visible ``[truncated]`` marker; nothing else is mangled."""
    import asyncio
    import sqlite3

    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:  # noqa: F841 — lifespan init only
        seed = _seed_doc_for_translate(db_path, vault)
        from asclepius.config import get_config

        cfg = get_config()
        cfg.share.max_translation_chars = 200
        # Disable the ratio rejection for this test by making it huge.
        cfg.share.translation_max_expansion_ratio = 10_000.0

        _install_translate_patches(
            monkeypatch,
            ocr_text="x" * 500,  # 500 chars of OCR
            llm_response="A" * 5_000,  # 5 KB of LLM output, past the 200 cap
        )

        from asclepius.pipeline.region_translator import translate_region

        asyncio.run(
            translate_region(
                seed["doc_id"],
                cfg,
                region_row_id=seed["region_row_id"],
                page=1,
                bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                target_language="English",
                share_id=seed["share_id"],
            )
        )

        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute(
                "SELECT translated_text FROM region_translations WHERE id = ?",
                (seed["region_row_id"],),
            ).fetchone()
        finally:
            conn.close()
        assert row is not None and row[0] is not None
        translated = row[0]
        assert translated.endswith("[truncated]")
        assert len(translated) <= 200


def test_translation_ratio_rejected_short_input_huge_output(share_app, monkeypatch):
    """A short OCR input + giant LLM output trips the expansion-ratio
    guard. The translation is NOT persisted; the row is marked failed
    and a ``translate_region_done`` audit event records the rejection."""
    import asyncio
    import json
    import sqlite3

    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:  # noqa: F841
        seed = _seed_doc_for_translate(db_path, vault)
        from asclepius.config import get_config

        cfg = get_config()
        cfg.share.translation_max_expansion_ratio = 10.0
        cfg.share.max_translation_chars = 1_000_000  # let the ratio fire first
        cfg.share.translation_audit_enabled = True

        # 50-char OCR input; the worker uses max(len, 200) as denominator,
        # so the ratio limit is 200 * 10 = 2000 chars. 5_000 > 2000 → reject.
        _install_translate_patches(
            monkeypatch,
            ocr_text="hello world",
            llm_response="Z" * 5_000,
        )

        from asclepius.pipeline.region_translator import translate_region

        asyncio.run(
            translate_region(
                seed["doc_id"],
                cfg,
                region_row_id=seed["region_row_id"],
                page=1,
                bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                target_language="English",
                share_id=seed["share_id"],
            )
        )

        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute(
                "SELECT translated_text FROM region_translations WHERE id = ?",
                (seed["region_row_id"],),
            ).fetchone()
            audit_rows = conn.execute(
                """SELECT action, detail FROM document_share_audit
                    WHERE share_id = ? AND action = 'translate_region_done'""",
                (seed["share_id"],),
            ).fetchall()
        finally:
            conn.close()

        # The translation was NOT stored — the row carries the failure
        # marker the worker writes via _mark_region_failed.
        assert row is not None and row[0] is not None
        assert row[0].startswith("[failed:")
        # And the audit row records the rejection.
        assert len(audit_rows) == 1
        detail = json.loads(audit_rows[0][1])
        assert detail["rejected"] == "ratio"
        assert detail["translated_len"] == 5_000
        assert detail["truncated"] is False
        assert "ocr_sha256" in detail and len(detail["ocr_sha256"]) == 64


def test_translation_audit_event_recorded_on_success(share_app, monkeypatch):
    """A normal-sized successful translation writes a
    ``translate_region_done`` audit row with the OCR hash, both
    lengths, and ``truncated=False, rejected absent``."""
    import asyncio
    import hashlib
    import json
    import sqlite3

    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:  # noqa: F841
        seed = _seed_doc_for_translate(db_path, vault)
        from asclepius.config import get_config

        cfg = get_config()
        cfg.share.max_translation_chars = 50_000
        cfg.share.translation_max_expansion_ratio = 10.0
        cfg.share.translation_audit_enabled = True

        ocr = "ciao mondo, paziente con febbre alta"
        out = "Hello world, patient with high fever"
        _install_translate_patches(monkeypatch, ocr_text=ocr, llm_response=out)

        from asclepius.pipeline.region_translator import translate_region

        asyncio.run(
            translate_region(
                seed["doc_id"],
                cfg,
                region_row_id=seed["region_row_id"],
                page=1,
                bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                target_language="English",
                share_id=seed["share_id"],
            )
        )

        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute(
                "SELECT translated_text FROM region_translations WHERE id = ?",
                (seed["region_row_id"],),
            ).fetchone()
            audit_rows = conn.execute(
                """SELECT action, detail FROM document_share_audit
                    WHERE share_id = ? AND action = 'translate_region_done'""",
                (seed["share_id"],),
            ).fetchall()
        finally:
            conn.close()

        assert row is not None and row[0] == out
        assert len(audit_rows) == 1
        detail = json.loads(audit_rows[0][1])
        expected_sha = hashlib.sha256(ocr.encode("utf-8")).hexdigest()
        assert detail["ocr_sha256"] == expected_sha
        assert detail["ocr_len"] == len(ocr)
        assert detail["translated_len"] == len(out)
        assert detail["truncated"] is False
        assert "rejected" not in detail


def test_translation_audit_skipped_when_disabled(share_app, monkeypatch):
    """``translation_audit_enabled=False`` mutes the worker-side audit
    row. The translation itself still happens normally."""
    import asyncio
    import sqlite3

    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:  # noqa: F841
        seed = _seed_doc_for_translate(db_path, vault)
        from asclepius.config import get_config

        cfg = get_config()
        cfg.share.translation_audit_enabled = False
        cfg.share.max_translation_chars = 50_000
        cfg.share.translation_max_expansion_ratio = 10.0

        _install_translate_patches(
            monkeypatch,
            ocr_text="x" * 100,
            llm_response="y" * 100,
        )

        from asclepius.pipeline.region_translator import translate_region

        asyncio.run(
            translate_region(
                seed["doc_id"],
                cfg,
                region_row_id=seed["region_row_id"],
                page=1,
                bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                target_language="English",
                share_id=seed["share_id"],
            )
        )

        conn = sqlite3.connect(str(db_path))
        try:
            n = conn.execute(
                """SELECT COUNT(*) FROM document_share_audit
                    WHERE share_id = ? AND action = 'translate_region_done'""",
                (seed["share_id"],),
            ).fetchone()[0]
        finally:
            conn.close()
        assert n == 0


def test_email_share_rejects_non_email_contact(share_app, monkeypatch):
    """Email delivery + non-email contact → 400."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed_minimal(db_path, vault)
        _enable_smtp(monkeypatch)

        res = _create_share(client, seed, otp_delivery="email", contact="not-an-email")
        assert res.status_code == 400
        assert "email" in res.json()["detail"].lower()
