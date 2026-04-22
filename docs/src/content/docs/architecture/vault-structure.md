---
title: "Vault Structure"
---

The vault is the single root for every stored file and the SQLite database. It mounts as a Docker volume at `/vault` inside the container.

<div class="diagram-frame">
<svg viewBox="0 0 920 480" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vault structure tree" style="display:block;width:100%;height:auto;max-width:100%;">
    <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.9" fill="rgba(28,25,23,0.10)"/>
      </pattern>
      <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#8E4449"/>
      </marker>
      <style>
        .row { font-family:'Geist Mono', monospace; font-size:12px; fill:#1c1917; }
        .row-soft { font-family:'Geist Mono', monospace; font-size:12px; fill:#57534e; }
        .anno { font-family:'Geist Mono', monospace; font-size:10px; fill:#78716c; letter-spacing:0.04em; }
        .pill { font-family:'Geist Mono', monospace; font-size:8px; letter-spacing:0.14em; }
      </style>
    </defs>
    <rect width="100%" height="100%" fill="#efeee5"/>
    <rect width="100%" height="100%" fill="url(#dots)" opacity="0.6"/>
    <!-- ===== Tree pane (left half) ===== -->
    <rect x="40" y="40" width="500" height="400" rx="8" fill="#faf7f2" stroke="rgba(28,25,23,0.12)" stroke-width="1"/>
    <!-- Tree connectors — drawn first -->
    <line x1="62" y1="78" x2="62" y2="404" stroke="rgba(28,25,23,0.20)" stroke-width="1"/>
    <line x1="62" y1="106" x2="80" y2="106" stroke="rgba(28,25,23,0.20)" stroke-width="1"/>
    <line x1="62" y1="160" x2="80" y2="160" stroke="rgba(28,25,23,0.20)" stroke-width="1"/>
    <line x1="62" y1="350" x2="80" y2="350" stroke="rgba(28,25,23,0.20)" stroke-width="1"/>
    <line x1="62" y1="404" x2="80" y2="404" stroke="rgba(28,25,23,0.20)" stroke-width="1"/>
    <!-- Inbox sub-tree -->
    <line x1="100" y1="120" x2="100" y2="134" stroke="rgba(28,25,23,0.18)" stroke-width="0.8"/>
    <line x1="100" y1="134" x2="118" y2="134" stroke="rgba(28,25,23,0.18)" stroke-width="0.8"/>
    <!-- Patients sub-tree -->
    <line x1="100" y1="174" x2="100" y2="320" stroke="rgba(28,25,23,0.18)" stroke-width="0.8"/>
    <line x1="100" y1="188" x2="118" y2="188" stroke="rgba(28,25,23,0.18)" stroke-width="0.8"/>
    <line x1="138" y1="202" x2="138" y2="298" stroke="rgba(28,25,23,0.16)" stroke-width="0.8"/>
    <line x1="138" y1="216" x2="156" y2="216" stroke="rgba(28,25,23,0.16)" stroke-width="0.8"/>
    <line x1="176" y1="230" x2="176" y2="270" stroke="rgba(28,25,23,0.14)" stroke-width="0.8"/>
    <line x1="176" y1="244" x2="194" y2="244" stroke="rgba(28,25,23,0.14)" stroke-width="0.8"/>
    <line x1="176" y1="270" x2="194" y2="270" stroke="rgba(28,25,23,0.14)" stroke-width="0.8"/>
    <line x1="138" y1="298" x2="156" y2="298" stroke="rgba(28,25,23,0.16)" stroke-width="0.8"/>
    <!-- Unclassified sub-tree -->
    <line x1="100" y1="364" x2="100" y2="378" stroke="rgba(28,25,23,0.18)" stroke-width="0.8"/>
    <line x1="100" y1="378" x2="118" y2="378" stroke="rgba(28,25,23,0.18)" stroke-width="0.8"/>
    <!-- ===== Tree text (rows) ===== -->
    <text x="68" y="78" class="row" font-weight="600" fill="#8E4449">vault/</text>
    <text x="84" y="110" class="row" font-weight="600">inbox/</text>
    <text x="190" y="110" class="anno">drop zone, watched</text>
    <text x="124" y="138" class="row-soft">user-&lt;id&gt;/</text>
    <text x="220" y="138" class="anno">per-user dropzone</text>
    <text x="84" y="164" class="row" font-weight="600" fill="#8E4449">patients/</text>
    <text x="200" y="164" class="anno" fill="#8E4449">organized records</text>
    <text x="124" y="192" class="row-soft">{patient-slug}/</text>
    <text x="162" y="220" class="row-soft">{year}/</text>
    <text x="200" y="248" class="row-soft">{event-slug}/</text>
    <text x="200" y="274" class="row-soft">{YYYYMMDD}_{provider}_{doctype}.pdf</text>
    <text x="162" y="302" class="row-soft">imaging/{study}/series-NNN/*.dcm</text>
    <text x="84" y="354" class="row" font-weight="600">unclassified/</text>
    <text x="220" y="354" class="anno">no patient resolved</text>
    <text x="124" y="382" class="row-soft">user-&lt;id&gt;/</text>
    <text x="84" y="408" class="row" font-weight="600">asclepius.sqlite</text>
    <text x="220" y="408" class="anno">SQLite DB</text>
    <!-- ===== Right pane: rules + flow ===== -->
    <!-- Pipeline-moves arrow (between panes) -->
    <path d="M 360 134 C 470 134, 470 192, 360 192" fill="none" stroke="#8E4449" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#arrow-accent)"/>
    <rect x="392" y="155" width="76" height="14" rx="2" fill="#efeee5"/>
    <text x="430" y="166" class="pill" fill="#8E4449" text-anchor="middle">PIPELINE MOVES ONCE</text>
    <!-- Rules card -->
    <rect x="568" y="40" width="312" height="200" rx="8" fill="#ffffff" stroke="rgba(28,25,23,0.20)" stroke-width="1"/>
    <rect x="582" y="56" width="68" height="14" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="616" y="66" class="pill" fill="rgba(28,25,23,0.8)" text-anchor="middle">RULES</text>
    <text x="582" y="98" font-family="'Geist',sans-serif" font-size="11" font-weight="600" fill="#1c1917">Files move exactly once</text>
    <text x="582" y="114" class="anno">inbox/ → patients/{slug}/{year}/</text>
    <text x="582" y="142" font-family="'Geist',sans-serif" font-size="11" font-weight="600" fill="#1c1917">DB is the source of truth</text>
    <text x="582" y="158" class="anno">documents.file_path is relative to vault root</text>
    <text x="582" y="186" font-family="'Geist',sans-serif" font-size="11" font-weight="600" fill="#1c1917">Per-user scope</text>
    <text x="582" y="202" class="anno">non-admins see their own patients</text>
    <text x="582" y="216" class="anno">+ their own inbox/ and unclassified/ subfolders</text>
    <!-- Naming convention card -->
    <rect x="568" y="260" width="312" height="180" rx="8" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <rect x="582" y="276" width="92" height="14" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
    <text x="628" y="286" class="pill" fill="#8E4449" text-anchor="middle">FILE NAMING</text>
    <text x="582" y="316" font-family="'Geist Mono',monospace" font-size="13" font-weight="600" fill="#1c1917">{YYYYMMDD}_{provider}_{doctype}.{ext}</text>
    <text x="582" y="344" class="anno">date     compact, as extracted by the LLM</text>
    <text x="582" y="362" class="anno">provider facility slug (preferred) or doctor slug</text>
    <text x="582" y="380" class="anno">doctype  bloodtest · prescription · discharge · …</text>
    <text x="582" y="412" font-family="'Geist',sans-serif" font-size="13" fill="#57534e">Same scheme on disk and in the UI download.</text>
  </svg>
</div>

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

- **Date.** Compact date format (e.g., `20251231`) as extracted by the LLM.
- **Provider slug.** Facility slug (preferred) or doctor slug, lowercase with hyphens.
- **Doc type.** One of the document type codes (e.g., `bloodtest`, `prescription`, `specialist_report`).

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
