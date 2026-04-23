"""Dump the FastAPI OpenAPI schema to ``frontend/src/openapi.json``.

Run from the repo root:

    python backend/scripts/export_openapi.py

The frontend then regenerates typed bindings via::

    npm --prefix frontend run gen:api

The target path can be overridden with ``--out``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Make the backend package importable when invoked from the repo root.
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))


def _build_app():
    # The app import triggers get_config(), which normally expects a real
    # config file. Point it at the bundled dev default so this script works
    # from a fresh clone without any setup.
    os.environ.setdefault(
        "ASCLEPIUS_CONFIG_PATH",
        str(BACKEND_DIR.parent / "config" / "settings.yaml"),
    )
    from asclepius.main import create_app
    return create_app()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=str(BACKEND_DIR.parent / "frontend" / "src" / "openapi.json"),
        help="Output path for the OpenAPI JSON schema",
    )
    args = parser.parse_args()

    app = _build_app()
    schema = app.openapi()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out_path} ({len(schema.get('paths', {}))} paths)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
