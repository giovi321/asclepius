"""The public share host must not answer 401/403/404 in normal use.

The proxy in front of the doctor share runs a fail2ban jail that bans an
IP after 10 responses with status 401, 403 or 404 within 2 minutes.
These tests pin the static-file side of that rule: a redeploy leaves
open pages asking for the previous build's hashed chunks, which must
answer 410, and ``index.html`` must be revalidated so a browser does not
keep loading a stale build. Browser-requested icons must exist.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import asclepius.main as main_mod
from asclepius.main import ASSET_CACHE_CONTROL, HashedAssets

FRONTEND_PUBLIC = Path(__file__).resolve().parents[2] / "frontend" / "public"


def _static_dir(tmp_path: Path) -> Path:
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "assets" / "index-abc123.js").write_text("console.log(1)")
    (static / "index.html").write_text("<!doctype html><title>x</title>")
    (static / "favicon.ico").write_bytes(b"\x00\x00\x01\x00")
    return static


def test_missing_hashed_asset_answers_410(tmp_path):
    static = _static_dir(tmp_path)
    app = FastAPI()
    app.mount("/assets", HashedAssets(directory=str(static / "assets")), name="assets")
    client = TestClient(app)

    res = client.get("/assets/index-OLDHASH.js")
    assert res.status_code == 410

    res = client.get("/assets/index-abc123.js")
    assert res.status_code == 200
    assert res.headers["cache-control"] == ASSET_CACHE_CONTROL


def test_share_mode_index_is_revalidated_and_icons_served(tmp_path, monkeypatch):
    static = _static_dir(tmp_path)
    monkeypatch.setattr(main_mod, "STATIC_DIR", static)
    monkeypatch.setenv("ASCLEPIUS_MODE", "share")
    client = TestClient(main_mod.create_app())

    for path in ("/", "/share/sometoken", "/share/dashboard", "/index.html"):
        res = client.get(path)
        assert res.status_code == 200, path
        assert res.headers["cache-control"] == "no-cache", path

    assert client.get("/favicon.ico").status_code == 200
    assert client.get("/assets/chunk-GONE.js").status_code == 410


def test_frontend_ships_browser_requested_icons():
    for name in ("favicon.ico", "apple-touch-icon.png", "apple-touch-icon-precomposed.png"):
        assert (FRONTEND_PUBLIC / name).is_file(), name
