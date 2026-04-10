# Vault Structure

The vault is the root directory for all stored files and the SQLite database.

```
vault/
├── inbox/                              # Drop files here
├── patients/
│   ├── giovanni-crapelli/
│   │   ├── 2024/
│   │   │   ├── 2024-03-15_drhouse_bloodtest.pdf
│   │   │   ├── 2024-07-22_hospital_xray.pdf
│   │   │   └── imaging/
│   │   │       └── 2024-07-22_hospital_ct-abdomen/
│   │   │           ├── series-001/
│   │   │           │   ├── 00001.dcm
│   │   │           │   └── ...
│   │   │           └── series-002/
│   │   └── 2025/
│   │       └── 2025-01-10_drmueller_prescription.pdf
│   └── other-patient/
│       └── ...
├── unclassified/                       # Docs that couldn't be assigned
└── asclepius.sqlite                          # SQLite database
```

## File Naming Convention

`{YYYY-MM-DD}_{provider-slug}_{doctype}.{ext}`

- **Date:** Document date as extracted by the LLM
- **Provider slug:** Lowercase, hyphens, no spaces
- **Doc type:** One of the document type codes (e.g., `bloodtest`, `prescription`)

## Key Rules

1. **Files move once.** From `inbox/` to their final location. After that, the path never changes.
2. **No manual reorganization.** Use the web UI to reassign documents. The server handles the move.
3. **The database is the source of truth.** File paths are stored in `documents.file_path` relative to vault root.
4. **Imaging files preserve DICOM structure.** Series folders contain the original `.dcm` files.
