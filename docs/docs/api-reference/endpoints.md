# API Endpoints

All endpoints require authentication unless noted. Prefix: `/api`

## Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login with username/password |
| POST | `/auth/logout` | Clear session |
| GET | `/auth/me` | Current user + accessible patients |

## Patients

| Method | Path | Description |
|--------|------|-------------|
| GET | `/patients` | List patients accessible to current user |
| POST | `/patients` | Create patient |
| PATCH | `/patients/{id}` | Update patient info |

## Documents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/documents` | List/search documents |
| GET | `/documents/{id}` | Document detail + extracted data |
| GET | `/documents/{id}/file` | Serve the original file |
| PATCH | `/documents/{id}` | Update metadata (patient, type, date) |
| POST | `/documents/{id}/reprocess` | Re-run OCR + LLM extraction |

**Query params for GET `/documents`:**

| Param | Type | Description |
|-------|------|-------------|
| `patient_id` | int | Filter by patient |
| `type` | string | Filter by document type |
| `date_from` | string | Start date (YYYY-MM-DD) |
| `date_to` | string | End date (YYYY-MM-DD) |
| `status` | string | Filter by status |
| `q` | string | Full-text search |
| `limit` | int | Results per page (max 200) |
| `offset` | int | Pagination offset |

## Lab Results

| Method | Path | Description |
|--------|------|-------------|
| GET | `/lab-results` | List lab results with filters |
| GET | `/lab-results/timeline` | Time series for a specific test |

## Imaging

| Method | Path | Description |
|--------|------|-------------|
| GET | `/imaging` | List imaging studies |
| GET | `/imaging/{study_id}` | Study detail + series list |
| GET | `/imaging/{study_id}/series/{series_id}/frames` | List DICOM frames |
| GET | `/imaging/{study_id}/series/{series_id}/frame/{index}` | Serve DICOM frame |

## Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Send message, get RAG response |
| GET | `/chat/history` | Chat history for a patient |

## Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings` | Current configuration |
| PATCH | `/settings` | Update settings (requires restart) |

## Pipeline

| Method | Path | Description |
|--------|------|-------------|
| GET | `/pipeline/status` | Queue depth, errors, processing status |

## Normalization

| Method | Path | Description |
|--------|------|-------------|
| GET | `/normalization/{type}` | List canonical terms |
| GET | `/normalization/{type}/{id}` | Term detail with aliases |
| PATCH | `/normalization/{type}/{id}` | Update canonical code/display |
| POST | `/normalization/{type}/{id}/aliases` | Add alias |
| DELETE | `/normalization/{type}/aliases/{alias_id}` | Remove alias |
| POST | `/normalization/{type}/{id}/confirm` | Confirm auto-mapped aliases |
| POST | `/normalization/{type}/merge` | Merge two canonical terms |

**Type values:** `lab_tests`, `specialties`, `diagnoses`, `medications`

## Health Check

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Returns `{"status": "ok"}` |
