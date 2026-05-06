---
title: "Lab Results"
---

## Overview

The Lab Results page shows all extracted lab values for the selected patient. Values are automatically pulled from documents classified as `lab_test` during pipeline processing, sorted by test date (newest first).

## Layout

### Orphan banner

If any lab result references a document that has been deleted, a yellow banner appears at the top of the page offering **Review** (lists the orphans in a modal with per-row delete) and **Delete all** (removes them all after a confirmation). Same UX as the "no documents → offer delete" flow in the normalization tab.

### Filter row

- **Search by test name**, matches both the original extracted name and the canonical display.
- **Group by test date**, collapsible groups keyed by `(test_date, source document)` so all the results of a single blood-test event stay together. On by default.

### Trend chart

Above the table sits a collapsible **test picker** listing every canonical test present in the current result set with its row count. Expand it and type to **fuzzy-search** a test by canonical display or original name. Click one or more tests to reveal a line chart plotting the values over time, one series per selected test. A reference band is drawn from the mode of the first series' reference ranges. The picker stays collapsed by default so the table isn't pushed down until you need the chart.

Each point on the chart is dated by the lab result's `test_date` when present, if a row has no extracted test date, the chart **falls back to the source document's `doc_date`** so a row with only a document-level date still appears in the trend instead of being dropped.

### Results table

Columns:

- **Document**, file icon + filename, linked to the source document page. Shows *"no document"* if the row is orphaned.
- **Test**, canonical display name (falling back to the original).
- **Value**, numeric or text; abnormal rows are tinted red.
- **Unit** / **Reference** / **Date**, as extracted.
- **Actions**, inline **Edit** turns the row into input fields (test name, value, unit, reference low/high, test date). **Delete** removes the row after a confirmation; the source document is untouched.

### OGTT curve

When a group of results on the same document contains at least three parseable glucose time-offset readings, the group's collapsed view renders an OGTT badge and, once expanded, a recharts line chart plotting glucose concentration over minutes from the glucose load. The parser recognizes:

- `T0`, `T+30`, `T-60`, `T 120`
- `30'`, `60′`, `90'`
- `30 min`, `60 minutes`, `2 h`, `2 hour`
- `basal`, `fasting`, `pre` (all treated as T0)

A glucose keyword must appear in the same test name so a random `T90 HbA1c` row doesn't trigger the curve. WHO/ADA two-hour thresholds (140 mg/dL impaired glucose tolerance, 200 mg/dL diabetes) are drawn as dashed reference lines when the unit is mg/dL.

## Normalization

Lab test names are normalized to canonical forms using the normalization system, so the same test is recognized regardless of language or naming convention:

- "Hämoglobin" (German), "Haemoglobin" (British English), "Hemoglobin" (American English) all map to the canonical `HEMOGLOBIN`

See [Normalization](../user-guide/normalization/) for managing canonical names and aliases.

## Data model

Each lab result record contains:

| Field | Description |
|-------|-------------|
| `document_id` | FK to the source document (NULL if that document has since been deleted, listed as "orphan") |
| `patient_id` | Denormalized patient ownership |
| `test_name_original` | Test name as written in the document |
| `norm_lab_test_id` | Link to the canonical lab test |
| `value` | Numeric value (if applicable) |
| `value_text` | Text value (for non-numeric results) |
| `unit` | Unit of measurement |
| `reference_range_low` | Lower bound of normal range |
| `reference_range_high` | Upper bound of normal range |
| `is_abnormal` | Whether the value is outside the reference range |
| `sample_type` | Type of sample (blood, urine, etc.) |
| `panel_name` | Name of the test panel (e.g., "Complete Blood Count") |
| `test_date` | Date the test was performed. Populated at extraction from the parent document's best date (`date_visit` → `date_issued` → `doc_date`), or the per-row date if the LLM emitted one. Kept in sync both ways: editing any of the document's date fields cascades the new best date to every lab row on that document; editing a single row's `test_date` updates the document's `doc_date` but leaves sibling rows alone. |

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/lab-results` | List lab results. Enriches each row with `document_filename`, `document_doc_type`, `document_doc_date`, `document_missing`, and `canonical_code`. Scoped to accessible patients; default limit 500, max 2000. |
| `GET` | `/api/lab-results/orphans` | Lab results whose `document_id` no longer points to an existing document. |
| `GET` | `/api/lab-results/timeline` | Time-series for a single test, historical endpoint used by the old trend view. |
| `POST` | `/api/lab-results` | Add a row by hand. Requires `document_id` and `test_name_original`; other fields optional. |
| `PATCH` | `/api/lab-results/{id}` | Update editable fields. Viewers are blocked. |
| `DELETE` | `/api/lab-results/{id}` | Delete a single row. |
