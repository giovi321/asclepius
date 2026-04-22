---
title: "Chat"
---

## Overview

Chat lets you ask questions about a patient's medical history in plain language. It uses RAG (Retrieval Augmented Generation) to query the structured database, so answers are grounded in your actual records rather than whatever the model decides to invent.

## How it works

<div style="background:#efeee5;border:1px solid rgba(28,25,23,0.12);border-radius:8px;padding:1rem;margin:1rem 0;overflow:hidden;">
<svg viewBox="0 0 920 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Chat flow" style="display:block;width:100%;height:auto;max-width:100%;">
    <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.9" fill="rgba(28,25,23,0.10)"/>
      </pattern>
      <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#57534e"/>
      </marker>
      <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#8E4449"/>
      </marker>
    </defs>
    <rect width="100%" height="100%" fill="#efeee5"/>
    <rect width="100%" height="100%" fill="url(#dots)" opacity="0.6"/>

    <!-- arrows -->
    <line x1="180" y1="120" x2="244" y2="120" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <line x1="384" y1="120" x2="448" y2="120" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-accent)"/>
    <line x1="588" y1="120" x2="652" y2="120" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <line x1="792" y1="120" x2="852" y2="120" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>

    <!-- arrow labels -->
    <rect x="200" y="108" width="48" height="14" rx="2" fill="#efeee5"/>
    <text x="224" y="118" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">PROMPT</text>

    <rect x="404" y="108" width="48" height="14" rx="2" fill="#efeee5"/>
    <text x="428" y="118" font-family="'Geist Mono',monospace" font-size="8" fill="#8E4449" text-anchor="middle" letter-spacing="0.06em">SELECT</text>

    <rect x="608" y="108" width="48" height="14" rx="2" fill="#efeee5"/>
    <text x="632" y="118" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">ROWS</text>

    <rect x="812" y="108" width="48" height="14" rx="2" fill="#efeee5"/>
    <text x="832" y="118" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">REPLY</text>

    <!-- nodes -->
    <!-- 1. User question -->
    <rect x="40" y="80" width="140" height="80" rx="6" fill="#faf7f2"/>
    <rect x="40" y="80" width="140" height="80" rx="6" fill="rgba(87,83,78,0.10)" stroke="#78716c" stroke-width="1"/>
    <rect x="48" y="88" width="36" height="12" rx="2" fill="transparent" stroke="rgba(120,113,108,0.40)" stroke-width="0.8"/>
    <text x="66" y="97" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(120,113,108,0.9)" text-anchor="middle" letter-spacing="0.08em">USER</text>
    <text x="110" y="124" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Question</text>
    <text x="110" y="140" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">"last cholesterol</text>
    <text x="110" y="152" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">results?"</text>

    <!-- 2. SQL gen LLM (focal) -->
    <rect x="244" y="80" width="140" height="80" rx="6" fill="#faf7f2"/>
    <rect x="244" y="80" width="140" height="80" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <rect x="252" y="88" width="36" height="12" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
    <text x="270" y="97" font-family="'Geist Mono',monospace" font-size="7" fill="#8E4449" text-anchor="middle" letter-spacing="0.08em">LLM</text>
    <text x="314" y="120" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">SQL generation</text>
    <text x="314" y="136" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">schema-aware</text>
    <text x="314" y="148" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">prompt</text>

    <!-- 3. SQLite -->
    <rect x="448" y="80" width="140" height="80" rx="6" fill="#faf7f2"/>
    <rect x="448" y="80" width="140" height="80" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
    <rect x="456" y="88" width="36" height="12" rx="2" fill="transparent" stroke="rgba(87,83,78,0.40)" stroke-width="0.8"/>
    <text x="474" y="97" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(87,83,78,0.9)" text-anchor="middle" letter-spacing="0.08em">DB</text>
    <text x="518" y="120" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Execute query</text>
    <text x="518" y="136" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">SQLite · read-only</text>
    <text x="518" y="148" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">scope-checked</text>

    <!-- 4. LLM compose -->
    <rect x="652" y="80" width="140" height="80" rx="6" fill="#faf7f2"/>
    <rect x="652" y="80" width="140" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="660" y="88" width="36" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="678" y="97" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">LLM</text>
    <text x="722" y="120" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Compose answer</text>
    <text x="722" y="136" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">grounded in rows</text>

    <!-- 5. Reply with sidebar -->
    <rect x="852" y="80" width="48" height="80" rx="6" fill="#faf7f2"/>
    <rect x="852" y="80" width="48" height="80" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
    <text x="876" y="124" font-family="'Geist',sans-serif" font-size="11" font-weight="600" fill="#1c1917" text-anchor="middle">UI</text>
    <text x="876" y="140" font-family="'Geist Mono',monospace" font-size="8" fill="#57534e" text-anchor="middle">+sidebar</text>

    <!-- footer note -->
    <line x1="40" y1="220" x2="900" y2="220" stroke="rgba(28,25,23,0.10)" stroke-width="0.8"/>
    <text x="40" y="244" font-family="'Instrument Serif',serif" font-style="italic" font-size="13" fill="#57534e">SQL is generated, not retrieved — every question hits the live DB. Every cited row's document_id lands in the source documents sidebar.</text>
  </svg>
</div>

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
