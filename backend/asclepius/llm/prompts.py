"""LLM prompt templates for document extraction and chat.

The prompt bodies themselves live as YAML files under ``prompts_data/``.
This module loads them once at import time and exposes:

* Module-level constants matching the legacy names (``CLASSIFICATION_PROMPT``,
  ``EXTRACTION_PROMPT``, ``TYPE_EXTRACTION_PROMPTS``, …) so existing callers
  don't need to change.
* Two Python helpers (``canonical_language_directive``,
  ``chunk_context_preamble``) that stay as code because they compute text
  from runtime inputs.
* ``DB_SCHEMA_FOR_CHAT``, a static string constant shown to the LLM for SQL
  generation — kept inline because it mirrors the schema defined in
  ``db/schema.sql`` and belongs next to the code.

Per-prompt YAMLs optionally support a ``locales:`` map for future
translations; today every prompt ships only the ``default`` body.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts_data"


def _load_prompt_file(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


@lru_cache(maxsize=1)
def _load_all() -> dict[str, dict]:
    """Read every YAML under ``prompts_data/`` into a {key: payload} map."""
    out: dict[str, dict] = {}
    for path in sorted(PROMPTS_DIR.glob("*.yaml")):
        out[path.stem] = _load_prompt_file(path)
    return out


def prompt_body(key: str, locale: str | None = None) -> str:
    """Return the prompt body for ``key``, honouring an optional locale
    override (``locales: { en: "...", it: "..." }`` inside the YAML).
    """
    payload = _load_all().get(key)
    if not payload:
        return ""
    if locale:
        locales = payload.get("locales") or {}
        text = locales.get(locale)
        if text:
            return text
    return payload.get("default", "") or ""


def prompt_description(key: str) -> str:
    payload = _load_all().get(key) or {}
    return payload.get("description", "")


# ── Legacy module-level constants (back-compat) ─────────────────────

CLASSIFICATION_PROMPT: str = prompt_body("classification")
VISION_EXTRACTION_PROMPT: str = prompt_body("vision_extraction")
DOCUMENT_EDIT_PROMPT: str = prompt_body("document_edit")
SQL_GENERATION_PROMPT: str = prompt_body("sql_generation")
CHAT_SYSTEM_PROMPT: str = prompt_body("chat_system")
FILENAME_GENERATION_PROMPT: str = prompt_body("filename_generation")
LINK_SUGGESTION_PROMPT: str = prompt_body("link_suggestion")
PAGE_CLASSIFICATION_PROMPT: str = prompt_body("page_classification")
EXTRACTION_PROMPT_LEGACY: str = prompt_body("extraction_legacy")
EXTRACTION_PROMPT: str = EXTRACTION_PROMPT_LEGACY


def _build_type_extraction_map() -> dict[str, str]:
    out: dict[str, str] = {}
    for key, payload in _load_all().items():
        if not key.startswith("extraction_"):
            continue
        doc_type = key.removeprefix("extraction_")
        if doc_type == "legacy":
            continue
        out[doc_type] = payload.get("default", "") or ""
    return out


TYPE_EXTRACTION_PROMPTS: dict[str, str] = _build_type_extraction_map()


# ── Helpers that stay as code ───────────────────────────────────────

def canonical_language_directive(language: str | None) -> str:
    """Prefix directive that forces the LLM to emit free-form text fields in
    the configured canonical language.
    """
    if not language:
        language = "English"
    return (
        f"CRITICAL LANGUAGE DIRECTIVE: Write every free-form text field in the "
        f"JSON output (summaries, canonical names, findings, notes, descriptions, "
        f"translations, etc.) in {language}. Keep codes (ISO 4217, ICD-10, LOINC, "
        f"canonical_code values drawn from the provided mappings, language_detected) "
        f"untouched. Field keys and the JSON schema must remain as specified.\n\n"
    )


def chunk_context_preamble(
    chunk_index: int,
    total_chunks: int,
    page_start: int,
    page_end: int,
    total_pages: int,
    overlaps_previous: bool,
) -> str:
    """Prefix for the extraction prompt when a document is processed in chunks.

    Tells the LLM which page range it is looking at, warns that the first
    page may have been part of the previous chunk (because we overlap by a
    full page to keep tables straddling a page boundary intact), and asks
    it not to fabricate continuation rows at the chunk edges.
    """
    overlap_note = (
        f"\n- The first page in this chunk (page {page_start}) was ALSO the last page of the "
        f"previous chunk; you may see rows you've already extracted. Extract them anyway — "
        f"the caller deduplicates by row identity (e.g. test_name_original)."
        if overlaps_previous
        else ""
    )
    return (
        f"CHUNK CONTEXT: This is chunk {chunk_index} of {total_chunks}, covering pages "
        f"{page_start}-{page_end} of {total_pages}.{overlap_note}\n"
        f"- If a row appears cut off at the very top or very bottom of the chunk and you "
        f"cannot see the full row, SKIP it. Do not fabricate missing fields.\n\n"
    )


# ── Static schema snippet fed to the SQL-generation prompt ──────────

DB_SCHEMA_FOR_CHAT = """
Tables:
- documents(id, patient_id, file_path, original_filename, doc_type, event_date, issued_date, doctor_id, facility_id, date_received, summary_en, summary_original, norm_specialty_id, specialty_original, insurance_company, insurance_policy, notes, tags, ocr_text, raw_extraction, status)
- patients(id, slug, display_name, date_of_birth, sex)
- facilities(id, name, slug, type, address, city, country, phone, email, website)
- doctors(id, name, slug, title, norm_specialty_id, specialty_original, facility_id, phone, email)
- document_links(id, source_document_id, target_document_id, link_type)
- lab_results(id, document_id, patient_id, test_name_original, norm_lab_test_id, value, value_text, unit, reference_range_low, reference_range_high, is_abnormal, sample_type, panel_name, test_date)
- encounters(id, document_id, patient_id, doctor_id, facility_id, encounter_date, admission_date, discharge_date, diagnosis_original, diagnosis_code, notes, findings, follow_up_date, follow_up_instructions)
- medications(id, document_id, patient_id, brand_name, active_ingredient_original, dosage, form, frequency, duration, quantity, prescribed_date)
- vaccinations(id, document_id, patient_id, vaccine_name, manufacturer, lot_number, dose_number, date_administered)
- imaging_studies(id, document_id, patient_id, doctor_id, facility_id, study_date, modality, body_part, study_description, institution_name)
- norm_lab_tests(id, canonical_code, canonical_display, loinc_code, category, unit_preferred)
- norm_lab_test_aliases(id, norm_lab_test_id, alias, language)
- norm_diagnoses(id, canonical_code, canonical_display, icd10_code)
- norm_medications(id, canonical_code, canonical_display, atc_code)
"""
