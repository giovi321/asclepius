# Vault Structure

The vault is the root directory for all stored files and the SQLite database. It is mounted as a Docker volume at `/vault` inside the container.

## Directory Layout

```
vault/
├── inbox/                              # Drop files here for processing
├── patients/
│   ├── giovanni-crapelli/
│   │   ├── 2024/
│   │   │   ├── 2024-03-15_ospedale-civico_bloodtest.pdf
│   │   │   ├── 2024-07-22_clinica-luganese_xray.pdf
│   │   │   └── imaging/
│   │   │       └── 2024-07-22_clinica-luganese_ct-abdomen/
│   │   │           ├── series-001/
│   │   │           │   ├── 00001.dcm
│   │   │           │   └── ...
│   │   │           └── series-002/
│   │   └── 2025/
│   │       └── 2025-01-10_dr-mueller_prescription.pdf
│   └── other-patient/
│       └── ...
├── unclassified/                       # Docs that couldn't be assigned to a patient
└── asclepius.sqlite                    # SQLite database
```

## File Naming Convention

Files are renamed during organization to:

```
{YYYY-MM-DD}_{provider-slug}_{doctype}.{ext}
```

- **Date** -- Document date as extracted by the LLM (`doc_date`)
- **Provider slug** -- Facility slug (preferred) or doctor slug, lowercase with hyphens
- **Doc type** -- One of the document type codes (e.g., `bloodtest`, `prescription`, `specialist_report`)

Examples:

- `2024-03-15_ospedale-civico_bloodtest.pdf`
- `2025-01-10_dr-mueller_prescription.pdf`
- `2024-11-20_university-hospital_discharge.pdf`

## Key Rules

1. **Files move once.** From `inbox/` to their final location in `patients/{slug}/{year}/`. After that, the path never changes.
2. **No manual reorganization.** Use the web UI to reassign documents to different patients. The server handles moving the file on disk.
3. **The database is the source of truth.** File paths are stored in `documents.file_path` relative to the vault root.
4. **Imaging files preserve DICOM structure.** Series folders contain the original `.dcm` files with their series instance UIDs.
5. **Unclassified documents** go to `vault/unclassified/` when the pipeline cannot determine the patient.

## Patient Slug

Each patient has a URL-safe slug derived from their display name:

- "Giovanni Crapelli" becomes `giovanni-crapelli`
- The slug is unique and used for the filesystem directory name

## File Deduplication

Files are deduplicated by SHA-256 hash (`documents.file_hash`). If a file with the same hash already exists in the database:

- During pipeline processing: the file is skipped and deleted from inbox
- During upload: the database INSERT is ignored (hash has a UNIQUE constraint)
