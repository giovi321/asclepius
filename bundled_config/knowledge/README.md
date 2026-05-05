# Knowledge bases

These files ground the auto-merge feature in real medical reference data
instead of asking the LLM to remember pharmacology and ICD chapters from
training. See `backend/asclepius/normalization/knowledge_base.py` for the
loader and `backend/asclepius/normalization/auto_merge.py` for how they're
applied (deterministic same-code merges run before any LLM call).

## Files

| File               | What                                                           | Source                                                                             |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `medications.json` | Drugs keyed by ATC code, multilingual aliases (en/it/de/fr/es) | Wikidata property P267                                                             |
| `diagnoses.json`   | ICD-10 chapters and 3-character codes, multilingual labels     | Wikidata property P494                                                             |
| `lab_tests.json`   | Lab tests keyed by LOINC, multilingual labels                  | Wikidata property P4338 + `config/seeds/lab_tests.json` + optional local LOINC CSV |

All three follow the same shape as the seed files in `config/seeds/`:

```json
{
  "canonical_code": "amoxicillin",
  "external_code": "J01CA04",
  "canonical_display": "Amoxicillin",
  "aliases": [{ "alias": "Zimox", "language": "it" }]
}
```

`external_code` is the lookup key — ATC for drugs, ICD-10 for diagnoses,
LOINC for labs.

## Licensing

See [`NOTICE`](../../NOTICE) at the repo root for the canonical
attribution text. Summary:

- **Wikidata**: CC0 (public domain). The build scripts pull from Wikidata's
  SPARQL endpoint; the `medications.json`, `diagnoses.json`, and
  `lab_tests.json` data tables are derived works of CC0 content.
- **LOINC** (in `lab_tests.json`): the LOINC codes and the long-form names
  associated with them are © Regenstrief Institute, Inc. and the LOINC
  Committee, available under the LOINC license at
  https://loinc.org/license/. Redistribution is permitted (Section 10) as
  long as the required notice is included — see `NOTICE`. The English
  display strings shipped here are verbatim copies of the official LOINC
  `LONG_COMMON_NAME` field (LOINC release 2.82). Italian, French, German,
  and Spanish aliases come from the official LOINC Linguistic Variants
  files (itIT16, frFR18, deDE15, esES12). The set of codes shipped is the
  intersection of Wikidata's P4338 mapping and our hand-curated seed list —
  roughly 480 commonly-referenced laboratory tests, not the full ~109k
  LOINC table. To regenerate or extend, register at https://loinc.org,
  place `LoincTableCore.csv` at `scripts/build_knowledge/loinc.csv` (and
  the LinguisticVariant CSVs at `loinc_{it,fr,de,es}.csv`), then re-run
  `build_lab_tests.py`.
- **ATC** (in `medications.json`): codes maintained by the WHO
  Collaborating Centre for Drug Statistics Methodology; sourced via
  Wikidata for redistribution-friendly use as identifiers.
- **ICD-10** (in `diagnoses.json`): WHO classification; sourced via
  Wikidata.

## Regenerating

```bash
python scripts/build_knowledge/build_medications.py
python scripts/build_knowledge/build_diagnoses.py
python scripts/build_knowledge/build_lab_tests.py
```

Each script hits `https://query.wikidata.org/sparql` with a polite
2-second pause between requests. Re-run when you want to refresh the
mappings (Wikidata changes daily but the long tail is stable).

The build scripts have no third-party dependencies — stdlib `urllib` only —
so they run with any Python ≥ 3.10.

## Override per install

If a deployment needs to ship its own curated knowledge (e.g. a clinic with
local internal codes), drop replacement files at:

```
$ASCLEPIUS_CONFIG_PATH/../knowledge/{medications,diagnoses,lab_tests}.json
```

The loader in `knowledge_base.py` checks the user-config path first and
falls back to the bundled copy here, mirroring the `SEEDS_DIR` /
`BUNDLED_SEEDS_DIR` precedence in `backend/asclepius/db/init.py`.
