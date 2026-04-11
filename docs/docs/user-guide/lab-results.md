# Lab Results

## Overview

The Lab Results page shows all extracted lab values for the selected patient. Lab results are automatically extracted from documents classified as `bloodtest` during pipeline processing.

## Features

### Lab Results Table

The main view shows all lab results with:

- **Test name** (original and normalized canonical name)
- **Value** (numeric or text)
- **Unit** of measurement
- **Reference range** (low and high)
- **Abnormal flag** (highlighted when the value is outside the reference range)
- **Test date**
- **Source document** (click to view the original document)

### Filtering

Filter lab results by:

- **Test name** -- search across both original and canonical names
- **Date range** -- from/to date
- **Patient** -- automatically filtered when a patient is selected in the sidebar

### Trend View

Click on any test name to see a trend chart showing how values have changed over time. The chart displays:

- Historical values plotted on a timeline
- Reference range shown as a shaded band
- Abnormal values highlighted

This is particularly useful for tracking values like cholesterol, blood glucose, or hemoglobin over multiple tests.

## Normalization

Lab test names are normalized to canonical forms using the normalization system. This ensures that the same test is recognized regardless of language or naming convention:

- "Emoglobina" (Italian), "Haemoglobin" (British English), "Hemoglobin" (American English) all map to the canonical `HEMOGLOBIN`
- Normalization happens automatically during extraction using the alias tables

See [Normalization](normalization.md) for details on managing canonical names and aliases.

## Data Model

Each lab result record contains:

| Field | Description |
|-------|-------------|
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
| `test_date` | Date the test was performed |
