# API Endpoints

All endpoints require authentication unless noted. Base prefix: `/api`

## Health Check

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Returns `{"status": "ok"}` |

## Setup (First Launch)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/setup/status` | No | Returns `{"needs_setup": true/false}` — true when no users exist |
| `POST` | `/api/setup/complete` | No | Create first admin user + first patient (only works when no users exist) |

### Setup Request

```json
{
  "username": "giovanni",
  "password": "your-password",
  "display_name": "Giovanni Crapelli",
  "patient_name": "Giovanni Crapelli",
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

**Patient fields:** `display_name`, `date_of_birth`, `sex` — only fields that feed the LLM extraction context are stored.

## Documents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/documents` | Yes | List documents (filterable) |
| `POST` | `/api/documents/upload` | Yes | Upload a document file |
| `GET` | `/api/documents/{id}` | Yes | Get document with all related data |
| `GET` | `/api/documents/{id}/file` | Yes | Download/serve the document file |
| `PATCH` | `/api/documents/{id}` | Yes | Update document metadata |
| `DELETE` | `/api/documents/{id}` | Yes | Delete document and file |
| `POST` | `/api/documents/{id}/move` | Yes | Reassign document to another patient |
| `POST` | `/api/documents/{id}/reprocess` | Yes | Re-run OCR and/or LLM extraction |
| `POST` | `/api/documents/{id}/cancel` | Yes | Cancel processing |
| `POST` | `/api/documents/{id}/edit-with-ai` | Yes | Edit metadata via natural language |
| `POST` | `/api/documents/{id}/generate-filename` | Yes | Get an AI-suggested `{suggested_filename}` (does not rename) |
| `POST` | `/api/documents/{id}/rename` | Yes | Rename on disk + DB; auto-disambiguates on collision (`-2`, `-3`, …) |
| `POST` | `/api/documents/{id}/link` | Yes | Link to another document |
| `GET` | `/api/documents/{id}/links` | Yes | Get all document links |
| `DELETE` | `/api/documents/{id}/links/{link_id}` | Yes | Remove a document link |
| `POST` | `/api/documents/{id}/suggest-links` | Yes | AI-suggest related documents |

### Document List Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `patient_id` | int | Filter by patient |
| `type` | string | Filter by document type (comma-separated for multiple) |
| `date_from` | string | Filter by date (YYYY-MM-DD) |
| `date_to` | string | Filter by date (YYYY-MM-DD) |
| `status` | string | Filter by status (comma-separated for multiple: pending, processing, done, failed, needs_review, cancelled) |
| `q` | string | Full-text search query |
| `specialty` | string | Filter by specialty (comma-separated for multiple) |
| `doctor_id` | string | Filter by doctor (comma-separated for multiple) |
| `facility_id` | string | Filter by facility (comma-separated for multiple) |
| `limit` | int | Results per page (default: 50) |
| `offset` | int | Pagination offset |

### Document Update Fields

`patient_id`, `doc_type`, `doc_date`, `date_issued`, `date_visit`, `doctor_id`, `doctor_name`, `facility_id`, `facility_name`, `specialty_original`, `summary_en`, `event_id`, `notes`, `tags`, `user_notes`, `original_filename`

When a request sends `doctor_name` or `facility_name` without the matching `doctor_id` / `facility_id`, the PATCH runs the name through the alias-aware upsert and fills in the id automatically — a name that matches an existing slug or alias reuses that entry, anything else creates a new canonical row. Sending the name as `null` clears both the text and the id.

### AI Edit Request

```json
{
  "instruction": "Change the doctor to Dr. Bianchi and set the date to 2024-03-15"
}
```

### Reprocess Request

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

### Document Link Types

`invoice_for`, `report_for`, `imaging_for`, `follow_up`, `related`

## Medical Events

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

### Event Create/Update Fields

`patient_id`, `title`, `event_type`, `description`, `date_start`, `date_end`, `is_ongoing`, `severity`, `diagnosis_text`, `icd10_code`, `specialty_text`, `notes`, `color`

### Event Types

`symptom`, `diagnosis`, `hospitalization`, `surgery`, `treatment`, `follow_up`, `emergency`, `pregnancy`, `chronic_condition`, `injury`, `screening`, `other`

## Lab Results

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/lab-results` | Yes | List lab results. Each row carries `document_filename`, `document_doc_type`, `document_doc_date`, `document_missing`, and `canonical_code` via JOINs. |
| `GET` | `/api/lab-results/orphans` | Yes | Lab results whose `document_id` no longer points to an existing document. |
| `GET` | `/api/lab-results/timeline` | Yes | Time-series for a specific test (legacy — superseded by the in-page chart picker). |
| `PATCH` | `/api/lab-results/{id}` | Yes | Update editable fields (value, unit, reference range, test_date, …). Viewers are blocked. |
| `DELETE` | `/api/lab-results/{id}` | Yes | Delete a single lab result. |

### Lab Results Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `patient_id` | int | Filter by patient |
| `test_name` | string | Search by test name |
| `date_from` | string | Filter by date |
| `date_to` | string | Filter by date |
| `limit` | int | Results per page (default: 100, max: 500) |
| `offset` | int | Pagination offset |

## Imaging

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/imaging` | Yes | List imaging studies (filterable) |
| `GET` | `/api/imaging/{id}` | Yes | Get study with series |
| `GET` | `/api/imaging/{id}/series/{series_id}/frames` | Yes | List DICOM frames in a series |
| `GET` | `/api/imaging/{id}/series/{series_id}/frames/{frame}` | Yes | Serve a DICOM frame image |

### Imaging Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `patient_id` | int | Filter by patient |
| `modality` | string | Filter by modality (CT, MRI, XR, etc.) |
| `date_from` | string | Filter by date |
| `date_to` | string | Filter by date |

## Chat

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat` | Yes | Send a chat message (RAG) |
| `GET` | `/api/chat/history` | Yes | Get chat history |
| `DELETE` | `/api/chat/history` | Yes | Clear chat history |

### Chat Request

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
| `POST` | `/api/normalization/{type}/auto-merge` | Yes | Ask the LLM for merge proposals; returns `{proposals, entries}` without executing anything |

**Types:** `lab_tests`, `specialties`, `diagnoses`, `medications`, `doctors`, `facilities`

## Pipeline

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/pipeline/status` | Yes | Get pipeline processing status |
| `POST` | `/api/pipeline/start` | Admin | Start the processing pipeline |
| `POST` | `/api/pipeline/stop` | Admin | Stop the processing pipeline |

### Pipeline Status Response

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
  "watcher_active": true,
  "auto_stopped": false,
  "auto_stop_reason": ""
}
```

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
| `POST` | `/api/settings/test-llm-provider` | Yes | Test an LLM provider connection |
| `POST` | `/api/settings/test-ocr-provider` | Yes | Test an OCR provider connection |
| `POST` | `/api/settings/test-vision-provider` | Yes | Test a Vision-LLM provider with a tiny image round-trip |

All three test endpoints accept the same request body:

```json
{ "provider_id": "claude-1" }                // test a persisted provider by id
{ "provider": { "id": "ollama-x", "type": "ollama", ... } }   // test an inline, possibly unsaved entry
```

The inline `provider` form is what the UI uses so the **Test Connection** button works with unsaved edits. Secret fields (`api_key`, `remote_api_key`, etc.) left blank are merged from the saved entry with the same `id` if one exists.

### Settings Update Fields

Sent to `PATCH /api/settings`. Any subset of these may be included in a single request.

**LLM:** `extraction_timeout`, `llm_max_concurrent_requests`, `llm_max_retries`, `llm_retry_backoff_seconds`, `canonical_language`

**OCR (legacy flat fields — kept for the auto-migration path):** `ocr_engine`, `ocr_language`, `ocr_confidence_threshold`, `cloud_ocr_enabled`, `ocr_remote_url`, `ocr_remote_api_key`, `llm_vision_provider`, `llm_vision_model`, `llm_vision_ollama_url`, `google_vision_key`

**Vision-LLM:** `vision_extraction_timeout`, `vision_max_concurrent_requests`, `vision_max_retries`, `vision_retry_backoff_seconds`

**Pipeline:** `pipeline_watch_enabled`, `pipeline_poll_interval`, `pipeline_retry_interval`, `pipeline_max_retries`, `pipeline_default_flow` (`"ocr_llm"` or `"vision_llm"`)

**Auth:** `session_ttl_hours`

**OIDC:** `oidc_enabled`, `oidc_provider_url`, `oidc_client_id`, `oidc_client_secret`, `oidc_scopes`, `oidc_auto_create_user`, `oidc_username_claim`, `oidc_display_name_claim`

For the provider lists themselves (`llm.providers`, `ocr.providers`, `vision.providers`), use the dedicated `PUT /api/settings/{type}-providers` endpoints — each accepts the full ordered array and replaces the existing list. Fields with empty `api_key` are preserved from the previous value, so you never need to re-enter secrets when reordering.

## Prompts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings/prompts` | Yes | List all prompts with current values |
| `PUT` | `/api/settings/prompts/{key}` | Yes | Update a prompt |
| `DELETE` | `/api/settings/prompts/{key}` | Yes | Reset prompt to default |

**Prompt keys:** `classification`, `vision_extraction`, `extraction_bloodtest`, `extraction_specialist_report`, `extraction_prescription`, `extraction_invoice`, `extraction_discharge`, `extraction_radiology`, `extraction_vaccination`, `document_edit`, `sql_generation`, `chat_system`, `link_suggestion`, `page_classification`

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
