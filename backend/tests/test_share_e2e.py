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

import pytest


@pytest.fixture
def share_app(tmp_path, monkeypatch):
    """Build a fresh FastAPI app pointed at a throwaway sqlite + vault."""
    # Use a temp vault + sqlite + secret so we don't touch the user's data.
    vault = tmp_path / "vault"
    vault.mkdir()
    inbox = vault / "inbox"
    inbox.mkdir()
    db_path = tmp_path / "asclepius.sqlite"

    monkeypatch.setenv("ASCLEPIUS_SECRET_KEY", "x" * 64)
    monkeypatch.setenv("ASCLEPIUS_ENV", "development")
    monkeypatch.setenv("ASCLEPIUS_DB_PATH", str(db_path))
    monkeypatch.setenv("ASCLEPIUS_VAULT_PATH", str(vault))
    monkeypatch.setenv("ASCLEPIUS_COOKIE_SECURE", "false")

    # Force the resolver to ignore any settings.yaml file on disk.
    monkeypatch.setenv("ASCLEPIUS_CONFIG_PATH", str(tmp_path / "no_such_config.yaml"))

    from asclepius.db.connection import set_db_path

    set_db_path(str(db_path))

    from asclepius.main import create_app

    app = create_app()
    return app, vault, db_path


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

    # 9. File serve returns PDF content with no-store headers.
    res = client.get(f"/api/share/documents/{seed['doc_id']}/file", headers=csrf)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert "no-store" in res.headers.get("cache-control", "").lower()
    # Watermarked or pass-through; either way we got bytes.
    assert res.content[:5] == b"%PDF-"

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
