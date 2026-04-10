# First Steps

## 1. Log In

Open [http://localhost:8070](http://localhost:8070) and log in with the default credentials:

- **Username:** `admin`
- **Password:** `admin`

!!! warning
    Change the default password after first login.

## 2. Create a Patient

Go to **Settings** and create your first patient:

1. Navigate to the Settings page
2. Or use the API directly: `POST /api/patients` with `{"display_name": "Your Name"}`

The system creates a folder in the vault: `vault/patients/your-name/`

## 3. Drop Documents into the Inbox

Copy or move medical documents into `vault/inbox/`. Supported formats:

- **PDF** — scanned or digital
- **Images** — JPEG, PNG, TIFF
- **DICOM** — `.dcm` files from CDs or imaging systems

The pipeline automatically:

1. Detects the new file
2. Runs OCR (for PDFs and images)
3. Sends text to the LLM for structured extraction
4. Matches the document to a patient
5. Extracts lab results, diagnoses, medications, etc.
6. Moves the file to the organized vault structure

## 4. Review Results

- **Dashboard** — See recent documents and pipeline status
- **Documents** — Browse all documents, filter by type and date
- **Lab Results** — View extracted lab values with trend tracking
- **Unclassified** — Assign documents that couldn't be auto-matched to a patient

## 5. Chat with Your Records

Select a patient and open the **Chat** page. Ask questions like:

- "What were my last cholesterol results?"
- "When was my last blood test?"
- "What medications am I currently taking?"

The chat uses RAG (Retrieval Augmented Generation) to query the structured database and provide answers with source references.

## 6. Search

Use the **Search** page for full-text search across all OCR text and extracted data. The search uses SQLite FTS5 for fast, ranked results.
