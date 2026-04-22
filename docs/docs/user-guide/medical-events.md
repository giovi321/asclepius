# Medical Events

## Overview

Medical events group related documents under a single medical story: a diagnosis, a treatment course, a surgery, a hospitalization, anything that spans more than one document.

For example, a "Sleep Apnea Diagnosis & Treatment" event might link together:

- Initial consultation report
- Sleep study results
- CPAP prescription
- Follow-up visits
- Insurance invoices

## Event types

| Type | Description |
|------|-------------|
| `symptom` | Onset of symptoms |
| `diagnosis` | New diagnosis |
| `hospitalization` | Hospital stay |
| `surgery` | Surgical procedure |
| `treatment` | Treatment course |
| `follow_up` | Follow-up visit or check |
| `emergency` | Emergency room visit |
| `pregnancy` | Pregnancy-related |
| `chronic_condition` | Ongoing chronic condition |
| `injury` | Injury or accident |
| `screening` | Preventive screening |
| `other` | Other medical event |

## Creating an event

1. Go to **Medical Events** in the sidebar
2. Click **Create Event**
3. Fill in the details:
    - **Title** (required) -- descriptive name for the event
    - **Patient** (required) -- which patient this event belongs to
    - **Type** -- select from the event types above
    - **Date start** -- when the event began
    - **Date end** -- when the event ended (leave empty if ongoing)
    - **Is ongoing** -- check if the event is still active
    - **Severity** -- mild, moderate, severe, or critical
    - **Diagnosis** -- free text diagnosis description
    - **ICD-10 code** -- optional standardized code
    - **Specialty** -- relevant medical specialty
    - **Description** -- detailed description
    - **Notes** -- additional notes
    - **Color** -- hex color for timeline display

## Linking documents to events

Documents can be linked to events in several ways:

### From the event detail page

1. Open an event
2. Use the document linking interface to search for and add documents
3. Set the relevance level:
    - **Primary** -- directly related to this event
    - **Secondary** -- tangentially related
    - **Background** -- provides context

### From the document detail page

1. Open a document
2. In the Medical Event section, select an existing event or create a new one
3. The document's `event_id` field is set to the primary event

## Event detail page

The event detail page shows:

- Event metadata (title, type, dates, severity, diagnosis)
- **Linked documents** with their relevance level, sorted by date
- Document count
- Whether each link was created manually or by the LLM (auto-linked)

## Managing events

### Editing

Click any field on the event detail page to edit it inline.

### Deleting

Two deletion options are available:

- **Delete Event** -- removes the event and unlinks all documents (documents are kept)
- **Delete Event & Documents** -- removes the event AND permanently deletes all linked documents from disk and database

Both options require confirmation.

### Filtering

On the Medical Events list page, filter by:

- **Patient** (automatically applied when a patient is selected)
- **Event type**

## Data model

### Medical events table

| Field | Description |
|-------|-------------|
| `patient_id` | Patient this event belongs to |
| `title` | Descriptive title |
| `event_type` | One of the event types above |
| `description` | Detailed description |
| `date_start` | Event start date |
| `date_end` | Event end date (null if ongoing) |
| `is_ongoing` | Whether the event is still active |
| `severity` | mild, moderate, severe, critical |
| `diagnosis_text` | Free text diagnosis |
| `icd10_code` | ICD-10 diagnosis code |
| `specialty_text` | Relevant medical specialty |
| `notes` | User notes |
| `color` | Hex color for timeline display |

### Document-event links table

| Field | Description |
|-------|-------------|
| `document_id` | Linked document |
| `event_id` | Linked event |
| `relevance` | primary, secondary, or background |
