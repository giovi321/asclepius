---
title: "Architecture Overview"
---

Asclepius runs as a **single Docker container**. A Python/FastAPI backend serves both the REST API and the pre-built React frontend, and every LLM call goes out to an external service you point it at. There is no bundled model server.

<div style="background:#efeee5;border:1px solid rgba(28,25,23,0.12);border-radius:8px;padding:1rem;margin:1rem 0;overflow:hidden;">
<svg viewBox="0 0 1040 560" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Asclepius architecture diagram" style="display:block;width:100%;height:auto;max-width:100%;">
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
      <marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#2563eb"/>
      </marker>
    </defs>

    <rect width="100%" height="100%" fill="#efeee5"/>
    <rect width="100%" height="100%" fill="url(#dots)" opacity="0.6"/>

    <!-- ===== Group labels ===== -->
    <text x="60" y="60" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.18em" fill="#78716c">CLIENT</text>
    <text x="240" y="60" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.18em" fill="#78716c">DOCKER CONTAINER</text>
    <text x="840" y="60" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.18em" fill="#78716c">EXTERNAL</text>

    <!-- Container boundary -->
    <rect x="220" y="76" width="588" height="332" rx="8" fill="rgba(28,25,23,0.02)" stroke="rgba(28,25,23,0.20)" stroke-width="1" stroke-dasharray="4,4"/>

    <!-- ===== ARROWS first (z-order) ===== -->
    <!-- Browser -> API -->
    <line x1="192" y1="160" x2="276" y2="160" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- API -> DB -->
    <line x1="376" y1="200" x2="376" y2="248" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- API -> Pipeline -->
    <line x1="428" y1="180" x2="520" y2="180" stroke="#8E4449" stroke-width="1.2" marker-end="url(#arrow-accent)"/>
    <!-- Pipeline -> Normalization Resolver -->
    <line x1="580" y1="220" x2="580" y2="272" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- Normalization -> DB -->
    <line x1="540" y1="300" x2="428" y2="284" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- Pipeline -> Vault -->
    <line x1="540" y1="220" x2="428" y2="340" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- API -> Vault (file serve) -->
    <line x1="376" y1="308" x2="376" y2="340" stroke="#57534e" stroke-width="1" stroke-dasharray="5,4" marker-end="url(#arrow)"/>
    <!-- Pipeline -> Tesseract (local) -->
    <line x1="608" y1="220" x2="680" y2="300" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- Pipeline -> Credential Gate -->
    <line x1="644" y1="180" x2="708" y2="180" stroke="#57534e" stroke-width="1" marker-end="url(#arrow)"/>
    <!-- Credential Gate -> External LLM -->
    <line x1="808" y1="160" x2="856" y2="140" stroke="#2563eb" stroke-width="1" marker-end="url(#arrow-link)"/>
    <!-- Credential Gate -> External Vision -->
    <line x1="808" y1="180" x2="856" y2="240" stroke="#2563eb" stroke-width="1" marker-end="url(#arrow-link)"/>
    <!-- Credential Gate -> External OCR -->
    <line x1="808" y1="200" x2="856" y2="320" stroke="#2563eb" stroke-width="1" marker-end="url(#arrow-link)"/>

    <!-- arrow labels with masking -->
    <rect x="214" y="152" width="36" height="12" rx="2" fill="#efeee5"/>
    <text x="232" y="161" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">HTTP</text>

    <rect x="448" y="170" width="48" height="12" rx="2" fill="#efeee5"/>
    <text x="472" y="179" font-family="'Geist Mono',monospace" font-size="8" fill="#8E4449" text-anchor="middle" letter-spacing="0.06em">DISPATCH</text>

    <rect x="648" y="170" width="60" height="12" rx="2" fill="#efeee5"/>
    <text x="678" y="179" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">ACQUIRE</text>

    <rect x="820" y="148" width="36" height="12" rx="2" fill="#efeee5"/>
    <text x="838" y="157" font-family="'Geist Mono',monospace" font-size="8" fill="#2563eb" text-anchor="middle" letter-spacing="0.06em">HTTP</text>

    <rect x="548" y="232" width="68" height="12" rx="2" fill="#efeee5"/>
    <text x="582" y="241" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">LLM JSON</text>

    <rect x="448" y="280" width="56" height="12" rx="2" fill="#efeee5"/>
    <text x="476" y="289" font-family="'Geist Mono',monospace" font-size="8" fill="#65655c" text-anchor="middle" letter-spacing="0.06em">RESOLVED</text>

    <!-- ===== NODES ===== -->
    <!-- Browser -->
    <rect x="64" y="128" width="128" height="64" rx="6" fill="#faf7f2"/>
    <rect x="64" y="128" width="128" height="64" rx="6" fill="rgba(87,83,78,0.10)" stroke="#78716c" stroke-width="1"/>
    <rect x="72" y="136" width="36" height="12" rx="2" fill="transparent" stroke="rgba(120,113,108,0.40)" stroke-width="0.8"/>
    <text x="90" y="145" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(120,113,108,0.9)" text-anchor="middle" letter-spacing="0.08em">USER</text>
    <text x="128" y="170" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Browser</text>
    <text x="128" y="184" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">React UI</text>

    <!-- FastAPI Backend (focal — API entry) -->
    <rect x="276" y="128" width="152" height="80" rx="6" fill="#faf7f2"/>
    <rect x="276" y="128" width="152" height="80" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <rect x="284" y="136" width="40" height="12" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
    <text x="304" y="145" font-family="'Geist Mono',monospace" font-size="7" fill="#8E4449" text-anchor="middle" letter-spacing="0.08em">API</text>
    <text x="352" y="170" font-family="'Geist',sans-serif" font-size="13" font-weight="600" fill="#1c1917" text-anchor="middle">FastAPI Backend</text>
    <text x="352" y="186" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">REST · auth · static</text>
    <text x="352" y="200" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">python 3.12</text>

    <!-- Processing Pipeline (focal) -->
    <rect x="520" y="140" width="124" height="80" rx="6" fill="#faf7f2"/>
    <rect x="520" y="140" width="124" height="80" rx="6" fill="rgba(142,68,73,0.10)" stroke="#8E4449" stroke-width="1.2"/>
    <rect x="528" y="148" width="44" height="12" rx="2" fill="transparent" stroke="rgba(142,68,73,0.50)" stroke-width="0.8"/>
    <text x="550" y="157" font-family="'Geist Mono',monospace" font-size="7" fill="#8E4449" text-anchor="middle" letter-spacing="0.08em">WORKER</text>
    <text x="582" y="184" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Pipeline</text>
    <text x="582" y="200" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">background</text>
    <text x="582" y="212" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">asyncio task</text>

    <!-- Credential Gate -->
    <rect x="708" y="140" width="100" height="80" rx="6" fill="#faf7f2"/>
    <rect x="708" y="140" width="100" height="80" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="716" y="148" width="44" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="738" y="157" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">GATE</text>
    <text x="758" y="184" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Credential</text>
    <text x="758" y="198" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Gate</text>
    <text x="758" y="212" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">max_concurrent</text>

    <!-- Normalization Resolver -->
    <rect x="520" y="272" width="124" height="56" rx="6" fill="#faf7f2"/>
    <rect x="520" y="272" width="124" height="56" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="528" y="278" width="60" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="558" y="287" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">RESOLVER</text>
    <text x="582" y="304" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Normalization</text>
    <text x="582" y="320" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">alias lookup · python</text>

    <!-- SQLite store -->
    <rect x="276" y="252" width="152" height="56" rx="6" fill="#faf7f2"/>
    <rect x="276" y="252" width="152" height="56" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
    <rect x="284" y="258" width="40" height="12" rx="2" fill="transparent" stroke="rgba(87,83,78,0.40)" stroke-width="0.8"/>
    <text x="304" y="267" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(87,83,78,0.9)" text-anchor="middle" letter-spacing="0.08em">DB</text>
    <text x="352" y="284" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">SQLite + FTS5</text>
    <text x="352" y="300" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">WAL · aiosqlite</text>

    <!-- Vault -->
    <rect x="276" y="340" width="152" height="40" rx="6" fill="#faf7f2"/>
    <rect x="276" y="340" width="152" height="40" rx="6" fill="rgba(28,25,23,0.05)" stroke="#57534e" stroke-width="1"/>
    <rect x="284" y="346" width="40" height="12" rx="2" fill="transparent" stroke="rgba(87,83,78,0.40)" stroke-width="0.8"/>
    <text x="304" y="355" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(87,83,78,0.9)" text-anchor="middle" letter-spacing="0.08em">FILES</text>
    <text x="352" y="368" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Vault volume</text>

    <!-- Tesseract (local) -->
    <rect x="680" y="300" width="124" height="40" rx="6" fill="#faf7f2"/>
    <rect x="680" y="300" width="124" height="40" rx="6" fill="#ffffff" stroke="#1c1917" stroke-width="1"/>
    <rect x="688" y="306" width="40" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.40)" stroke-width="0.8"/>
    <text x="708" y="315" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.8)" text-anchor="middle" letter-spacing="0.08em">OCR</text>
    <text x="742" y="328" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Tesseract 5</text>

    <!-- External: LLM, OCR, Vision -->
    <rect x="856" y="104" width="152" height="64" rx="6" fill="#faf7f2"/>
    <rect x="856" y="104" width="152" height="64" rx="6" fill="rgba(28,25,23,0.03)" stroke="rgba(28,25,23,0.30)" stroke-width="1"/>
    <rect x="864" y="112" width="40" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.30)" stroke-width="0.8"/>
    <text x="884" y="121" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.7)" text-anchor="middle" letter-spacing="0.08em">LLM</text>
    <text x="932" y="144" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Ollama · vLLM</text>
    <text x="932" y="160" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">claude · openai</text>

    <rect x="856" y="200" width="152" height="64" rx="6" fill="#faf7f2"/>
    <rect x="856" y="200" width="152" height="64" rx="6" fill="rgba(28,25,23,0.03)" stroke="rgba(28,25,23,0.30)" stroke-width="1"/>
    <rect x="864" y="208" width="56" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.30)" stroke-width="0.8"/>
    <text x="892" y="217" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.7)" text-anchor="middle" letter-spacing="0.08em">VISION</text>
    <text x="932" y="240" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Vision-LLM</text>
    <text x="932" y="256" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">qwen2.5-vl · gpt-4o</text>

    <rect x="856" y="288" width="152" height="64" rx="6" fill="#faf7f2"/>
    <rect x="856" y="288" width="152" height="64" rx="6" fill="rgba(28,25,23,0.03)" stroke="rgba(28,25,23,0.30)" stroke-width="1"/>
    <rect x="864" y="296" width="56" height="12" rx="2" fill="transparent" stroke="rgba(28,25,23,0.30)" stroke-width="0.8"/>
    <text x="892" y="305" font-family="'Geist Mono',monospace" font-size="7" fill="rgba(28,25,23,0.7)" text-anchor="middle" letter-spacing="0.08em">OCR</text>
    <text x="932" y="328" font-family="'Geist',sans-serif" font-size="12" font-weight="600" fill="#1c1917" text-anchor="middle">Remote OCR</text>
    <text x="932" y="344" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e" text-anchor="middle">chandra · gvision</text>

    <!-- ===== Legend strip ===== -->
    <line x1="60" y1="440" x2="980" y2="440" stroke="rgba(28,25,23,0.10)" stroke-width="0.8"/>
    <text x="60" y="458" font-family="'Geist Mono',monospace" font-size="8" letter-spacing="0.14em" fill="#57534e">LEGEND</text>

    <rect x="140" y="450" width="14" height="10" rx="2" fill="rgba(142,68,73,0.10)" stroke="#8E4449"/>
    <text x="160" y="459" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">Focal</text>

    <rect x="220" y="450" width="14" height="10" rx="2" fill="#ffffff" stroke="#1c1917"/>
    <text x="240" y="459" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">In-container</text>

    <rect x="340" y="450" width="14" height="10" rx="2" fill="rgba(28,25,23,0.05)" stroke="#57534e"/>
    <text x="360" y="459" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">Store / files</text>

    <rect x="460" y="450" width="14" height="10" rx="2" fill="rgba(28,25,23,0.03)" stroke="rgba(28,25,23,0.30)"/>
    <text x="480" y="459" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">External service</text>

    <line x1="600" y1="455" x2="624" y2="455" stroke="#2563eb" stroke-width="1" marker-end="url(#arrow-link)"/>
    <text x="632" y="459" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">External HTTP</text>

    <line x1="740" y1="455" x2="764" y2="455" stroke="#57534e" stroke-width="1" stroke-dasharray="5,4" marker-end="url(#arrow)"/>
    <text x="772" y="459" font-family="'Geist Mono',monospace" font-size="9" fill="#57534e">File serve</text>

    <text x="60" y="510" font-family="'Instrument Serif',serif" font-style="italic" font-size="13" fill="#57534e">The gate enforces per-credential concurrency; the resolver collapses aliases before writes.</text>
  </svg>
</div>

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **FastAPI Backend** | REST API, authentication (session + OIDC), database access, file serving, settings management |
| **React Frontend** | Web UI for browsing, searching, managing records, uploading documents, and configuring settings |
| **Processing Pipeline** | File watcher (watchdog), OCR, LLM extraction, page sectioning, file organization. Runs in a background asyncio task |
| **SQLite + FTS5** | All structured data storage with WAL mode for concurrent reads. FTS5 virtual table for full-text search |
| **Tesseract OCR** | Local OCR engine bundled in the container (5 language packs) |
| **Ollama / Claude** | External LLM providers for document classification, data extraction, chat, and AI editing |
| **Vault** | Organized file storage on the filesystem, mounted as a Docker volume |

## Request Flow

1. User interacts with the React UI in the browser
2. UI makes REST API calls to the FastAPI backend
3. Backend validates authentication via signed session cookies (or OIDC)
4. Backend checks authorization via the `user_patient_access` table
5. Backend queries SQLite and serves files from the vault

## Pipeline Flow (High Level)

1. File watcher (watchdog) detects new files in `vault/inbox/`
2. Files are queued with priority (smallest files first)
3. For each file:
    - Compute SHA-256 hash for deduplication
    - Run OCR (Tesseract, LLM Vision, Google Vision, or Remote)
    - If document >5 pages: smart page-level sectioning
    - Phase 1: Classify document type and extract basic metadata
    - Phase 2: Type-specific extraction (lab results, medications, encounters, etc.)
    - Normalize doctor/facility names, match to existing records
    - Organize file into `vault/patients/{slug}/{year}/`
4. Per-document progress tracking (step + current page) visible on Dashboard

See [Processing Pipeline](pipeline.md) for the complete flow.

## Key Design Decisions

- **No ORM**. Raw SQL with aiosqlite. Easier to reason about, easier to optimize, fewer hidden N+1s.
- **SQLite with WAL**. Portable, no extra service to run, fast enough for single-instance use. WAL mode lets the web server keep reading while the pipeline writes.
- **Session-based auth**. Signed cookies via itsdangerous, bcrypt for passwords. No JWTs to rotate or revoke.
- **File-based storage**. Files live on disk under patient/year folders; metadata lives in the database.
- **No bundled LLM**. You point Asclepius at your own Ollama, vLLM, Claude, or OpenAI endpoint. The container stays small and the model lifecycle is yours to manage.
- **Two-phase extraction**. A cheap classification pass runs first; the second pass loads only the type-specific prompt. The LLM never sees a kitchen-sink schema.
- **Pipeline in a background asyncio task**. The web server never blocks on processing. Cancellation works through an in-memory set of cancelled document IDs that the pipeline checks between steps.
- **Runtime pipeline control**. The Settings UI starts and stops the pipeline at runtime via `app.state.pipeline_task`. After five consecutive provider connectivity failures, the pipeline pauses itself.
- **Settings are live**. Configuration changes are written back to YAML and applied to the in-memory config immediately, no restart.
