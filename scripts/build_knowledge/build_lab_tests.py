#!/usr/bin/env python3
"""Build bundled_config/knowledge/lab_tests.json.

The LOINC codes this script writes are obtained from Wikidata items with
property P4338 (Wikidata is CC0) and from the project's existing curated
seed file. The codes themselves are © Regenstrief Institute, Inc. and the
LOINC Committee — see ``NOTICE`` at the repo root for the LOINC short
notice required by Section 10 of the LOINC license. The Wikidata-derived
display strings are best-effort approximations of LOINC's official long
common names, not byte-for-byte copies of the LOINC Table fields.

For deployments that need strict adherence to the LOINC display-name
requirement, register at https://loinc.org, drop the LOINC Table CSV at
``scripts/build_knowledge/loinc.csv``, and re-run this script — it will
overlay the official ``LONG_COMMON_NAME`` and ``SHORTNAME`` fields on top
of (and in priority over) the Wikidata labels.

Sources, in load order::

  1. config/seeds/lab_tests.json (existing curated set)
  2. scripts/build_knowledge/loinc.csv (optional, official LOINC table)
  3. Wikidata SPARQL P4338 query (CC0)

Usage::

    python scripts/build_knowledge/build_lab_tests.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ENDPOINT = "https://query.wikidata.org/sparql"
LANGUAGES = ["en", "it", "de", "fr", "es"]
USER_AGENT = "asclepius-knowledge-builder/1.0 (https://github.com/giovi321/asclepius)"
ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "bundled_config" / "knowledge" / "lab_tests.json"
SEED_PATH = ROOT / "config" / "seeds" / "lab_tests.json"
LOCAL_LOINC = Path(__file__).resolve().parent / "loinc.csv"

# Wikidata: P4338 = LOINC code. Pull all of them (there are only a few
# thousand items in the public dump).
QUERY = """
SELECT ?item ?loinc ?lang ?label ?alias WHERE {{
  ?item wdt:P4338 ?loinc .
  OPTIONAL {{
    ?item rdfs:label ?label .
    FILTER(LANG(?label) IN ({langs}))
    BIND(LANG(?label) AS ?lang)
  }}
  OPTIONAL {{
    ?item skos:altLabel ?alias .
    FILTER(LANG(?alias) IN ({langs}))
  }}
}}
LIMIT 50000
"""


def _sparql(query: str) -> dict:
    body = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


def _slug(text: str) -> str:
    s = text.casefold()
    s = re.sub(r"[^0-9a-z]+", "_", s).strip("_")
    return s or "unknown"


def _from_seed() -> dict[str, dict]:
    """Load the existing curated seed file as a starting point."""
    if not SEED_PATH.is_file():
        return {}
    data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for entry in data:
        loinc = entry.get("loinc_code")
        if not loinc:
            continue
        out[loinc] = {
            "loinc": loinc,
            "labels": {},
            "aliases": defaultdict(set, {
                a.get("language") or "en": {a["alias"]}
                for a in entry.get("aliases", []) if isinstance(a, dict) and a.get("alias")
            }),
        }
        if entry.get("canonical_display"):
            out[loinc]["labels"]["en"] = entry["canonical_display"]
    return out


def _from_local_loinc(items: dict[str, dict]) -> None:
    """Overlay official LOINC table fields on top of any earlier sources.

    LOINC is the authoritative source — when its CSV is present, its
    LONG_COMMON_NAME *replaces* the English canonical label populated from
    seeds or Wikidata, and its SHORTNAME is added as an alias. This is what
    deployments needing strict LOINC display-name compliance rely on.
    """
    if not LOCAL_LOINC.is_file():
        print(f"(no local LOINC csv at {LOCAL_LOINC} — skipping)", file=sys.stderr)
        return
    print(f"Overlaying official LOINC csv from {LOCAL_LOINC}...", file=sys.stderr)
    with LOCAL_LOINC.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row.get("LOINC_NUM") or row.get("loinc_num")
            display = (
                row.get("LONG_COMMON_NAME")
                or row.get("long_common_name")
                or row.get("COMPONENT")
                or row.get("component")
            )
            if not code or not display:
                continue
            entry = items.setdefault(
                code,
                {"loinc": code, "labels": {}, "aliases": defaultdict(set)},
            )
            # Direct assignment — LOINC table wins over seed/Wikidata for
            # the canonical English display, satisfying the LOINC license's
            # display-name requirement.
            entry["labels"]["en"] = display
            entry["aliases"]["en"].add(display)
            short = row.get("SHORTNAME") or row.get("shortname")
            if short:
                entry["aliases"]["en"].add(short)


def _from_wikidata(items: dict[str, dict]) -> None:
    print("Fetching LOINC items from Wikidata...", file=sys.stderr)
    langs_clause = ", ".join(f'"{l}"' for l in LANGUAGES)
    try:
        data = _sparql(QUERY.format(langs=langs_clause))
    except Exception as e:
        print(f"  failed: {e}", file=sys.stderr)
        return
    for row in data.get("results", {}).get("bindings", []):
        loinc = row["loinc"]["value"]
        entry = items.setdefault(
            loinc,
            {"loinc": loinc, "labels": {}, "aliases": defaultdict(set)},
        )
        if "label" in row and "lang" in row:
            lang = row["lang"]["value"]
            entry["labels"].setdefault(lang, row["label"]["value"])
            entry["aliases"][lang].add(row["label"]["value"])
        if "alias" in row:
            lang = row["alias"]["xml:lang"]
            entry["aliases"][lang].add(row["alias"]["value"])
    time.sleep(2)


def main() -> int:
    items = _from_seed()
    _from_wikidata(items)
    # LOINC CSV runs LAST so its display names take precedence over seed
    # and Wikidata labels — see docstring for the compliance rationale.
    _from_local_loinc(items)

    out: list[dict] = []
    for entry in items.values():
        display = entry["labels"].get("en") or next(iter(entry["labels"].values()), None)
        if not display:
            continue
        aliases: list[dict] = []
        for lang in LANGUAGES:
            for a in sorted(entry["aliases"].get(lang, set())):
                aliases.append({"alias": a, "language": lang})
        out.append({
            "canonical_code": _slug(display),
            "external_code": entry["loinc"],
            "canonical_display": display,
            "aliases": aliases,
        })

    out.sort(key=lambda e: e["external_code"])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(out)} lab tests to {OUT_PATH}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
