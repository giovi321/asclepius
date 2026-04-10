# Lab Results

## Overview

The Lab Results page shows all extracted lab values for the selected patient, with:

- Color-coded abnormal flags (red background for abnormal values)
- Filter by test name
- Date range filtering
- Panel grouping

## Trend View

Click any test name to see its values over time. This shows:

- Historical values in chronological order
- Reference ranges for context
- Abnormal flag indicators

## How Lab Results Are Extracted

1. The LLM identifies lab test entries in the OCR text
2. Each test is matched against the normalization table (by name or alias)
3. Values, units, and reference ranges are parsed
4. Abnormal flags are set based on reference ranges
5. If the test name is new, a normalization entry is auto-created

## Normalization

Lab test names are normalized across languages. For example, "Emoglobina" (Italian), "Hämoglobin" (German), and "Hemoglobin" (English) all map to the canonical code `hemoglobin`. This enables trend tracking across documents from different providers and languages.

See [Normalization](normalization.md) for managing these mappings.
