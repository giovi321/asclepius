# Knowledge bases

These files ground the auto-merge feature in real medical reference data
instead of asking the LLM to remember pharmacology and ICD chapters from
training. See `backend/asclepius/normalization/knowledge_base.py` for the
loader and `backend/asclepius/normalization/auto_merge.py` for how they're
applied (deterministic same-code merges run before any LLM call).

## Files

| File | What | Source |
| --- | --- | --- |
| `medications.json` | Drugs keyed by ATC code, multilingual aliases (en/it/de/fr/es) | Wikidata property P267 |
| `diagnoses.json` | ICD-10 chapters and 3-character codes, multilingual labels | Wikidata property P494 |
| `lab_tests.json` | Lab tests keyed by LOINC, multilingual labels | Wikidata property P4338 + `config/seeds/lab_tests.json` + optional local LOINC CSV |

All three follow the same shape as the seed files in `config/seeds/`:

```json
{
  "canonical_code": "amoxicillin",
  "external_code": "J01CA04",
  "canonical_display": "Amoxicillin",
  "aliases": [
    {"alias": "Zimox", "language": "it"}
  ]
}
```

`external_code` is the lookup key — ATC for drugs, ICD-10 for diagnoses,
LOINC for labs.

## Licensing

- **Wikidata**: CC0 (public domain). Can be redistributed without
  attribution, but it's the right thing to do, so this README is the
  attribution.
- **LOINC**: covered by Regenstrief's free license; redistribution requires
  registration and including the LOINC license notice. We do **not** ship
  bundled LOINC. The `lab_tests.json` here is built from the CC0 Wikidata
  P4338 mappings and the project's hand-curated seed list. If you have
  registered for LOINC and want richer coverage, drop the LOINC table CSV
  at `scripts/build_knowledge/loinc.csv` and re-run the build script.
- **ICD-10**: WHO classification, free to use; we use the Wikidata mapping
  (CC0) so no separate WHO download is needed.

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
