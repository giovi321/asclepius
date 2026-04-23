---
title: "Medical Events"
---

## Overview

Medical events group related documents under a single medical story: a
diagnosis, a treatment course, a surgery, a hospitalization — anything
that spans more than one document.

For example, a *Sleep Apnea Diagnosis & Treatment* event might link
together the initial consultation report, the sleep study results, the
CPAP prescription, follow-up visits, and the insurance invoices.

## Event types

| Type                | Description                       |
| ------------------- | --------------------------------- |
| `symptom`           | Onset of symptoms                 |
| `diagnosis`         | New diagnosis                     |
| `hospitalization`   | Hospital stay                     |
| `surgery`           | Surgical procedure                |
| `treatment`         | Treatment course                  |
| `follow_up`         | Follow-up visit or check          |
| `emergency`         | Emergency room visit              |
| `pregnancy`         | Pregnancy-related                 |
| `chronic_condition` | Ongoing chronic condition         |
| `injury`            | Injury or accident                |
| `screening`         | Preventive screening              |
| `other`             | Other medical event               |

## Event fields

Required: **title** and **patient**. Optional: **type**, **date start /
end**, **is ongoing**, **severity** (mild / moderate / severe / critical),
free-text **diagnosis**, **ICD-10 code**, **specialty**, **description**,
**notes**, and a **color** (hex) for timeline display.

## Linking documents

Documents can be linked to events with a relevance level:

- **Primary** — directly related to this event
- **Secondary** — tangentially related
- **Background** — provides context

Links can be created from either the event detail page (search and add)
or the document detail page (select an event or create a new one —
setting the document's `event_id` to the primary event).

## Event detail page

Shows event metadata, the list of linked documents with relevance levels
sorted by date, a document count, and whether each link was manual or
auto-linked by the LLM.

## Managing events

Two deletion options:

- **Delete Event** removes the event and unlinks all documents (documents
  are kept).
- **Delete Event & Documents** removes the event AND permanently deletes
  all linked documents.

Both require confirmation. The Medical Events list can be filtered by
patient (automatic when a patient is selected) and event type.

## Data model

### Medical events table

| Field             | Description                                 |
| ----------------- | ------------------------------------------- |
| `patient_id`      | Patient this event belongs to               |
| `title`           | Descriptive title                           |
| `event_type`      | One of the event types above                |
| `description`     | Detailed description                        |
| `date_start`      | Event start date                            |
| `date_end`        | Event end date (null if ongoing)            |
| `is_ongoing`      | Whether the event is still active           |
| `severity`        | mild, moderate, severe, critical            |
| `diagnosis_text`  | Free text diagnosis                         |
| `icd10_code`      | ICD-10 diagnosis code                       |
| `specialty_text`  | Relevant medical specialty                  |
| `notes`           | User notes                                  |
| `color`           | Hex color for timeline display              |

### Document-event links table

| Field         | Description                        |
| ------------- | ---------------------------------- |
| `document_id` | Linked document                    |
| `event_id`    | Linked event                       |
| `relevance`   | primary, secondary, or background  |
