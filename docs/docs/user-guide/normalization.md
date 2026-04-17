# Normalization

## Why Normalization?

Medical documents use different names for the same concept depending on language, provider, and region:

- "Hemoglobin", "Haemoglobin", "Emoglobina", "Haemoglobin (Hb)" are all the same lab test
- "Cardiology", "Kardiologie", "Cardiologia" are the same specialty
- "Ibuprofen", "Brufen", "Advil" refer to the same medication

Normalization maps these variations to a single canonical form, enabling:

- Accurate trend tracking across lab results from different labs
- Consistent filtering by specialty or diagnosis
- Cross-language search and reporting

## Normalization Categories

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

### Doctors & Facilities

Doctors and facilities use the same normalization system as medical concepts. The existing `doctors` and `facilities` tables have been extended with `canonical_code` and `canonical_display` columns, and new alias tables (`doctor_aliases`, `facility_aliases`) enable the same alias management, merge, and review workflows.

This is useful because the same doctor may appear under different name variations across documents (e.g., "Dr. M. Bianchi" vs. "Dr. Marco Bianchi"). Merging these entries consolidates all document references to a single record.

## How Normalization Works

1. During LLM extraction, the pipeline receives a raw name (e.g., "Emoglobina")
2. The system searches the alias tables for a matching entry (case-insensitive)
3. If found, the canonical ID is linked to the record
4. If not found, the LLM may auto-create a new alias mapping

### Auto-Mapped Aliases

When the LLM encounters a name it hasn't seen before, it can automatically create a new alias. These auto-mapped aliases have `auto_mapped = 1` in the database, distinguishing them from manually curated aliases — the row displays an `auto` badge and contributes to the entry's "unreviewed" count.

A self-alias whose text matches the canonical display name exactly (case- and whitespace-insensitive) is auto-confirmed on insert because there's no normalization decision to audit — it's just the canonical form echoed back. A one-shot migration clears the `auto_mapped` flag on any existing self-alias of that kind.

## Managing Normalization Data

From **Settings** > **Normalization**, you can:

### View Canonical Entries

Browse all canonical entries for each category with their alias counts. The entry's `canonical_code` and `canonical_display` are both shown; long values truncate with a tooltip so rows stay on one line.

### Add Aliases

Add new aliases to map additional name variations to existing canonical entries. Each alias has:

- **Alias text** -- the alternative name
- **Language** -- optional language code (e.g., "it", "de", "en")

### Edit Canonical Entries

Update the canonical code or display name of an entry. For **doctors** and **facilities** the edit also syncs the `name` column (used by document lists, filter dropdowns, and the extractor's slug matching) and pushes the new display into any denormalized `documents.doctor_name` / `facility_name` cells, so the rename is visible everywhere.

If the new code collides with another entry's code you'll get a 409 with the message *"Another X already has code '…'. Use Merge to unify them instead of renaming."* That's almost always the right action: the two entries are duplicates, merge them.

### View Linked Documents

Click **Documents** on any row to list every document that references that entry — with patient, doc type, and date. If there are none, the modal offers a one-click **Delete** to clean up the orphan canonical.

### Delete Entries

Click **Delete** on a row (or from the linked-documents modal) to permanently remove a canonical entry. References in every linked table (`documents`, `encounters`, `imaging_studies`, `medications`, `lab_results`, `doctors.facility_id`, …) are set to `NULL`; the linked documents themselves stay intact, they just lose this particular classification. Aliases are also removed.

### Merge Entries

If two canonical entries represent the same concept, merge them. Three flows:

- **Per row.** Expand a row, click Merge, pick a target from the dropdown. The dropdown also offers **+ Create new entry…** — selecting it reveals Name and Code inputs and the merge creates the new canonical row first, then folds the source into it.
- **Batch (multi-select).** Tick the checkboxes on several rows. A subdued bar appears above the table: *"N selected — Merge into: [target ▾] — Merge — Clear"*. The target dropdown includes the same **+ Create new entry…** option.
- **Auto-merge with AI.** Click **Auto-merge with AI** in the filter row. The current entries (with aliases) are sent to the configured LLM, which proposes groups of likely duplicates with a short reason for each. Proposals are rendered inline — you can change the target, uncheck individual sources, skip, or approve each group. Nothing is merged until you click **Apply merge**.

Every merge:

1. Moves the source's aliases onto the target
2. Copies the source's display name as a new alias on the target (so future extractions of the old name resolve to the merged target via the alias lookup in `_upsert_doctor` / `_upsert_facility`)
3. Updates every FK reference on linked tables
4. Refreshes any denormalized `doctor_name` / `facility_name` cells to the target's display
5. Logs a row in `extraction_corrections` for every affected document so the few-shot retriever surfaces the mapping on future extractions — the same learning signal produced when you rename a doctor from the document view
6. Deletes the source row

Batch merges run every step inside a single transaction.

## Seed Data

Asclepius ships with seed data for common medical terms across multiple languages. The seed data is loaded on first database initialization and covers:

- Common lab tests (complete blood count, metabolic panels, lipid panels, etc.)
- Medical specialties
- Common diagnoses
- Common medications

## API Endpoints

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
