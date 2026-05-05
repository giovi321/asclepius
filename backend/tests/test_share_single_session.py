"""Tests for the single-session-per-share constraint and the queue.

Reuses the ``share_app`` fixture from ``conftest.py`` and the ``_seed``
helper from ``test_share_e2e.py``.
"""

from __future__ import annotations

from tests.test_share_e2e import _seed


def _admin_cookies(seed: dict) -> dict:
    return {"asclepius_session": seed["admin_cookie"]}


def _csrf() -> dict:
    return {"X-Requested-With": "XMLHttpRequest"}


def _create_share_and_get_token(client, seed) -> tuple[int, str]:
    res = client.post(
        "/api/shares",
        json={
            "patient_id": seed["patient_id"],
            "document_ids": [seed["doc_id"]],
            "recipient_label": "Dr. Test",
            "recipient_contact": "phone",
            "expires_in_days": 7,
        },
        cookies=_admin_cookies(seed),
        headers=_csrf(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    return body["share_id"], body["share_url"].rsplit("/", 1)[-1]


def _fetch_active_otp(client, share_id: int, seed) -> str:
    res = client.get(
        f"/api/shares/{share_id}/audit",
        params={"include_active_otp": True},
        cookies=_admin_cookies(seed),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("active_otp") is not None, f"no active OTP in audit response: {body!r}"
    return body["active_otp"]["code"]


def _verify_otp(client, token: str, code: str):
    return client.post(
        f"/api/share/{token}/verify-otp",
        json={"code": code},
        headers=_csrf(),
    )


def test_second_device_gets_queued(share_app):
    """While device A holds the session, device B's verify-otp must return
    HTTP 202 with ``status: "queued"`` and set the queue cookie instead
    of the session cookie."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client_a, TestClient(app) as client_b:
        seed = _seed(db_path, vault)
        share_id, token = _create_share_and_get_token(client_a, seed)

        # Device A claims the slot.
        client_a.post(f"/api/share/{token}/request-otp", headers=_csrf())
        code_a = _fetch_active_otp(client_a, share_id, seed)
        res = _verify_otp(client_a, token, code_a)
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "active"
        assert "asclepius_share" in res.cookies

        # Device B asks for its own OTP and tries to verify.
        client_b.post(f"/api/share/{token}/request-otp", headers=_csrf())
        code_b = _fetch_active_otp(client_b, share_id, seed)
        res = _verify_otp(client_b, token, code_b)

        assert res.status_code == 202, res.text
        body = res.json()
        assert body["status"] == "queued"
        assert "queue_expires_at" in body
        assert body["recipient_label"] == "Dr. Test"
        assert "asclepius_share_queue" in res.cookies
        # Crucially the session cookie must NOT be set on the queued response.
        assert "asclepius_share" not in res.cookies


def test_claim_promotes_after_active_session_logout(share_app):
    """Once device A logs out, device B's /claim call must promote the
    queue token into a real session and swap the cookies."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client_a, TestClient(app) as client_b:
        seed = _seed(db_path, vault)
        share_id, token = _create_share_and_get_token(client_a, seed)

        # A holds the slot.
        client_a.post(f"/api/share/{token}/request-otp", headers=_csrf())
        _verify_otp(client_a, token, _fetch_active_otp(client_a, share_id, seed))

        # B gets queued.
        client_b.post(f"/api/share/{token}/request-otp", headers=_csrf())
        _verify_otp(client_b, token, _fetch_active_otp(client_b, share_id, seed))

        # B's claim while A is still active → 202 queued.
        res = client_b.post("/api/share/claim", headers=_csrf())
        assert res.status_code == 202, res.text
        assert res.json()["status"] == "queued"

        # A logs out.
        res = client_a.post("/api/share/logout", headers=_csrf())
        assert res.status_code == 200

        # B's next claim → 200 active, session cookie set.
        res = client_b.post("/api/share/claim", headers=_csrf())
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "active"
        assert "asclepius_share" in res.cookies

        # B can now hit /me.
        res = client_b.get("/api/share/me", headers=_csrf())
        assert res.status_code == 200, res.text


def test_queue_cancel_clears_cookie(share_app):
    """DELETE /queue must drop the queue row and clear the cookie."""
    from fastapi.testclient import TestClient

    app, vault, db_path = share_app
    with TestClient(app) as client_a, TestClient(app) as client_b:
        seed = _seed(db_path, vault)
        share_id, token = _create_share_and_get_token(client_a, seed)

        client_a.post(f"/api/share/{token}/request-otp", headers=_csrf())
        _verify_otp(client_a, token, _fetch_active_otp(client_a, share_id, seed))

        client_b.post(f"/api/share/{token}/request-otp", headers=_csrf())
        _verify_otp(client_b, token, _fetch_active_otp(client_b, share_id, seed))
        assert "asclepius_share_queue" in client_b.cookies

        # Cancel.
        res = client_b.delete("/api/share/queue", headers=_csrf())
        assert res.status_code == 204

        # Subsequent claim → 410 Gone (no queue cookie).
        res = client_b.post("/api/share/claim", headers=_csrf())
        assert res.status_code == 410


def test_idle_timeout_frees_slot(share_app, monkeypatch):
    """A session whose last_seen_at falls outside the idle window is
    treated as dead. A second device's verify-otp should hand back an
    active session, not a queue token."""
    from fastapi.testclient import TestClient
    from asclepius.config import get_config

    app, vault, db_path = share_app
    cfg = get_config()
    monkeypatch.setattr(cfg.share, "idle_timeout_minutes", 1)

    with TestClient(app) as client_a, TestClient(app) as client_b:
        seed = _seed(db_path, vault)
        share_id, token = _create_share_and_get_token(client_a, seed)

        client_a.post(f"/api/share/{token}/request-otp", headers=_csrf())
        _verify_otp(client_a, token, _fetch_active_otp(client_a, share_id, seed))

        # Manually backdate last_seen_at so the session looks idle.
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        try:
            conn.execute(
                "UPDATE document_share_sessions "
                "SET last_seen_at = datetime('now', '-30 minutes') "
                "WHERE share_id = ?",
                (share_id,),
            )
            conn.commit()
        finally:
            conn.close()

        # Device B verifies — session A is now idle, slot is free.
        client_b.post(f"/api/share/{token}/request-otp", headers=_csrf())
        res = _verify_otp(client_b, token, _fetch_active_otp(client_b, share_id, seed))
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "active"


def test_heartbeat_bumps_last_seen(share_app):
    """A heartbeat ping must refresh last_seen_at on a non-idle session.

    Heartbeat deliberately does NOT resurrect a session that is already
    past the idle threshold, so we backdate to "old enough to detect a
    bump" but still inside the 10-minute idle window.
    """
    from fastapi.testclient import TestClient
    import sqlite3
    import time

    app, vault, db_path = share_app
    with TestClient(app) as client:
        seed = _seed(db_path, vault)
        share_id, token = _create_share_and_get_token(client, seed)
        client.post(f"/api/share/{token}/request-otp", headers=_csrf())
        _verify_otp(client, token, _fetch_active_otp(client, share_id, seed))

        # Backdate within the idle window so heartbeat still fires.
        conn = sqlite3.connect(str(db_path))
        try:
            conn.execute(
                "UPDATE document_share_sessions "
                "SET last_seen_at = datetime('now', '-2 minutes') "
                "WHERE share_id = ?",
                (share_id,),
            )
            conn.commit()
            before = conn.execute(
                "SELECT last_seen_at FROM document_share_sessions WHERE share_id = ?",
                (share_id,),
            ).fetchone()[0]
        finally:
            conn.close()

        # SQLite CURRENT_TIMESTAMP is second-precision — wait so the bump
        # is observable.
        time.sleep(1.1)

        res = client.post("/api/share/heartbeat", headers=_csrf())
        assert res.status_code == 204, (res.status_code, res.text)

        conn = sqlite3.connect(str(db_path))
        try:
            after = conn.execute(
                "SELECT last_seen_at FROM document_share_sessions WHERE share_id = ?",
                (share_id,),
            ).fetchone()[0]
        finally:
            conn.close()
        assert after > before, f"heartbeat did not bump last_seen_at ({before!r} → {after!r})"
