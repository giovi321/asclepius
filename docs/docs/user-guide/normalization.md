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

Asclepius normalizes four categories of medical data:

| Category | Canonical Table | Alias Table | Standard Code |
|----------|----------------|-------------|---------------|
| Lab Tests | `norm_lab_tests` | `norm_lab_test_aliases` | LOINC |
| Specialties | `norm_specialties` | `norm_specialty_aliases` | -- |
| Diagnoses | `norm_diagnoses` | `norm_diagnosis_aliases` | ICD-10 |
| Medications | `norm_medications` | `norm_medication_aliases` | ATC |

Each canonical entry has:

- **Canonical code** -- a unique identifier (e.g., `HEMOGLOBIN`, `CARDIOLOGY`)
- **Canonical display name** -- human-readable name in English
- **Standard code** (where applicable) -- LOINC, ICD-10, or ATC code
- **Aliases** -- multiple alternative names in different languages

## How Normalization Works

1. During LLM extraction, the pipeline receives a raw name (e.g., "Emoglobina")
2. The system searches the alias tables for a matching entry (case-insensitive)
3. If found, the canonical ID is linked to the record
4. If not found, the LLM may auto-create a new alias mapping

### Auto-Mapped Aliases

When the LLM encounters a name it hasn't seen before, it can automatically create a new alias. These auto-mapped aliases have `auto_mapped = 1` in the database, distinguishing them from manually curated aliases.

## Managing Normalization Data

From **Settings** > **Normalization**, you can:

### View Canonical Entries

Browse all canonical entries for each category with their alias counts.

### Add Aliases

Add new aliases to map additional name variations to existing canonical entries. Each alias has:

- **Alias text** -- the alternative name
- **Language** -- optional language code (e.g., "it", "de", "en")

### Edit Canonical Entries

Update the canonical code or display name of an entry.

### Merge Entries

If two canonical entries represent the same concept, merge them:

1. Select a **source** entry (will be removed)
2. Select a **target** entry (will absorb the source)
3. All aliases and references from the source are transferred to the target

## Seed Data

Asclepius ships with seed data for common medical terms across multiple languages. The seed data is loaded on first database initialization and covers:

- Common lab tests (complete blood count, metabolic panels, lipid panels, etc.)
- Medical specialties
- Common diagnoses
- Common medications

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/normalization/{type}` | List canonical entries (type: lab_tests, specialties, diagnoses, medications) |
| `POST` | `/api/normalization/{type}` | Create a new canonical entry |
| `PATCH` | `/api/normalization/{type}/{id}` | Update a canonical entry |
| `DELETE` | `/api/normalization/{type}/{id}` | Delete a canonical entry |
| `POST` | `/api/normalization/{type}/{id}/aliases` | Add an alias |
| `DELETE` | `/api/normalization/{type}/aliases/{alias_id}` | Delete an alias |
| `POST` | `/api/normalization/{type}/merge` | Merge two canonical entries |
