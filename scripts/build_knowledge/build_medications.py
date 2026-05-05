#!/usr/bin/env python3
"""Build bundled_config/knowledge/medications.json from Wikidata.

Source: Wikidata SPARQL endpoint. Items with property P267 (ATC code) are
medicinal compounds; we pull labels in en/it/de/fr/es plus aka aliases. The
ATC code becomes ``external_code``; the canonical_code is a slug of the
English label.

Wikidata is CC0, so the derived file ships with no attribution
constraints. Re-run this script when you want fresher coverage.

Usage::

    python scripts/build_knowledge/build_medications.py

No external dependencies — uses stdlib urllib.
"""

from __future__ import annotations

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
OUT_PATH = (
    Path(__file__).resolve().parents[2]
    / "bundled_config"
    / "knowledge"
    / "medications.json"
)

# We page through the ATC namespace alphabetically. Each query returns up to
# 10k rows. Splitting by the first letter of the ATC code keeps each request
# under the 60s endpoint budget.
ATC_PREFIXES = list("ABCDGHJLMNPRSV")  # WHO ATC anatomical groups

QUERY_TEMPLATE = """
SELECT ?item ?atc ?lang ?label ?alias WHERE {{
  ?item wdt:P267 ?atc .
  FILTER(STRSTARTS(?atc, "{prefix}"))
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
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def _slug(text: str) -> str:
    s = text.casefold()
    s = re.sub(r"[^0-9a-z]+", "_", s).strip("_")
    return s or "unknown"


def main() -> int:
    langs_clause = ", ".join(f'"{lang}"' for lang in LANGUAGES)

    # Per-item: ATC code, English display, alias set keyed by language.
    items: dict[str, dict] = {}

    for prefix in ATC_PREFIXES:
        print(f"Fetching ATC group {prefix}...", file=sys.stderr, flush=True)
        try:
            data = _sparql(QUERY_TEMPLATE.format(prefix=prefix, langs=langs_clause))
        except Exception as e:
            print(f"  failed: {e}", file=sys.stderr)
            continue

        for row in data.get("results", {}).get("bindings", []):
            item_uri = row["item"]["value"]
            atc = row["atc"]["value"]
            entry = items.setdefault(
                item_uri,
                {"atc": atc, "labels": {}, "aliases": defaultdict(set)},
            )
            if "label" in row and "lang" in row:
                lang = row["lang"]["value"]
                # Keep the first label seen for that language as canonical.
                entry["labels"].setdefault(lang, row["label"]["value"])
                entry["aliases"][lang].add(row["label"]["value"])
            if "alias" in row:
                lang = row["alias"]["xml:lang"]
                entry["aliases"][lang].add(row["alias"]["value"])

        # Be polite to the public endpoint.
        time.sleep(2)

    out: list[dict] = []
    seen_atc: set[str] = set()
    for entry in items.values():
        atc = entry["atc"]
        if atc in seen_atc:
            # Wikidata sometimes has multiple items per ATC (combination
            # products vs single compound) — keep the first one and drop the
            # rest to avoid alias conflicts.
            continue
        seen_atc.add(atc)

        display = entry["labels"].get("en") or next(
            iter(entry["labels"].values()), None
        )
        if not display:
            continue

        aliases: list[dict] = []
        for lang in LANGUAGES:
            for a in sorted(entry["aliases"].get(lang, set())):
                aliases.append({"alias": a, "language": lang})

        out.append(
            {
                "canonical_code": _slug(display),
                "external_code": atc,
                "canonical_display": display,
                "aliases": aliases,
            }
        )

    out.sort(key=lambda e: e["external_code"])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(out)} medications to {OUT_PATH}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
