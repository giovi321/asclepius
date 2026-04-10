# Normalization

## Why Normalization?

Medical documents use different names for the same concept depending on language, provider, and region:

- **Hemoglobin** (English) = **Emoglobina** (Italian) = **Hämoglobin** (German)
- **Ibuprofen** (generic) = **Brufen** (Italian brand) = **Advil** (US brand)
- **Cardiology** (English) = **Cardiologia** (Italian) = **Kardiologie** (German)

The normalization system maps these aliases to a single canonical code, enabling consistent querying and trend tracking.

## How It Works

1. The LLM extraction prompt includes all known mappings as context
2. When the LLM recognizes a term from the mappings, it uses the canonical code
3. New terms are auto-mapped with `auto_mapped: true`
4. You can review and correct auto-mapped terms in the Settings > Normalization tab

## Normalization Categories

| Category | Canonical Table | Example |
|----------|----------------|---------|
| Lab Tests | `norm_lab_tests` | `hemoglobin`, `total_cholesterol` |
| Specialties | `norm_specialties` | `cardiology`, `orthopedics` |
| Diagnoses | `norm_diagnoses` | `essential_hypertension`, `type_2_diabetes` |
| Medications | `norm_medications` | `atorvastatin`, `metformin` |

## Managing Normalizations

In **Settings > Normalization**:

- **Browse** canonical terms and their aliases
- **Filter** by unreviewed (auto-mapped) entries
- **Add aliases** for terms in new languages
- **Edit** canonical codes and display names
- **Merge** duplicate entries (moves all aliases and data references)
- **Confirm** auto-mapped aliases to mark them as reviewed

## Seed Data

Asclepius ships with seed data for common terms in English, Italian, and German:

- 30 common lab tests (CBC, metabolic panel, thyroid, lipids, etc.)
- 12 common diagnoses (hypertension, diabetes, depression, etc.)
- 12 common medications (statins, antihypertensives, analgesics, etc.)
- 19 medical specialties

Seed files are in `config/seeds/` (JSON format). You can edit them before first run.
