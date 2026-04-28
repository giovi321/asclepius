---
title: "Vault Structure"
---

The vault is the single root for every stored file and the SQLite database. It mounts as a Docker volume at `/vault` inside the container.

<div class="diagram-frame">
<svg viewBox="0 0 920 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vault structure" style="display:block;width:100%;height:auto;max-width:100%;">
  <defs>
    <pattern id="vs-dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.9" fill="rgba(28,25,23,0.10)"/>
    </pattern>
    <style>
      .vs-row      { font-family:'Geist Mono',monospace; font-size:12px; fill:#1c1917; }
      .vs-row-soft { font-family:'Geist Mono',monospace; font-size:12px; fill:#57534e; }
      .vs-anno     { font-family:'Geist Mono',monospace; font-size:9px;  fill:#78716c; }
      .vs-eyebrow  { font-family:'Geist Mono',monospace; font-size:8px;  letter-spacing:0.14em; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#efeee5"/>
  <rect width="100%" height="100%" fill="url(#vs-dots)" opacity="0.6"/>
  <!-- ===== Tree pane ===== -->
  <rect x="24" y="24" width="540" height="392" rx="8" fill="#faf7f2" stroke="rgba(28,25,23,0.12)" stroke-width="1"/>
  <rect x="40" y="40" width="92" height="16" rx="2" fill="transparent" stroke="rgba(28,25,23,0.30)" stroke-width="0.8"/>
  <text x="86" y="52" class="vs-eyebrow" fill="#57534e" text-anchor="middle">VAULT LAYOUT</text>
  <text x="40"  y="92"  class="vs-row" font-weight="600">vault/</text>
  <text x="40"  y="124" class="vs-row">├── inbox/</text>
  <text x="380" y="124" class="vs-anno">drop zone · watched</text>
  <text x="40"  y="152" class="vs-row-soft">│   └── {patient-slug | user-&lt;id&gt;}/</text>
  <text x="380" y="152" class="vs-anno">per-patient or per-user</text>
  <text x="40"  y="188" class="vs-row">├── patients/</text>
  <text x="380" y="188" class="vs-anno">organized records</text>
  <text x="40"  y="216" class="vs-row-soft">│   └── {slug}/{year}/{event}/</text>
  <text x="40"  y="244" class="vs-row-soft">│       ├── {date}_{provider}_{type}.pdf</text>
  <text x="40"  y="272" class="vs-row-soft">│       └── {study-folder}/series-N/*.dcm</text>
  <text x="40"  y="308" class="vs-row">├── unclassified/</text>
  <text x="380" y="308" class="vs-anno">no patient resolved</text>
  <text x="40"  y="336" class="vs-row-soft">│   └── user-&lt;id&gt;/</text>
  <text x="40"  y="372" class="vs-row" font-weight="600">└── asclepius.sqlite</text>
  <text x="380" y="372" class="vs-anno">SQLite · source of truth</text>
  <!-- ===== Focal card: File naming ===== -->
  <rect x="588" y="24" width="308" height="392" rx="8" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
  <rect x="604" y="40" width="96" height="16" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
  <text x="652" y="52" class="vs-eyebrow" fill="#8E4449" text-anchor="middle">FILE NAMING</text>
  <text x="604" y="100" font-family="'Geist Mono',monospace" font-size="12" font-weight="600" fill="#1c1917">{YYYYMMDD}_{provider}_{doctype}.{ext}</text>
  <line x1="604" y1="128" x2="880" y2="128" stroke="rgba(142,68,73,0.25)" stroke-width="0.8"/>
  <text x="604" y="160" font-family="'Geist Mono',monospace" font-size="12" font-weight="600" fill="#1c1917">YYYYMMDD</text>
  <text x="604" y="176" class="vs-anno">compact date, LLM-extracted</text>
  <text x="604" y="212" font-family="'Geist Mono',monospace" font-size="12" font-weight="600" fill="#1c1917">provider</text>
  <text x="604" y="228" class="vs-anno">facility slug (preferred) or doctor</text>
  <text x="604" y="264" font-family="'Geist Mono',monospace" font-size="12" font-weight="600" fill="#1c1917">doctype</text>
  <text x="604" y="280" class="vs-anno">bloodtest · prescription · discharge · …</text>
  <text x="604" y="316" font-family="'Geist Mono',monospace" font-size="12" font-weight="600" fill="#1c1917">ext</text>
  <text x="604" y="332" class="vs-anno">pdf · jpg · dcm (DICOM) · …</text>
  <line x1="604" y1="360" x2="880" y2="360" stroke="rgba(142,68,73,0.25)" stroke-width="0.8"/>
  <text x="604" y="388" font-family="'Geist',sans-serif" font-size="12" fill="#57534e">Same scheme on disk and in the UI.</text>
</svg>
</div>

## Directory Layout

```
vault/
├── inbox/
│   ├── alex-smith/                     # Per-patient when upload knows the patient
│   │   └── my-upload.pdf
│   ├── user-1/                         # Per-user fallback when no patient yet
│   │   └── unassigned-doc.pdf
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
│   │   │   └── 20240722_riverside-clinic_ct-abdomen/    # imaging study folder
│   │   │       ├── series-001/                          # peer of PDFs in {year}/
│   │   │       │   ├── 00001.dcm
│   │   │       │   └── ...
│   │   │       └── series-002/
│   │   ├── 2025/
│   │   │   └── 20250110_dr-jones_prescription.pdf
│   │   └── imaging-bundles/                              # auxiliary imaging files
│   │       └── exam-AA387249Z07/                         # one folder per zip upload
│   │           ├── DICOMDIR
│   │           ├── image_s0001_i0001.jpg                 # JPEG previews
│   │           └── LOCKFILE
│   └── jordan-lee/
│       └── ...
├── unclassified/
│   ├── user-1/                         # Per-user unclassified bucket
│   │   └── 20240501_invoice.pdf
│   └── user-2/
└── asclepius.sqlite                    # SQLite database
```

`inbox/` is split into per-upload sub-folders so each upload has its own
isolated dropzone. When the upload form names a patient (the common
case) the sub-folder is the patient slug — e.g. ``inbox/alex-smith/`` —
so a shell-level `ls inbox/` reads as a human roster. When there's no
patient yet the sub-folder falls back to ``user-<id>/``. Uploads via
`POST /api/documents/upload` write a ``.user_hint`` sidecar so the
pipeline can stamp `uploaded_by_user_id` regardless of the folder
naming. The file watcher is recursive, so existing files and new
drops in any sub-folder are picked up; empty inbox folders are swept
after every successful pipeline tick. Legacy files at the flat
`inbox/<name>` or `unclassified/<name>` paths continue to work and
are admin-only. `unclassified/` keeps the `user-<id>/` per-user split
so each user's unassigned queue stays isolated.

Documents assigned to a medical event are organized into an event subfolder within the year. Documents without an event remain directly in the year folder.

Imaging studies are filed as **peers of regular document files** under
the year folder — the study folder (e.g.
`20240722_riverside-clinic_ct-abdomen/`) takes the place a single PDF
would, with `series-N/` subfolders for the DICOM frames. Auxiliary
files extracted from the same zip upload (DICOMDIR, JPEG previews,
LOCKFILE, VERSION) live at the **patient-level** under
`imaging-bundles/{zip-stem}/` and are surfaced via
`GET /api/imaging/{id}/bundle-files`. The file browser hides
`imaging-bundles/` when navigating inside a patient directory so the
year folders stay tidy.

## File Naming Convention

Files are renamed during organization to:

```
{YYYYMMDD}_{provider-slug}_{doctype}.{ext}
```

- **Date.** Compact date format (e.g., `20251231`) as extracted by the LLM.
- **Provider slug.** Facility slug (preferred) or doctor slug, lowercase with hyphens.
- **Doc type.** One of the document type codes (e.g., `bloodtest`, `prescription`, `specialist_report`).

Examples:

- `20240315_city-clinic_bloodtest.pdf`
- `20250110_dr-jones_prescription.pdf`
- `20241120_university-hospital_discharge.pdf`

## Key Rules

1. **Files move once on ingest.** From `inbox/{patient-slug | user-<id>}/` to their final spot in `patients/{slug}/{year}/`. After that, the path doesn't change unless the user moves it via the file browser.
2. **The file browser can move files.** The `Move` action on each row calls `POST /api/vault/move`, which renames the file on disk **and** rewrites the matching `documents.file_path`, `imaging_studies.folder_path`, and `imaging_series.folder_path` rows in lockstep so the document reference stays intact. Use it to fix files that landed in the wrong date / event folder.
3. **The database is the source of truth.** Paths in `documents.file_path` are relative to the vault root. Imaging studies use `imaging_studies.folder_path` for the study folder; the parent `documents.file_path` points at the radiology report PDF (or is empty when the study has only a placeholder report).
4. **Imaging files keep their DICOM structure.** Series folders contain the original `.dcm` files with their series instance UIDs. Files extracted from a zip with no DICOM extension are auto-renamed to `.dcm` after the DICM preamble at byte 128 is verified.
5. **Unclassified documents** land in `vault/unclassified/user-<id>/` when the pipeline can't figure out the patient. Legacy rows without `uploaded_by_user_id` fall back to the flat `unclassified/` directory and stay admin-only.
6. **Per-user scope.** Non-admin users see only their own patients and their own `inbox/` and `unclassified/` subfolders in the file browser and document lists. Admins see everything.
7. **One imaging study, one document.** A 35-frame ultrasound creates one `documents` row (the radiology report PDF, or a placeholder until one is attached) and one `imaging_studies` row, not 35 of each. The DICOM frames are on disk under the study folder; only the report has a `documents.file_path`.

## Patient Slug

Each patient has a URL-safe slug derived from their display name:

- "Alex Smith" becomes `alex-smith`
- The slug is globally unique (used for the filesystem directory name and joins). When two users independently create a patient with the same display name, the second gets an auto-disambiguated slug (`alex-smith`, then `alex-smith-2`, etc.). `display_name` is allowed to repeat across users — the slug is an internal handle, not something the UI surfaces for editing.

## File Deduplication

Files are deduplicated by SHA-256 hash (`documents.file_hash`). If a file with the same hash already exists in the database:

- During pipeline processing: the file is skipped and deleted from inbox
- During upload: the database INSERT is ignored (hash has a UNIQUE constraint)
