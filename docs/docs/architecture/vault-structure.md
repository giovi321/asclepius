# Vault Structure

The vault is the single root for every stored file and the SQLite database. It mounts as a Docker volume at `/vault` inside the container.

<iframe src="../../assets/diagrams/vault-structure.html" width="100%" height="640" style="border:0;border-radius:8px;" title="Vault layout"></iframe>

## Directory Layout

```
vault/
├── inbox/
│   ├── user-1/                         # Per-user dropzones
│   │   └── my-upload.pdf
│   └── user-2/
├── patients/
│   ├── alex-smith/
│   │   ├── 2023/
│   │   │   ├── sleep-apnea-treatment/              # Medical event folder
│   │   │   │   ├── 20231017_st-marys-hospital_surgical-report.pdf
│   │   │   │   ├── 20231031_st-marys-hospital_specialist-report.pdf
│   │   │   │   └── 20231115_st-marys-hospital_invoice.pdf
│   │   │   └── 20230315_city-clinic_bloodtest.pdf  # No event
│   │   ├── 2024/
│   │   │   ├── knee-injury/
│   │   │   │   ├── 20240722_riverside-clinic_radiology-report.pdf
│   │   │   │   └── 20240801_riverside-clinic_specialist-report.pdf
│   │   │   └── imaging/
│   │   │       └── 20240722_riverside-clinic_ct-abdomen/
│   │   │           ├── series-001/
│   │   │           │   ├── 00001.dcm
│   │   │           │   └── ...
│   │   │           └── series-002/
│   │   └── 2025/
│   │       └── 20250110_dr-jones_prescription.pdf
│   └── jordan-lee/
│       └── ...
├── unclassified/
│   ├── user-1/                         # Per-user unclassified bucket
│   │   └── 20240501_invoice.pdf
│   └── user-2/
└── asclepius.sqlite                    # SQLite database
```

`inbox/` and `unclassified/` are split into `user-<id>/` subfolders so each user has their own isolated dropzone. Uploads via `POST /api/documents/upload` land in the caller's subfolder automatically, and documents with no assigned patient are organized under the uploader's subfolder. The file watcher is recursive, so existing files and new drops in any `user-*/` subfolder are picked up. Legacy files still at the flat `inbox/<name>` or `unclassified/<name>` paths continue to work and are visible only to admins.

Documents assigned to a medical event are organized into an event subfolder within the year. Documents without an event remain directly in the year folder.

## File Naming Convention

Files are renamed during organization to:

```
{YYYYMMDD}_{provider-slug}_{doctype}.{ext}
```

- **Date** -- Compact date format (e.g., `20251231`) as extracted by the LLM
- **Provider slug** -- Facility slug (preferred) or doctor slug, lowercase with hyphens
- **Doc type** -- One of the document type codes (e.g., `bloodtest`, `prescription`, `specialist_report`)

Examples:

- `20240315_city-clinic_bloodtest.pdf`
- `20250110_dr-jones_prescription.pdf`
- `20241120_university-hospital_discharge.pdf`

## Key Rules

1. **Files move once.** From `inbox/user-<id>/` to their final spot in `patients/{slug}/{year}/`. After that, the path doesn't change.
2. **No manual reorganization.** Reassign documents through the web UI; the server takes care of moving the file on disk.
3. **The database is the source of truth.** Paths in `documents.file_path` are relative to the vault root.
4. **Imaging files keep their DICOM structure.** Series folders contain the original `.dcm` files with their series instance UIDs.
5. **Unclassified documents** land in `vault/unclassified/user-<id>/` when the pipeline can't figure out the patient. Legacy rows without `uploaded_by_user_id` fall back to the flat `unclassified/` directory and stay admin-only.
6. **Per-user scope.** Non-admin users see only their own patients and their own `inbox/` and `unclassified/` subfolders in the file browser and document lists. Admins see everything.

## Patient Slug

Each patient has a URL-safe slug derived from their display name:

- "Alex Smith" becomes `alex-smith`
- The slug is globally unique (used for the filesystem directory name and joins). When two users independently create a patient with the same display name, the second gets an auto-disambiguated slug (`alex-smith`, then `alex-smith-2`, etc.). `display_name` is allowed to repeat across users — the slug is an internal handle, not something the UI surfaces for editing.

## File Deduplication

Files are deduplicated by SHA-256 hash (`documents.file_hash`). If a file with the same hash already exists in the database:

- During pipeline processing: the file is skipped and deleted from inbox
- During upload: the database INSERT is ignored (hash has a UNIQUE constraint)
