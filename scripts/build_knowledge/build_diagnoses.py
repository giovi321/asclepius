#!/usr/bin/env python3
"""Build bundled_config/knowledge/diagnoses.json from Wikidata ICD-10 data.

We use Wikidata (CC0) rather than the WHO download because Wikidata bundles
multilingual labels for the same code in one query, which is exactly what
auto-merge needs to recognise an Italian diagnosis label and an English one
as the same disease.

For now we pull only chapter and 3-character codes (e.g. "I10", "E11"); 4th
character expansions (e.g. "E11.9") can be layered in a later pass.

Usage::

    python scripts/build_knowledge/build_diagnoses.py
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
    / "diagnoses.json"
)

# Wikidata: P494 = ICD-10 code. Filter to the canonical 3-char shape "L99"
# so we don't pull the long tail of 4th-character extensions on the first
# pass — those are easier to add later when the file is already in tree.
ICD_CHAPTERS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

QUERY_TEMPLATE = """
SELECT ?item ?icd ?lang ?label ?alias WHERE {{
  ?item wdt:P494 ?icd .
  FILTER(STRSTARTS(?icd, "{prefix}"))
  FILTER(REGEX(?icd, "^[A-Z][0-9]{{2}}$"))
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
    items: dict[str, dict] = {}

    for prefix in ICD_CHAPTERS:
        print(f"Fetching ICD-10 chapter {prefix}...", file=sys.stderr, flush=True)
        try:
            data = _sparql(QUERY_TEMPLATE.format(prefix=prefix, langs=langs_clause))
        except Exception as e:
            print(f"  failed: {e}", file=sys.stderr)
            continue

        for row in data.get("results", {}).get("bindings", []):
            item_uri = row["item"]["value"]
            icd = row["icd"]["value"]
            entry = items.setdefault(
                item_uri,
                {"icd": icd, "labels": {}, "aliases": defaultdict(set)},
            )
            if "label" in row and "lang" in row:
                lang = row["lang"]["value"]
                entry["labels"].setdefault(lang, row["label"]["value"])
                entry["aliases"][lang].add(row["label"]["value"])
            if "alias" in row:
                lang = row["alias"]["xml:lang"]
                entry["aliases"][lang].add(row["alias"]["value"])

        time.sleep(2)

    out: list[dict] = []
    seen_codes: set[str] = set()
    for entry in items.values():
        icd = entry["icd"]
        if icd in seen_codes:
            continue
        seen_codes.add(icd)
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
                "external_code": icd,
                "canonical_display": display,
                "aliases": aliases,
            }
        )

    out.sort(key=lambda e: e["external_code"])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(out)} diagnoses to {OUT_PATH}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
