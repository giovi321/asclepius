# API Endpoints

All endpoints require authentication unless noted. Base prefix: `/api`

## Health Check

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Returns `{"status": "ok"}` |

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

**Patient fields:** `display_name`, `date_of_birth`, `sex`, `blood_type`, `allergies`, `notes`, `phone`, `email`, `address`, `insurance_company`, `insurance_number`

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
| `POST` | `/api/documents/{id}/reprocess` | Yes | Re-run LLM extraction |
| `POST` | `/api/documents/{id}/cancel` | Yes | Cancel processing |
| `POST` | `/api/documents/{id}/edit-with-ai` | Yes | Edit metadata via natural language |
| `POST` | `/api/documents/{id}/link` | Yes | Link to another document |
| `GET` | `/api/documents/{id}/links` | Yes | Get all document links |
| `DELETE` | `/api/documents/{id}/links/{link_id}` | Yes | Remove a document link |
| `POST` | `/api/documents/{id}/suggest-links` | Yes | AI-suggest related documents |

### Document List Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `patient_id` | int | Filter by patient |
| `type` | string | Filter by document type |
| `date_from` | string | Filter by date (YYYY-MM-DD) |
| `date_to` | string | Filter by date (YYYY-MM-DD) |
| `status` | string | Filter by status (pending, processing, done, failed, needs_review, cancelled) |
| `q` | string | Full-text search query |
| `specialty` | string | Filter by specialty |
| `doctor_id` | int | Filter by doctor |
| `facility_id` | int | Filter by facility |
| `limit` | int | Results per page (default: 50) |
| `offset` | int | Pagination offset |

### Document Update Fields

`patient_id`, `doc_type`, `doc_date`, `date_issued`, `date_visit`, `doctor_id`, `doctor_name`, `facility_id`, `facility_name`, `specialty_original`, `summary_en`, `event_id`, `notes`, `tags`

### AI Edit Request

```json
{
  "instruction": "Change the doctor to Dr. Bianchi and set the date to 2024-03-15"
}
```

### Document Link Types

`invoice_for`, `report_for`, `imaging_for`, `follow_up`, `related`

## Medical Events

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/events` | Yes | List events (filterable by patient_id, event_type) |
| `GET` | `/api/events/{id}` | Yes | Get event with linked documents |
| `POST` | `/api/events` | Yes | Create a new event |
| `PATCH` | `/api/events/{id}` | Yes | Update event fields |
| `DELETE` | `/api/events/{id}` | Yes | Delete event (unlinks documents) |
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
| `GET` | `/api/lab-results` | Yes | List lab results (filterable) |
| `GET` | `/api/lab-results/trends` | Yes | Get trend data for a specific test |

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
| `GET` | `/api/normalization/{type}` | Yes | List canonical entries |
| `POST` | `/api/normalization/{type}` | Yes | Create canonical entry |
| `PATCH` | `/api/normalization/{type}/{id}` | Yes | Update canonical entry |
| `DELETE` | `/api/normalization/{type}/{id}` | Yes | Delete canonical entry |
| `POST` | `/api/normalization/{type}/{id}/aliases` | Yes | Add an alias |
| `DELETE` | `/api/normalization/{type}/aliases/{alias_id}` | Yes | Delete an alias |
| `POST` | `/api/normalization/{type}/merge` | Yes | Merge two entries |

**Types:** `lab_tests`, `specialties`, `diagnoses`, `medications`

## Pipeline

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/pipeline/status` | Yes | Get pipeline processing status |

## Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings` | Yes | Get all settings |
| `PATCH` | `/api/settings` | Yes | Update settings (persisted to YAML) |

### Settings Update Fields

**LLM:** `llm_provider`, `ollama_base_url`, `ollama_model`, `claude_api_key`, `claude_model`, `extraction_timeout`

**OCR:** `ocr_engine`, `ocr_language`, `ocr_confidence_threshold`, `cloud_ocr_enabled`, `ocr_remote_url`, `ocr_remote_api_key`, `llm_vision_provider`, `llm_vision_model`, `llm_vision_ollama_url`, `google_vision_key`

**Pipeline:** `pipeline_watch_enabled`, `pipeline_poll_interval`, `pipeline_retry_interval`, `pipeline_max_retries`

**Auth:** `session_ttl_hours`

**OIDC:** `oidc_enabled`, `oidc_provider_url`, `oidc_client_id`, `oidc_client_secret`, `oidc_scopes`, `oidc_auto_create_user`, `oidc_username_claim`, `oidc_display_name_claim`

## Prompts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings/prompts` | Yes | List all prompts with current values |
| `PUT` | `/api/settings/prompts/{key}` | Yes | Update a prompt |
| `DELETE` | `/api/settings/prompts/{key}` | Yes | Reset prompt to default |

**Prompt keys:** `classification`, `extraction_bloodtest`, `extraction_specialist_report`, `extraction_prescription`, `extraction_invoice`, `extraction_discharge`, `extraction_radiology`, `extraction_vaccination`, `document_edit`, `sql_generation`, `chat_system`, `link_suggestion`, `page_classification`

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
