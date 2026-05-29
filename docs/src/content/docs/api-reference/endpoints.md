---
title: "API Endpoints"
---

All endpoints require authentication unless noted. Base prefix: `/api`

## Health check

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Returns `{"status": "ok", "mode": "core"\|"share"}`. Mounted in both run modes. The frontend reads `mode` on boot to decide whether to render the admin SPA tree or the share-only tree. |

## Setup (first launch)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/setup/status` | No | Returns `{"needs_setup": true/false}`, true when no users exist |
| `POST` | `/api/setup/complete` | No | Create first admin user + first patient (only works when no users exist) |

### Setup request

```json
{
  "username": "alex",
  "password": "your-password",
  "display_name": "Alex Smith",
  "patient_name": "Alex Smith",
  "patient_date_of_birth": "1990-01-15",
  "patient_sex": "M"
}
```

Only `username`, `password`, and `patient_name` are required. All other fields are optional. On success, a session cookie is set so the user is automatically logged in.

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | No | Login with username/password |
| `POST` | `/api/auth/logout` | Yes | Logout (clear session) |
| `GET` | `/api/auth/me` | Yes | Get current user with patient access |
| `GET` | `/api/auth/oidc/enabled` | No | Check if OIDC is enabled |
| `GET` | `/api/auth/oidc/login` | No | Initiate OIDC login flow |
| `GET` | `/api/auth/oidc/callback` | No | OIDC callback handler |

## Patients

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/patients` | Yes | List patients accessible to the current user |
| `POST` | `/api/patients` | Yes | Create a new patient |
| `GET` | `/api/patients/{id}` | Yes | Get patient details |
| `PATCH` | `/api/patients/{id}` | Yes | Update patient fields |
| `DELETE` | `/api/patients/{id}` | Yes | Delete a patient |

**Patient fields:** `display_name`, `date_of_birth`, `sex`, only fields that feed the LLM extraction context are stored.

## Documents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/documents` | Yes | List documents (filterable) |
| `POST` | `/api/documents/upload` | Yes | Upload a document file. Hashes the upload before insert; on a SHA-256 match, deletes the just-uploaded copy and returns `{filename, status: "duplicate", existing_document_id, existing_filename, existing_patient_id, message}` instead of inserting a duplicate row. |
| `GET` | `/api/documents/{id}` | Yes | Get document with all related data |
| `GET` | `/api/documents/{id}/file` | Yes | Download/serve the document file |
| `PATCH` | `/api/documents/{id}` | Yes | Update document metadata |
| `DELETE` | `/api/documents/{id}` | Yes | Delete document and file |
| `POST` | `/api/documents/{id}/move` | Yes | Reassign document to another patient |
| `POST` | `/api/documents/{id}/reprocess` | Yes | Re-run OCR and/or LLM extraction. Enqueues onto the same single-threaded pipeline worker as inbox uploads at priority 0, so the click jumps ahead of pending uploads but still serialises against any in-flight job. |
| `POST` | `/api/documents/{id}/translate` | Yes | Queue an on-demand English translation of the document body. Reuses cached `ocr_text` (does not re-run OCR), runs through the `translation_en` prompt, persists to `documents.ocr_text_en`. Body: `{llm_provider_id?: string}`. Enqueues a `translate` job at priority 0. |
| `POST` | `/api/documents/{id}/translate-region` | Yes | Queue OCR + translation of a user-selected rectangle on one PDF page. Pre-allocates a `region_translations` row (so the UI shows a placeholder card immediately) and enqueues a `translate_region` job. Body: `{page: int (1-based), bbox: {x, y, w, h} (normalized [0,1]), ocr_provider_id?: string, llm_provider_id?: string}`. Returns `{status: "queued", document_id, region_id}`. |
| `DELETE` | `/api/documents/{id}/region-translations/{region_id}` | Yes | Delete a region translation row and its thumbnail PNG from disk. |
| `GET` | `/api/documents/{id}/region-translations/{region_id}/thumbnail` | Yes | Serve the cropped PNG thumbnail for a region translation card. |
| `POST` | `/api/documents/{id}/cancel` | Yes | Cancel processing |
| `GET` | `/api/documents/{id}/stages` | Yes | Per-document pipeline stage timeline (every OCR / LLM / organize transition this doc has been through, across uploads and reprocesses). Backs the document detail page's run-grouped timeline. |
| `POST` | `/api/documents/{id}/edit-with-ai` | Yes | Edit metadata via natural language |
| `POST` | `/api/documents/{id}/generate-filename` | Yes | Get an AI-suggested `{suggested_filename}` (does not rename) |
| `POST` | `/api/documents/{id}/rename` | Yes | Rename on disk + DB; auto-disambiguates on collision (`-2`, `-3`, …) |
| `GET` | `/api/documents/{id}/find-candidates` | Yes | Walk the vault for files matching this document's ``original_filename``. Returns vault-relative paths. Used by the document detail page to recover from a broken ``file_path``. |
| `POST` | `/api/documents/{id}/relink` | Yes | Repoint a document at an existing vault file (``{"vault_path": "..."}``). Updates ``file_path`` + ``file_size``; does NOT re-run the pipeline. |
| `POST` | `/api/documents/{id}/replace-file` | Yes | Multipart upload of a replacement file. Lands in the document's organised folder (``patients/{slug}/{year}/...``), updates ``file_path``. Extension is locked to the original. Does NOT re-run the pipeline. |
| `POST` | `/api/documents/{id}/link` | Yes | Link to another document |
| `GET` | `/api/documents/{id}/links` | Yes | Get all document links |
| `DELETE` | `/api/documents/{id}/links/{link_id}` | Yes | Remove a document link |
| `POST` | `/api/documents/{id}/suggest-links` | Yes | AI-suggest related documents |

### Document list query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `patient_id` | int | Filter by patient |
| `type` | string | Filter by document type (comma-separated for multiple) |
| `date_from` | string | Earliest `event_date`, inclusive (YYYY-MM-DD) |
| `date_to` | string | Latest `event_date`, inclusive (YYYY-MM-DD) |
| `status` | string | Filter by status (comma-separated for multiple: pending, processing, done, failed, needs_review, cancelled) |
| `q` | string | Full-text search query |
| `specialty` | string | Filter by specialty (comma-separated for multiple) |
| `doctor_id` | string | Filter by doctor (comma-separated for multiple) |
| `facility_id` | string | Filter by facility (comma-separated for multiple) |
| `limit` | int | Results per page (default: 50) |
| `offset` | int | Pagination offset |

### Document update fields

`patient_id`, `doc_type`, `event_date`, `issued_date`, `doctor_id`, `doctor_name`, `facility_id`, `facility_name`, `specialty_original`, `summary_en`, `event_id`, `notes`, `tags`, `user_notes`, `original_filename`

`event_date` is the canonical timeline anchor (when the medical event happened); `issued_date` is the administrative date the document itself carries. Both accept `YYYY-MM-DD` strings or `null`.

`doctor_name` and `facility_name` are write-only convenience fields, they are not stored on the document, only on `doctors` / `facilities`. When a request sends a name without the matching `doctor_id` / `facility_id`, the PATCH runs the name through the alias-aware upsert and fills in the id automatically. A name that matches an existing slug or alias reuses that entry, anything else creates a new canonical row. Sending the name as `null` clears the foreign key.

### AI Edit request

```json
{
  "instruction": "Change the doctor to Dr. Mueller and set the date to 2024-03-15"
}
```

### Reprocess request

```json
{
  "mode": "both",
  "llm_provider_id": "claude-1",
  "ocr_provider_id": "tesseract-1",
  "vision_provider_id": null
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | `"both"` | `"ocr"` (OCR only), `"llm"` (LLM only), `"both"` (OCR+LLM), or `"vision_llm"` (single-step Vision-LLM flow) |
| `llm_provider_id` | string | null | Specific LLM provider ID (null = default highest-priority). Used when `mode` is `llm` or `both`. |
| `ocr_provider_id` | string | null | Specific OCR provider ID (null = default highest-priority). Used when `mode` is `ocr` or `both`. |
| `vision_provider_id` | string | null | Specific Vision-LLM provider ID (null = default highest-priority). Used when `mode` is `vision_llm`. |

### Stage timeline response

`GET /api/documents/{id}/stages` returns every persisted stage event for a document, oldest first:

```json
{
  "document_id": 42,
  "events": [
    {
      "id": 1,
      "stage": "ocr",
      "status": "completed",
      "job_kind": "upload",
      "message": null,
      "page_current": 49,
      "page_total": 49,
      "started_at": "2026-04-29T11:02:46",
      "finished_at": "2026-04-29T11:08:11"
    },
    {
      "id": 2,
      "stage": "llm_extraction",
      "status": "completed",
      "job_kind": "upload",
      "message": null,
      "page_current": null,
      "page_total": null,
      "started_at": "2026-04-29T11:08:11",
      "finished_at": "2026-04-29T11:09:02"
    }
  ]
}
```

Stage values: `ocr`, `vision_extraction`, `llm_extraction`, `page_classification`, `section_extraction`, `organizing`, `thumbnail`, `cache_ocr`, `translation`, `region_ocr`, `region_translation`. Status values: `started`, `completed`, `failed`, `skipped`, `cancelled`. `job_kind` is `upload`, `reprocess`, `translate`, or `translate_region`. `message` is populated on failures with the error string. `page_current` / `page_total` are populated on stages that work page-by-page.

### Document link types

`invoice_for`, `report_for`, `imaging_for`, `follow_up`, `related`

## Medical events

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/events` | Yes | List events (filterable by patient_id, event_type) |
| `GET` | `/api/events/{id}` | Yes | Get event with linked documents |
| `POST` | `/api/events` | Yes | Create a new event |
| `PATCH` | `/api/events/{id}` | Yes | Update event fields |
| `DELETE` | `/api/events/{id}` | Yes | Delete event (unlinks documents). Pass `?delete_documents=true` to also delete linked documents |
| `POST` | `/api/events/{id}/link` | Yes | Link a document to the event |
| `DELETE` | `/api/events/{id}/link/{doc_id}` | Yes | Unlink a document from the event |
| `POST` | `/api/events/suggest-for-document/{doc_id}` | Yes | AI-suggest event for a document |

### Event create/update fields

`patient_id`, `title`, `event_type`, `description`, `date_start`, `date_end`, `is_ongoing`, `severity`, `diagnosis_text`, `icd10_code`, `specialty_text`, `notes`, `color`

### Event types

`symptom`, `diagnosis`, `hospitalization`, `surgery`, `treatment`, `follow_up`, `emergency`, `pregnancy`, `chronic_condition`, `injury`, `screening`, `other`

## Lab results

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/lab-results` | Yes | List lab results. Each row carries `document_filename`, `document_doc_type`, `document_doc_date`, `document_missing`, and `canonical_code` via JOINs. |
| `GET` | `/api/lab-results/orphans` | Yes | Lab results whose `document_id` no longer points to an existing document. |
| `GET` | `/api/lab-results/timeline` | Yes | Time-series for a specific test (legacy, superseded by the in-page chart picker). |
| `POST` | `/api/lab-results` | Yes | Create a single lab result (add-by-hand). Requires `document_id` and `test_name_original`. |
| `PATCH` | `/api/lab-results/{id}` | Yes | Update editable fields (value, unit, reference range, test_date, …). Viewers are blocked. |
| `DELETE` | `/api/lab-results/{id}` | Yes | Delete a single lab result. |

### Lab results query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `patient_id` | int | Filter by patient |
| `test_name` | string | Search by test name |
| `date_from` | string | Filter by date |
| `date_to` | string | Filter by date |
| `limit` | int | Results per page (default: 500, max: 2000) |
| `offset` | int | Pagination offset |

## Imaging

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/imaging` | Yes | List imaging studies (filterable, paginated) |
| `GET` | `/api/imaging/{id}` | Yes | Get study with nested ``series`` + report fields |
| `GET` | `/api/imaging/{id}/series/{series_id}/frames` | Yes | List DICOM frames in a series |
| `GET` | `/api/imaging/{id}/series/{series_id}/frame/{index}` | Yes | Serve a frame as PNG (default) or raw DICOM. Accepts ``?wc=`` and ``?ww=`` for window-center / window-width override (used by the MR contrast sliders). |
| `GET` | `/api/imaging/{id}/bundle-files` | Yes | List auxiliary files extracted from the same zip (DICOMDIR, JPEG previews, etc.) |
| `GET` | `/api/imaging/{id}/bundle-file/{name}` | Yes | Download a single bundle file by name |
| `GET` | `/api/imaging/{id}/links` | Yes | Linked documents (uses ``document_links``) |
| `POST` | `/api/imaging/{id}/links` | Yes | Link an existing document to this study |
| `DELETE` | `/api/imaging/{id}/links/{link_id}` | Yes | Remove a study-document link |
| `POST` | `/api/imaging/{id}/report` | Yes | Attach a radiology report PDF to this study. Either pass ``?document_id=N`` (or JSON ``{"document_id": N}``) to link an existing PDF document, or post a multipart ``file=`` to upload a fresh PDF. PDF-only is enforced via libmagic. The placeholder document is replaced. |
| `PATCH` | `/api/imaging/{id}/metadata` | Yes | Update imaging-specific fields (``modality``, ``body_part``, ``study_description``, ``accession_number``). Each change is also recorded in ``extraction_corrections`` against the parent document so the LLM picks it up as a few-shot example. Doctor / facility / event_date / patient are NOT accepted here, those are edited via PATCH /api/documents/{id}. |

### Imaging query parameters (list endpoint)

| Parameter | Type | Description |
|-----------|------|-------------|
| `patient_id` | int | Filter by patient |
| `modality` | string | Filter by DICOM modality code (CT, MR, US, XR, MG, PT, …) |
| `report_status` | string | Filter by ``placeholder`` (no PDF report yet) or ``attached`` |
| `q` | string | Search across body part / study description / referring doctor / facility |
| `date_from` | string (ISO date) | Lower bound for ``study_date`` |
| `date_to` | string (ISO date) | Upper bound for ``study_date`` |
| `sort` | string | One of ``modality``, ``body_part``, ``study_date``, ``doctor``, ``facility``, ``patient``, ``report_status``, ``date_added`` |
| `order` | string | ``asc`` or ``desc`` (default ``desc``) |
| `limit` | int | Default 50, max 500 |
| `offset` | int | Pagination offset |

The list response shape mirrors `/api/documents`:
``{"items": [...], "total": N, "limit": L, "offset": O}``.

## Chat

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat` | Yes | Send a chat message (RAG) |
| `GET` | `/api/chat/history` | Yes | Get chat history |
| `DELETE` | `/api/chat/history` | Yes | Clear chat history |

### Chat request

```json
{
  "patient_id": 1,
  "message": "What were my last cholesterol results?"
}
```

## Normalization

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/normalization/{type}` | Yes | List canonical entries (`type`: `lab_tests`, `specialties`, `diagnoses`, `medications`, `doctors`, `facilities`) |
| `GET` | `/api/normalization/{type}/{id}` | Yes | Get canonical entry + aliases |
| `PATCH` | `/api/normalization/{type}/{id}` | Yes | Update canonical code / display (409 on code collision) |
| `DELETE` | `/api/normalization/{type}/{id}` | Yes | Delete canonical entry (nulls FKs on referencing tables) |
| `GET` | `/api/normalization/{type}/{id}/documents` | Yes | List documents that reference this entry |
| `POST` | `/api/normalization/{type}/{id}/aliases` | Yes | Add an alias |
| `DELETE` | `/api/normalization/{type}/aliases/{alias_id}` | Yes | Delete an alias |
| `POST` | `/api/normalization/{type}/{id}/confirm` | Yes | Mark every auto-mapped alias on this entry as reviewed |
| `POST` | `/api/normalization/{type}/merge` | Yes | Merge one source into a target |
| `POST` | `/api/normalization/{type}/merge-batch` | Yes | Merge many sources; body takes `target_id` **or** `new_target: {canonical_code, canonical_display}` to create the target inline |
| `POST` | `/api/normalization/{type}/auto-merge` | Yes | Propose merges; returns `{proposals, entries}` without executing anything. Each proposal carries `target_id`, `source_ids`, `reason`, plus `source` (`"knowledge_base"` for ATC/LOINC/ICD-10 same-code matches, `"llm"` for model proposals) and `confidence` (`"high"` or `"review"`) |

**Types:** `lab_tests`, `specialties`, `diagnoses`, `medications`, `doctors`, `facilities`

## Pipeline

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/pipeline/status` | Yes | Get pipeline processing status |
| `POST` | `/api/pipeline/start` | Admin | Start the processing pipeline |
| `POST` | `/api/pipeline/stop` | Admin | Stop the processing pipeline |

### Pipeline status response

```json
{
  "queue_depth": 2,
  "processing": "document.pdf",
  "processing_step": "llm_extraction",
  "processing_doc_id": 42,
  "processing_pages": 15,
  "processing_page_current": 7,
  "total_processed": 128,
  "total_errors": 3,
  "recent_errors": [],
  "queued_files": [{"filename": "next.pdf", "size": 1234567}],
  "current_job": {
    "doc_id": 42,
    "filename": "document.pdf",
    "kind": "reprocess",
    "stage": "llm_extraction",
    "page_current": null,
    "page_total": null,
    "stages_planned": ["ocr", "llm_extraction"],
    "stages_done": ["ocr"],
    "started_at": "2026-04-29T11:38:08"
  },
  "queued_jobs": [
    {"kind": "upload", "label": "next.pdf", "doc_id": null}
  ],
  "llm_queues": [],
  "watcher_active": true,
  "auto_stopped": false,
  "auto_stop_reason": ""
}
```

The `processing` / `processing_step` / `processing_pages` fields are kept populated for backward compatibility. New clients should read `current_job` (carries the job kind, the stage stepper data, and live page progress) and `queued_jobs` (mirrors the worker queue so the UI can show "Up next"). `kind` is `"upload"` for inbox files and `"reprocess"` for clicks from the document detail page. The flow architecture is implicit in `stages_planned`: a list containing `vision_extraction` is the Vision-LLM flow, otherwise it's the OCR + LLM flow.

## Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings` | Yes | Get all settings |
| `PATCH` | `/api/settings` | Yes | Update settings (persisted to YAML) |
| `GET` | `/api/settings/llm-providers` | Yes | List LLM providers |
| `PUT` | `/api/settings/llm-providers` | Yes | Update LLM providers |
| `GET` | `/api/settings/ocr-providers` | Yes | List OCR providers |
| `PUT` | `/api/settings/ocr-providers` | Yes | Update OCR providers |
| `GET` | `/api/settings/vision-providers` | Yes | List Vision-LLM providers |
| `PUT` | `/api/settings/vision-providers` | Yes | Update Vision-LLM providers |
| `GET` | `/api/settings/credentials` | Yes | List shared credentials (URL, API key, concurrency, retry policy) |
| `PUT` | `/api/settings/credentials` | Yes | Update shared credentials |
| `GET` | `/api/settings/general-llm` | Yes | Get the General-LLM config (chat, auto-merge, AI edit, event extraction, link suggestion) |
| `PUT` | `/api/settings/general-llm` | Yes | Update the General-LLM config |
| `POST` | `/api/settings/test-llm-provider` | Yes | Test an LLM provider connection |
| `POST` | `/api/settings/test-ocr-provider` | Yes | Test an OCR provider connection |
| `POST` | `/api/settings/test-vision-provider` | Yes | Test a Vision-LLM provider with a tiny image round-trip |
| `POST` | `/api/settings/smtp/test` | Admin | Send a fixed diagnostic email via current SMTP settings. Body: `{to: "you@example.com"}`. Returns `{"ok": true}` on success, 400 when SMTP is disabled, 502 with `detail: "SMTP test failed: <ExceptionClass>"` on transport failure. The raw SMTP response is **never** returned — only the underlying exception's class name surfaces, so attacker-controlled bytes echoed back by the server cannot pollute logs or UI. Writes `settings.smtp_test` to the audit log with `details.to_domain` (domain only — local-part redacted) and `details.ok`. |
| `GET` | `/api/settings/logs` | Admin | Recent log lines (tail) |
| `GET` | `/api/settings/audit-log` | Admin | Structured audit-log entries |
| `GET` | `/api/settings/sessions` | Admin | List active sessions across all users |
| `DELETE` | `/api/settings/sessions/{session_id}` | Admin | Revoke a session |

All three test endpoints accept the same request body:

```json
{ "provider_id": "claude-1" }                // test a persisted provider by id
{ "provider": { "id": "ollama-x", "type": "ollama", ... } }   // test an inline, possibly unsaved entry
```

The inline `provider` form is what the UI uses so the **Test Connection** button works with unsaved edits. Secret fields (`api_key`, `remote_api_key`, etc.) left blank are merged from the saved entry with the same `id` if one exists.

### Settings update fields

Sent to `PATCH /api/settings`. Any subset of these may be included in a single request.

**LLM:** `extraction_timeout`, `llm_max_concurrent_requests`, `llm_max_retries`, `llm_retry_backoff_seconds`, `canonical_language`

**OCR (legacy flat fields, kept for the auto-migration path):** `ocr_engine`, `ocr_language`, `ocr_confidence_threshold`, `cloud_ocr_enabled`, `ocr_remote_url`, `ocr_remote_api_key`, `llm_vision_provider`, `llm_vision_model`, `llm_vision_ollama_url`, `google_vision_key`

**Vision-LLM (legacy flat fields):** `vision_extraction_timeout`, `vision_max_concurrent_requests`, `vision_max_retries`, `vision_retry_backoff_seconds`. New deployments should leave these at defaults and rely on the per-credential values.

**Pipeline:** `pipeline_watch_enabled`, `pipeline_poll_interval`, `pipeline_retry_interval`, `pipeline_max_retries`, `pipeline_default_flow` (`"ocr_llm"` or `"vision_llm"`)

**Auth:** `session_ttl_hours`

**OIDC:** `oidc_enabled`, `oidc_provider_url`, `oidc_client_id`, `oidc_client_secret`, `oidc_scopes`, `oidc_auto_create_user`, `oidc_username_claim`, `oidc_display_name_claim`

**Backup:** `backup_enabled`, `backup_include_database`, `backup_include_vault`, `backup_schedule` (`hourly` / `daily` / `weekly`), `backup_retention_mode` (`count` / `days`), `backup_retention_value`

**SMTP:** `smtp_enabled`, `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `smtp_use_tls`, `smtp_use_starttls`, `smtp_from_address`, `smtp_from_name`, `smtp_timeout_seconds`. The password is write-only: the GET response carries `has_password: bool` instead of the actual value, and an empty `smtp_password` in a PATCH is treated as "do not touch" rather than "clear" (see `useSettingsSave` in the frontend; mirrors the OIDC client-secret pattern). Override the password via the `ASCLEPIUS_SMTP_PASSWORD` env var to keep it out of `settings.yaml` entirely.

**Share — email OTP knobs:** `share_email_otp_subject`, `share_email_otp_body`, `share_lockout_after_failed`, `share_email_otp_daily_cap`, `share_email_otp_resend_cooldown_seconds`. See [Doctor shares → Email template](../../admin-guide/doctor-shares/#email-template) and [Configuration knobs](../../admin-guide/doctor-shares/#configuration-knobs).

**Share — region-translation hardening:** `share_max_translation_chars` (default `50000`), `share_translation_max_expansion_ratio` (default `10.0`), `share_translation_audit_enabled` (default `true`). Bound the blast radius of a successful prompt-injection: oversized output is truncated, runaway-expansion output is rejected, and every completion writes a `translate_region_done` audit row with the OCR-input SHA-256 + length stats for admin spot-checking.

For the provider lists themselves (`llm.providers`, `ocr.providers`, `vision.providers`) and the shared credential list (`credentials[]`), use the dedicated `PUT /api/settings/{llm|ocr|vision}-providers` and `PUT /api/settings/credentials` endpoints, each accepts the full ordered array and replaces the existing list. Fields with empty `api_key` are preserved from the previous value, so you never need to re-enter secrets when reordering.

## Prompts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings/prompts` | Yes | List all prompts with current values |
| `PUT` | `/api/settings/prompts/{key}` | Yes | Update a prompt |
| `DELETE` | `/api/settings/prompts/{key}` | Yes | Reset prompt to default |

**Prompt keys:** `classification`, `vision_extraction`, `extraction_lab_test`, `extraction_specialist_report`, `extraction_prescription`, `extraction_invoice`, `extraction_discharge`, `extraction_imaging_report`, `extraction_surgical_report`, `extraction_vaccination`, `document_edit`, `sql_generation`, `chat_system`, `link_suggestion`, `page_classification`

## Backup

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings/backup` | Yes | Download SQLite backup file |

## Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings/users` | Yes | List all users |
| `POST` | `/api/settings/users` | Yes | Create a user |
| `PATCH` | `/api/settings/users/{id}` | Yes | Update user (display_name, password) |
| `DELETE` | `/api/settings/users/{id}` | Yes | Delete a user |
| `GET` | `/api/settings/users/{id}/access` | Yes | Get user's patient access |
| `POST` | `/api/settings/users/{id}/access` | Yes | Grant patient access |
| `DELETE` | `/api/settings/users/{id}/access/{patient_id}` | Yes | Revoke patient access |

## Doctor shares (admin)

Mounted under `/api/shares` (plural) in **core mode only** — the share
container serves a stripped surface and 404s every admin path. All
admin endpoints require admin OR patient-owner role; non-admins see
only shares for patients they own.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/shares` | Admin/owner | Create a share. Body: `{patient_id, document_ids[], recipient_label, recipient_contact, expires_in_days?, default_ocr_provider_id?, default_llm_provider_id?, otp_delivery?}`. `otp_delivery` is `"manual"` (default) or `"email"`. When `"email"`, the server requires SMTP to be enabled AND validates `recipient_contact` as an email — 400 on either failure. Response: `{share_id, share_url, expires_at}`. The `share_url` honors `share.public_base_url` (env: `ASCLEPIUS_SHARE_PUBLIC_URL`), so split-host setups hand the admin the doctor-facing URL. |
| `GET` | `/api/shares` | Yes | List shares the caller can manage. Optional `?patient_id=N` to scope. Each row includes `share_url` decorated the same way. |
| `DELETE` | `/api/shares/{share_id}` | Admin/owner | Revoke a share. Marks `revoked_at` and immediately invalidates every active doctor session for that share. Idempotent. |
| `GET` | `/api/shares/{share_id}/audit` | Admin/owner | Full audit trail for a share. With `?include_active_otp=true`, also returns the live OTP code. |
| `GET` | `/api/shares/{share_id}/active-otp` | Admin/owner | Just the live OTP (`{active_otp: {code, expires_at, attempts} \| null}`). Cheaper than `/audit?include_active_otp=true` when the dashboard only needs the code. **For email-delivery shares this always returns `{active_otp: null}`** — the plaintext code is never persisted, so the admin cannot read back what was emailed. |
| `GET` | `/api/shares/{share_id}/documents` | Admin/owner | Preview the documents in this share (same JOIN shape the doctor sees). |
| `GET` | `/api/shares/{share_id}/sessions` | Admin/owner | Active doctor session(s) and queued waiters. Response: `{active: [...], queued: [...]}`. Each active row carries an `is_idle` flag. The cookie-equivalent session.id is intentionally NOT exposed — the admin handle is SQLite `rowid` so an exfiltrated response cannot be replayed as an auth token. |
| `DELETE` | `/api/shares/{share_id}/sessions/{rowid}` | Admin/owner | Force-terminate a single active session. Idempotent. |
| `DELETE` | `/api/shares/{share_id}/queue/{rowid}` | Admin/owner | Drop a single queued waiter. Idempotent. |

### Audit actions

The audit log records these `action` strings:

- `otp_request` — fresh code issued to the doctor
- `otp_email_sent` — email-delivery OTP dispatched (`detail.to_masked` carries the first character of the local-part, e.g. `j***@example.com`)
- `otp_email_failed` — SMTP rejected the send (`detail.cause` carries the exception class name; the raw SMTP response is never logged)
- `otp_email_rate_limited` — request rejected by the per-share daily cap or the resend cooldown (`detail.reason` is `daily_cap`)
- `otp_verify_ok` / `otp_verify_fail` — OTP verification outcome
- `share.locked` — share auto-revoked after `share.share_lockout_after_failed` consecutive verify failures (`detail.reason` is `otp_brute_force_manual` or `otp_brute_force_email`; `detail.failures` carries the counter value at lockout)
- `translate_region_done` — region translation finished (worker-emitted). `detail` carries `{kind: "region", region_id, ocr_sha256, ocr_len, translated_len, llm_model, target_language, truncated, rejected?}`. The `rejected` field is `"ratio"` when the expansion-ratio guard fired. Disable with `share.translation_audit_enabled=false`.
- `view_doc` — doctor opened a document
- `view_file` — doctor fetched the watermarked PDF bytes
- `translate` — doctor queued a region or full-page translation
- `logout` / `session_expired` — session ended on the doctor's side
- `share.session.revoke` — admin force-killed an active session
- `share.queue.drop` — admin dropped a queued waiter
- `share.create` / `share.revoke` — admin created or revoked the share

## Doctor shares (public)

Mounted under `/api/share` (singular) in **both core and share modes**.
Authentication is by share-specific cookie, not the admin session
cookie — share auth and admin auth are entirely isolated.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/share/{token}/info` | Token | Returns `{delivery: "manual" \| "email"}` so the doctor's landing/verify pages can show the right copy ("we will email you a code" vs "your contact will tell you the code"). The recipient address is **never** returned — not even masked — so a leaked URL cannot expose the doctor's mailbox via this endpoint. For invalid or revoked tokens this returns the same shape as a valid manual share (`{"delivery": "manual"}`), so the only thing the endpoint reveals about token validity is whether it resolves to an *email* share. |
| `POST` | `/api/share/{token}/request-otp` | Token | Issue a fresh OTP for the share token. Returns 204 for a valid token (and for an invalid one — the body never reveals whether the token is valid, so an attacker cannot enumerate). For email-delivery shares this also dispatches the OTP via SMTP to the recipient stored on the share. Possible non-204 responses on email shares: 429 (per-IP cap / per-share resend cooldown / per-share daily cap), 502 (SMTP failed to deliver — the doctor's UI tells them to ask the practice for manual delivery). |
| `POST` | `/api/share/{token}/verify-otp` | Token + OTP | Body: `{code: "123456"}`. On success either sets the `asclepius_share` cookie and returns 200 `{status: "active"}`, or sets the `asclepius_share_queue` cookie and returns 202 `{status: "queued", queue_expires_at}` when another device already holds the slot. 401 on bad code; 429 when the per-IP rate limit fires. After `share.share_lockout_after_failed` consecutive failures on the same share (default 3) the share itself is revoked — subsequent verifies still return 401 (no token-validity leak), but the share is inert. |
| `POST` | `/api/share/claim` | Queue cookie | Polled by a queued waiter every 5s. Returns `{status: "active"}` (and sets the session cookie) when the slot freed up, `{status: "queued", queue_expires_at}` while still waiting, or 410 when the queue token expired or the share was revoked. |
| `DELETE` | `/api/share/queue` | Queue cookie | Explicit cancel from the waiting page. Drops the queue entry and clears the cookie. 204. |
| `POST` | `/api/share/heartbeat` | Session cookie | Keepalive — bumps `last_seen_at` so the idle clock resets while the doctor is reading. 204. |
| `POST` | `/api/share/logout` | Session cookie | Revoke the session and clear cookies. CSRF-exempt so `navigator.sendBeacon` works on tab close. 200. |

### Doctor read surface

Same `/api/share` prefix; requires a valid `asclepius_share` cookie.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/share/me` | Dashboard payload: patient name, document list, recipient label, session expiry, allowed translation languages, default language. |
| `GET` | `/api/share/documents/{doc_id}` | Document detail (same JOIN shape the admin sees, minus encounter notes which are deliberately hidden). |
| `GET` | `/api/share/documents/{doc_id}/file` | Watermarked PDF/image bytes. Fresh watermark on every request with the recipient's name + UTC timestamp. `Cache-Control: no-store`. |
| `POST` | `/api/share/documents/{doc_id}/translate-region` | Body: `{page, bbox: {x, y, w, h}, target_language?, ocr_provider_id?, llm_provider_id?}`. Pre-allocates a `region_translations` row, enqueues a `translate_region` job. Rate-limited per session (debounce) and per share (rolling-hour cap). |
| `POST` | `/api/share/documents/{doc_id}/translate` | Deprecated whole-document variant kept for the e2e test only; the doctor UI no longer exposes a button. |
| `GET` | `/api/share/documents/{doc_id}/region-translations/{region_id}/thumbnail` | Cropped PNG thumbnail of a region translation. |

## Vault file browser

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/vault/tree` | Yes | Get the vault directory tree (filtered by user scope) |
| `DELETE` | `/api/vault/file` | Yes | Delete a file on disk and its matching documents row |
| `POST` | `/api/vault/move` | Yes | Move a file or directory and atomically rewrite ``documents.file_path``, ``imaging_studies.folder_path``, and ``imaging_series.folder_path`` so the document reference stays intact. Used by the *Move* action in the file browser to fix files that landed in the wrong folder. |
