# First Steps

This guide walks you through the basic workflow after installation.

## 1. Change the Default Password

1. Log in with `admin` / `admin`
2. Go to **Settings** (gear icon in the sidebar)
3. Under **Users**, find the admin user and change the password

## 2. Create a Patient

1. Go to **Patients** in the sidebar
2. Click **Add Patient**
3. Fill in the patient details:
    - **Display name** (required) -- how the patient appears throughout the UI
    - **Date of birth**, **sex**, **blood type** -- basic demographics
    - **Allergies** -- free text field
    - **Contact info** -- phone, email, address
    - **Insurance** -- company name and policy number
4. Click **Save**

The patient gets a URL-safe slug automatically (e.g., "Giovanni Crapelli" becomes `giovanni-crapelli`), which is used for file organization.

## 3. Grant Yourself Access

After creating a patient, grant your user access:

1. Go to **Settings** > **Users**
2. Click your user, then **Grant Access**
3. Select the patient and choose a role:
    - **Owner** -- full access, can delete documents and reassign patients
    - **Viewer** -- read-only access to the patient's records

## 4. Upload Your First Document

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

## 5. Monitor Processing

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

## 6. Review the Document

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

## 7. Create a Medical Event

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

## 8. Explore the Timeline

Go to **Timeline** in the sidebar to see all documents for the selected patient arranged chronologically:

- Vertical timeline with color-coded dots by document type
- Mini-map on the right for quick navigation across years
- Jump-to-date control for fast access to specific periods
- Click any entry to view the document detail

## 9. Next Steps

- Set up [OIDC / SSO](../admin-guide/user-management.md) for enterprise authentication
- Configure [LLM and OCR settings](../admin-guide/llm-configuration.md) for better extraction quality
- Customize [LLM prompts](../admin-guide/llm-configuration.md#custom-prompts) if extractions need tuning
- Learn about [normalization](../user-guide/normalization.md) to improve cross-language data consistency
- Set up [automated backups](../admin-guide/backup-restore.md)
