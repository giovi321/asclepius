# First Steps

This guide walks you through the basic workflow after installation.

## 1. Setup Wizard (First Launch Only)

On the very first launch — when no users exist in the database — Asclepius shows a **setup wizard** that walks you through:

1. **Create your admin account** — choose a username, password, and display name
2. **Create your first patient** — the patient name is pre-filled from your display name; you can also set date of birth and sex, which the LLM uses when extracting data from your documents
3. **Done** — you are automatically logged in and redirected to the dashboard

!!! info "The wizard only appears once"
    After setup, the login page is shown instead. You can create additional users and patients from the Settings and Patients pages.

## 2. Configure LLM & OCR

Before processing any documents, configure your LLM and OCR settings:

1. Go to **Settings** (gear icon in the sidebar)
2. Under **LLM**, configure your provider:
    - **Ollama**: set the base URL and model name (e.g., `llama3.1`)
    - **Claude**: paste your API key and choose a model
3. Under **OCR**, choose your OCR engine:
    - **Tesseract** (built-in) — good for clear, printed documents
    - **LLM Vision** — uses a vision model for OCR (better for handwriting, forms)
    - **Google Cloud Vision** — high accuracy, requires API key
    - **Tesseract Remote** — external Tesseract server

## 3. Upload Your First Document

There are two ways to add documents:

### Via the Web UI

1. Go to **Documents** in the sidebar
2. Click **Upload** or drag-and-drop files onto the upload area
3. Optionally select a patient to pre-assign the document
4. The document enters the processing pipeline automatically

### Via the Inbox Folder

1. Drop PDF, image (PNG/JPG/TIFF), or DICOM files into `vault/inbox/`
2. The file watcher detects them within a few seconds (configurable via `pipeline.poll_interval_seconds`)
3. Processing begins automatically

## 4. Monitor Processing

The **Dashboard** shows:

- Pipeline status (currently processing file, step, page progress)
- Queue depth (how many files are waiting)
- Recent processing errors

Processing steps for each document:

1. **OCR** -- text extraction from the document
2. **LLM Extraction** -- classification and structured data extraction
3. **Organizing** -- file moved to the patient's directory

For large documents (>5 pages), you will also see:

- **Page classification** -- each page is classified by content type
- **Section extraction** -- data is extracted from each section individually

You can also monitor detailed processing logs from **Settings** > **Logs**. The log viewer auto-refreshes every 3 seconds and auto-scrolls to the latest entries.

## 5. Review the Document

1. Go to **Documents** and click on your processed document
2. The detail page shows:
    - **PDF viewer** on the left
    - **Metadata** on the right (type, dates, doctor, facility, summary)
    - **Sections** for multi-page documents
    - **Lab results**, **medications**, **encounters**, **vaccinations** tables (if applicable)
    - **Tags** and **notes** fields
    - **Linked documents** and **medical event** assignment
3. All metadata fields are **inline-editable** -- click any field to edit it
4. Use the **AI Edit** button to modify metadata using natural language (e.g., "change the doctor to Dr. Smith")

## 6. Create a Medical Event

Medical events are the central organizing concept -- they represent a medical story like a diagnosis, treatment, or surgery.

1. Go to **Medical Events** in the sidebar
2. Click **Create Event**
3. Fill in:
    - **Title** (e.g., "Sleep Apnea Diagnosis & Treatment")
    - **Type** (diagnosis, surgery, treatment, hospitalization, etc.)
    - **Date range** (start date, optional end date, or mark as ongoing)
    - **Severity** (mild, moderate, severe, critical)
    - **Description** and **notes**
4. Link documents to the event from the event detail page, or from a document's detail page

!!! tip "AI Event Suggestions"
    On any document's detail page, click **Suggest Event** to have the LLM recommend which existing event the document belongs to, or suggest creating a new one.

## 7. Explore the Timeline

Go to **Timeline** in the sidebar to see all documents for the selected patient arranged chronologically:

- Vertical timeline with color-coded dots by document type
- Mini-map on the right for quick navigation across years
- Jump-to-date control for fast access to specific periods
- Click any entry to view the document detail

## 8. Create Additional Patients & Users

- Go to **Patients** in the sidebar to create more patient profiles
- Go to **Settings** > **Users** to create more user accounts
- Grant users access to specific patients with `owner` or `viewer` roles

## 9. Next Steps

- Set up [OIDC / SSO](../admin-guide/user-management.md) for enterprise authentication
- Configure [LLM and OCR settings](../admin-guide/llm-configuration.md) for better extraction quality
- Customize [LLM prompts](../admin-guide/llm-configuration.md#custom-prompts) if extractions need tuning
- Learn about [normalization](../user-guide/normalization.md) to improve cross-language data consistency
- Set up [automated backups](../admin-guide/backup-restore.md)
