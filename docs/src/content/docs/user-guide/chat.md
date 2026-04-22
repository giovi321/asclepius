---
title: "Chat"
---

## Overview

Chat lets you ask questions about a patient's medical history in plain language. It uses RAG (Retrieval Augmented Generation) to query the structured database, so answers are grounded in your actual records rather than whatever the model decides to invent.

## How it works

<iframe src="../../assets/diagrams/chat-flow.html" width="100%" height="480" style="border:0;border-radius:8px;" title="Chat flow"></iframe>

1. **SQL generation**. The LLM turns your natural-language question into a SQL query against the structured tables (`documents`, `lab_results`, `encounters`, `medications`, …).
2. **Query execution**. The SQL runs against SQLite, scoped to patients you have access to.
3. **Answer generation**. The LLM uses the rows it got back to compose a natural-language reply.
4. **Source documents**. Every document referenced in the conversation is listed in the **Source documents** sidebar to the right, newest answer first. Click a row to jump to its detail page. When the LLM's SQL touches the `documents` table but forgets to select `documents.id`, the backend falls back to matching the result rows against the documents table by `original_filename` / `doc_date` / `doc_type` (scoped to the active patient) so the sidebar still populates.

## Usage

1. Select a patient from the sidebar (optional — chat can work across all patients you have access to)
2. Go to **Chat** in the sidebar
3. Type your question and press Enter

### Example questions

- "What were my last cholesterol results?"
- "When was my last blood test?"
- "What medications am I currently taking?"
- "Show me all visits to Dr. Mueller"
- "What diagnoses have been made in the last year?"
- "How has my hemoglobin changed over time?"
- "When is my next follow-up appointment?"

## Chat history

Chat history is persisted per user and per patient, including the source documents attached to each assistant reply, so reloading the page restores the links exactly as they were. Click **Start new chat** in the header to clear the current conversation. That removes the chat history for the active user/patient pair on the server (`DELETE /api/chat/history`) and empties the visible message list.

## Custom system prompt

The chat system prompt and SQL generation prompt can be customized from **Settings → Document Analysis → Prompts**:

- `chat_system` -- The system prompt that defines the assistant's personality and behavior
- `sql_generation` -- The prompt that instructs the LLM how to generate SQL queries from questions

See [LLM Configuration](../admin-guide/llm-configuration.md#custom-prompts) for details.

## Limitations

- The chat queries structured data only -- it does not search raw OCR text (use Search for that)
- Complex analytical questions may produce incorrect SQL queries
- Response quality depends on the LLM model used (larger models produce better SQL)
