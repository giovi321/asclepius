# Chat

## Overview

The Chat feature lets you ask questions about a patient's medical history using natural language. It uses RAG (Retrieval Augmented Generation) to query the structured database and provide accurate answers.

## How It Works

1. Select a patient from the sidebar
2. Type your question in the chat input
3. The system generates a SQL query from your question
4. The query runs against the medical database (read-only)
5. Results are sent to the LLM with your question for a natural language answer

## Example Questions

- "What were my last cholesterol results?"
- "When was my last visit to Dr. House?"
- "List all medications prescribed in 2024"
- "What diagnoses have been recorded?"
- "Show my hemoglobin trend over the past year"
- "When is my next follow-up appointment?"

## Safety

- All SQL queries are read-only (SELECT only)
- No INSERT, UPDATE, DELETE, or DDL operations are allowed
- Query timeout of 5 seconds prevents runaway queries
- Chat history is saved per user and patient

## Limitations

- Requires a configured LLM (Ollama or Claude)
- Answers are based on extracted data, not raw document text
- Complex questions may fall back to context-based answers
