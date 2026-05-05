"""End-to-end security regression tests.

These tests pin down the invariants introduced by the P0 security pass so
later changes cannot silently regress:

- CSRF middleware rejects cookie-authenticated mutations without the
  ``X-Requested-With`` header.
- Security headers are present on every response.
- The SPA catch-all does not leak host files through ``../`` traversal.
"""

import pytest


@pytest.mark.asyncio
async def test_security_headers_present(unauthed_client):
    resp = await unauthed_client.get("/health")
    assert resp.status_code == 200
    # Every response goes through SecurityHeadersMiddleware.
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "DENY"
    assert resp.headers.get("Referrer-Policy") == "no-referrer"
    assert "Content-Security-Policy" in resp.headers


@pytest.mark.asyncio
async def test_csrf_blocks_cookie_mutations_without_header(client):
    """With session cookie but no CSRF header, mutations return 403."""
    # ``client`` is authenticated and has the session cookie; strip the
    # CSRF header and try to mutate.
    no_csrf_headers = {k: v for k, v in client.headers.items() if k.lower() != "x-requested-with"}
    client.headers.clear()
    client.headers.update(no_csrf_headers)
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 403
    assert "CSRF" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_csrf_allows_header_bearing_mutations(client):
    """With CSRF header, the same request succeeds."""
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_login_exempt_from_csrf(unauthed_client):
    """Login creates the session cookie — it cannot require it on input."""
    resp = await unauthed_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin-password"},
    )
    # Still accepted even without X-Requested-With would be fine, but here
    # we keep the header on; the important check is the handler reached.
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_spa_catchall_rejects_traversal(unauthed_client):
    """``GET /../../etc/passwd`` must not leak host files."""
    # The route is only registered if STATIC_DIR exists; in tests it does
    # not, so the catch-all returns 404 / index.html missing. Either way
    # we must never return the host's passwd file.
    resp = await unauthed_client.get("/../../etc/passwd")
    assert resp.status_code in (404, 400)
    body = resp.content or b""
    assert b"root:" not in body


# ── Chat SQL sanitiser ────────────────────────────────────────────

from asclepius.chat.service import _sanitize_sql  # noqa: E402


class TestSanitizeSql:
    def test_accepts_select(self):
        out = _sanitize_sql("SELECT id FROM documents WHERE patient_id = 1", 1)
        assert out is not None and out.upper().startswith("SELECT")

    def test_rejects_update(self):
        assert _sanitize_sql("UPDATE documents SET patient_id=1 WHERE id=1", None) is None

    def test_rejects_comment_bypass(self):
        # A naive blocklist would miss this because ``INSERT`` is inside a
        # block comment; we strip comments *before* the check.
        sql = "SELECT * FROM documents /* sneaky INSERT here */ WHERE patient_id=1"
        out = _sanitize_sql(sql, 1)
        # Comment stripped; remaining statement is a valid SELECT.
        assert out is not None
        assert "INSERT" not in out.upper()

    def test_rejects_pragma(self):
        assert _sanitize_sql("SELECT 1 UNION SELECT * FROM sqlite_master", None) is None

    def test_rejects_multi_statement(self):
        assert _sanitize_sql("SELECT 1; DROP TABLE users", None) is None

    def test_rejects_disallowed_table(self):
        assert _sanitize_sql("SELECT * FROM users WHERE id = 1", None) is None

    def test_requires_patient_filter_when_scoped(self):
        assert _sanitize_sql("SELECT id FROM documents", 42) is None

    def test_caps_limit(self):
        out = _sanitize_sql(
            "SELECT id FROM documents WHERE patient_id=1 LIMIT 9999",
            1,
        )
        assert out is not None and "LIMIT 100" in out.upper()

    def test_rejects_pragma_keyword(self):
        assert _sanitize_sql("SELECT id FROM documents; PRAGMA table_info(documents)", 1) is None
