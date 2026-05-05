---
title: "Normalization"
---

## Why Normalization?

Medical documents use different names for the same concept depending on language, provider, and region:

- "Hemoglobin", "Haemoglobin", "Hämoglobin", "Haemoglobin (Hb)" are all the same lab test
- "Cardiology", "Kardiologie", "Cardiologie" are the same specialty
- "Ibuprofen", "Brufen", "Advil" refer to the same medication

Normalization maps these variations to a single canonical form. That gives you:

- Trend tracking that actually works across labs that name the same test differently
- Consistent filtering by specialty or diagnosis
- Cross-language search and reporting

## Normalization categories

Asclepius normalizes six categories of medical data:

| Category | Canonical Table | Alias Table | Standard Code |
|----------|----------------|-------------|---------------|
| Lab Tests | `norm_lab_tests` | `norm_lab_test_aliases` | LOINC |
| Specialties | `norm_specialties` | `norm_specialty_aliases` | -- |
| Diagnoses | `norm_diagnoses` | `norm_diagnosis_aliases` | ICD-10 |
| Medications | `norm_medications` | `norm_medication_aliases` | ATC |
| Doctors | `doctors` | `doctor_aliases` | -- |
| Facilities | `facilities` | `facility_aliases` | -- |

Each canonical entry has:

- **Canonical code** -- a unique identifier (e.g., `HEMOGLOBIN`, `CARDIOLOGY`, or a slug like `dr-hans-mueller`)
- **Canonical display name** -- human-readable name in English
- **Standard code** (where applicable) -- LOINC, ICD-10, or ATC code
- **Aliases** -- multiple alternative names in different languages

### Doctors and facilities

Doctors and facilities use the same normalization system as medical concepts. The existing `doctors` and `facilities` tables have been extended with `canonical_code` and `canonical_display` columns, and new alias tables (`doctor_aliases`, `facility_aliases`) enable the same alias management, merge, and review workflows.

This is useful because the same doctor may appear under different name variations across documents (e.g., "Dr. H. Mueller" vs. "Dr. Hans Mueller"). Merging these entries consolidates all document references to a single record.

## How normalization works

The LLM's only job is to copy the test / medication / diagnosis / specialty name exactly as the document writes it (e.g., "Hämoglobin"). A Python resolver then maps that raw name to a canonical ID:

1. **Exact alias match**, case-insensitive lookup against the alias table. Covered by the seed data for common tests, specialties, diagnoses, and medications.
2. **Fuzzy match**, if no exact hit, run `rapidfuzz.process.extractOne` with a score threshold of 85. Catches OCR drift, typos, and minor language variants ("Hepatite C" vs "Hepatitis C", "S-Creatinina" vs "Creatinina"). The matching original text is inserted as a new alias on the canonical entry so the next document with the same phrasing lands on step 1.
3. **Auto-create**, still nothing? The resolver inserts a new canonical row with `canonical_display` set to the original wording and the original text as an `auto_mapped=1` alias. The row appears in Settings → Normalization flagged for review.

The alias tables aren't sent to the LLM as prompt context any more. Before this refactor the prompt carried every `(canonical_code, alias)` row inline, a moderately-used install pushed extraction prompts past 400 kB, which broke schema adherence on small models. Doing the match in Python is faster, deterministic, auditable, and scales with the database instead of the prompt.

### Auto-mapped aliases

Any alias inserted by the resolver (steps 2 and 3 above) has `auto_mapped = 1`. Manually curated aliases have `auto_mapped = 0`. The row displays an `auto` badge in the Normalization UI and contributes to the entry's "unreviewed" count. Confirm them in bulk from the row-level Confirm action.

A self-alias whose text matches the canonical display name exactly (case- and whitespace-insensitive) is auto-confirmed on insert because there's no normalization decision to audit, it's just the canonical form echoed back. A one-shot migration clears the `auto_mapped` flag on any existing self-alias of that kind.

## Managing normalization data

From **Settings → Document Analysis → Normalization**, you can:

### View canonical entries

Browse all canonical entries for each category with their alias counts. The entry's `canonical_code` and `canonical_display` are both shown; long values truncate with a tooltip so rows stay on one line.

### Add aliases

Add new aliases to map additional name variations to existing canonical entries. Each alias has:

- **Alias text** -- the alternative name
- **Language** -- optional language code (e.g., "it", "de", "en")

### Edit canonical entries

Update the canonical code or display name of an entry. For **doctors** and **facilities** the edit also syncs the `name` column (used by document lists, filter dropdowns, and the extractor's slug matching) and pushes the new display into any denormalized `documents.doctor_name` / `facility_name` cells, so the rename is visible everywhere.

If the new code collides with another entry's code you'll get a 409 with the message *"Another X already has code '…'. Use Merge to unify them instead of renaming."* That's almost always the right action: the two entries are duplicates, merge them.

### View linked documents

Click **Documents** on any row to list every document that references that entry, with patient, doc type, and date. If there are none, the modal offers a one-click **Delete** to clean up the orphan canonical.

### Delete entries

Click **Delete** on a row (or from the linked-documents modal) to permanently remove a canonical entry. References in every linked table (`documents`, `encounters`, `imaging_studies`, `medications`, `lab_results`, `doctors.facility_id`, …) are set to `NULL`; the linked documents themselves stay intact, they just lose this particular classification. Aliases are also removed.

### Merge entries

If two canonical entries represent the same concept, merge them. Three flows:

- **Per row.** Expand a row and click Merge (the Confirm action lives inside the same expanded row). Pick a target from the **fuzzy-searchable** dropdown, start typing part of the canonical display or code to filter. The dropdown also offers **+ Create new entry…**, selecting it reveals Name and Code inputs and the merge creates the new canonical row first, then folds the source into it.
- **Batch (multi-select).** Tick the checkboxes on several rows. A subdued bar appears above the table: *"N selected, Merge into: [target ▾], Merge, Clear"*. The target dropdown is fuzzy-searchable and includes the same **+ Create new entry…** option.
- **Auto-merge with AI.** Click **Auto-merge with AI** in the filter row. The current entries are run through a two-stage pipeline:
  1. **Knowledge-base resolution.** For lab tests / medications / diagnoses each entry's display + aliases are looked up against a bundled reference (LOINC / ATC / ICD-10). Entries that resolve to the same external code are grouped immediately as high-confidence proposals, no LLM call needed. The reason field reads e.g. *"Same ATC code (J01CA04)"*.
  2. **LLM fallback.** Any entries that didn't resolve (typos, unusual brand names, doctors / facilities / specialties, which have no public reference) are sent to the configured General LLM, which proposes additional groups with a short reason. Those come back marked for review.

  Proposals are rendered inline, you can change the target, uncheck individual sources, skip, or approve each group. Each carries a `source` (`knowledge_base` or `llm`) and `confidence` (`high` or `review`) so you can scan past the high-confidence ones quickly. Nothing is merged until you click **Apply merge**.

Every merge:

1. Moves the source's aliases onto the target
2. Copies the source's display name as a new alias on the target (so future extractions of the old name resolve to the merged target via the alias lookup in `_upsert_doctor` / `_upsert_facility`)
3. Updates every FK reference on linked tables
4. Refreshes any denormalized `doctor_name` / `facility_name` cells to the target's display
5. Logs a row in `extraction_corrections` for every affected document so the few-shot retriever surfaces the mapping on future extractions, the same learning signal produced when you rename a doctor from the document view
6. Deletes the source row

Batch merges run every step inside a single transaction.

## Reference data

Asclepius ships with two layers of bundled medical reference data:

### Seed data

Loaded into the database on first initialization from `config/seeds/`:

- Common lab tests (complete blood count, metabolic panels, lipid panels, etc.)
- Medical specialties
- Common diagnoses
- Common medications

These rows live in the normalization tables themselves and behave like any other entry, you can rename, alias, merge, or delete them. The seed only fires on an empty database; subsequent boots leave your data alone.

### Knowledge bases

A separate read-only side index used by the auto-merge feature, located at `bundled_config/knowledge/`:

| File | Codes | Source |
| --- | --- | --- |
| `medications.json` | ATC | Wikidata (CC0), ~3.7k drugs with multilingual brand and generic names |
| `diagnoses.json` | ICD-10 | Wikidata (CC0), ~600 chapter and 3-character codes with multilingual labels |
| `lab_tests.json` | LOINC | ~480 lab tests; English display names are the official LOINC `LONG_COMMON_NAME` field, multilingual aliases come from the LOINC Linguistic Variants (it/fr/de/es). LOINC is © Regenstrief Institute, Inc., see [`NOTICE`](https://github.com/giovi321/asclepius/blob/main/NOTICE) for the required attribution |

These files are **not** loaded into the database. They sit in memory and are consulted whenever auto-merge needs to know whether two name variants (e.g. *Amoxicillin* and *Zimox*) refer to the same underlying concept. Same code → deterministic merge; mismatch → the LLM never sees them in the same prompt and can't accidentally collapse them.

#### How the knowledge base feeds the merge

The knowledge files are **never sent to any LLM, in part or in whole**, they're not in the system prompt, the user prompt, or any context passed to the model. The data path is entirely in-process Python:

1. **Lazy load.** On the first auto-merge call for a given category, `knowledge_base.py` reads the relevant JSON file from disk once and builds a flat `dict[str, str]` mapping `normalized_alias → external_code` (~30k keys for medications, ~6k for diagnoses, ~3k for lab tests). The dict is cached at module scope; later calls reuse it. Per-process memory: a few MB.
2. **Normalization.** Each alias key is casefolded, has trailing dosage tokens stripped (`"Augmentin 500mg"` → `"augmentin"`), parenthetical content removed, and punctuation collapsed. The same normalization is applied to every entry name being looked up.
3. **Lookup.** For each canonical entry the user is reviewing, every alias and the canonical display are normalized and looked up in the dict (O(1) per name). The first hit wins; the entry is tagged with that external code. Entries that don't hit anything are unresolved.
4. **Group.** Resolved entries are bucketed by external code. Any bucket with two or more entries becomes a deterministic merge proposal (`source: "knowledge_base"`, `confidence: "high"`) with a reason like *"Same ATC code (J01CA04)"*. No LLM call has happened at this point.
5. **Residual to the LLM.** Only the **unresolved** entries are placed into the prompt sent to the configured General LLM. The prompt does not include the knowledge dictionary, the resolved entries, the external codes, or the matches found in step 3. If everything resolved, the LLM call is **skipped entirely**, you'll see no `gate.enter` log line for that auto-merge run.
6. **Merge.** Both proposal lists are returned to the UI. Nothing is written to the database until you approve.

So a `lab_tests` auto-merge call on a database where the knowledge base recognises every entry's name is a pure-Python computation that costs a single 550 KB file read and a few hundred dict lookups, with **zero token cost and zero outbound LLM traffic**. The LLM is reserved for the long tail of locally-named entries the public references can't decide.

The build scripts under `scripts/build_knowledge/` regenerate the JSON files from public Wikidata SPARQL with no third-party dependencies. For lab tests the script also reads an optional official LOINC overlay: register at https://loinc.org, drop `LoincTableCore.csv` at `scripts/build_knowledge/loinc.csv` and the per-language `LinguisticVariant` CSVs at `scripts/build_knowledge/loinc_{it,fr,de,es}.csv`, then re-run `build_lab_tests.py`. The script enriches existing entries, it doesn't expand the file with the long tail of ~109k LOINC codes that nobody references in real reports. Both inputs are gitignored so a registered LOINC distribution stays local to your machine.

A per-install override at `$ASCLEPIUS_CONFIG_PATH/../knowledge/{medications,diagnoses,lab_tests}.json` shadows the bundled copy, mirroring the seed-data precedence.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/normalization/{type}` | List canonical entries (type: `lab_tests`, `specialties`, `diagnoses`, `medications`, `doctors`, `facilities`) |
| `GET` | `/api/normalization/{type}/{id}` | Get a canonical entry with all its aliases |
| `PATCH` | `/api/normalization/{type}/{id}` | Update canonical code / display (409 on code collision) |
| `DELETE` | `/api/normalization/{type}/{id}` | Delete a canonical entry (nulls FKs on referencing tables) |
| `GET` | `/api/normalization/{type}/{id}/documents` | List documents that reference this entry |
| `POST` | `/api/normalization/{type}/{id}/aliases` | Add an alias |
| `DELETE` | `/api/normalization/{type}/aliases/{alias_id}` | Delete an alias |
| `POST` | `/api/normalization/{type}/{id}/confirm` | Mark every auto-mapped alias on this entry as reviewed |
| `POST` | `/api/normalization/{type}/merge` | Merge one source into a target |
| `POST` | `/api/normalization/{type}/merge-batch` | Merge many sources into an existing target **or** a newly-created one (`target_id` or `new_target: {canonical_code, canonical_display}`) |
| `POST` | `/api/normalization/{type}/auto-merge` | Ask the LLM for merge proposals; returns `{proposals, entries}` without executing anything |
