# Medical Imaging

## Supported Formats

- **DICOM** (.dcm) -- native medical imaging format from CT, MRI, X-ray, ultrasound, and other modalities
- **PDF/Image** -- radiology reports and imaging documents (processed as regular documents)

## DICOM Viewer

The built-in DICOM viewer (powered by Cornerstone.js) provides:

- **Windowing** -- adjust window width and level for optimal contrast
- **Zoom** -- zoom in/out on the image
- **Pan** -- move the image within the viewport
- **Slice scrolling** -- scroll through slices in multi-slice studies (CT, MRI)
- **Series navigation** -- switch between different series in a study

## Imaging Studies

The Imaging page lists all imaging studies for the selected patient with:

- **Modality** (CT, MRI, X-ray, Ultrasound, etc.)
- **Body part**
- **Study description**
- **Study date**
- **Number of series and images**

### Filtering

Filter studies by:

- **Modality**
- **Date range**

## DICOM Ingestion

When DICOM files are dropped into the inbox:

1. The pipeline detects the `.dcm` extension
2. DICOM metadata is extracted (patient name, study date, modality, series info)
3. Files are organized into `vault/patients/{slug}/{year}/imaging/{study-folder}/series-{n}/`
4. An `imaging_studies` record is created with associated `imaging_series` records
5. The original DICOM structure is preserved

### Multi-file Studies

For studies with multiple files (e.g., a CT scan with hundreds of slices):

- Drop all `.dcm` files into the inbox
- Files belonging to the same study are grouped by Study Instance UID
- Each series gets its own subfolder

## Data Model

### Imaging Studies

| Field | Description |
|-------|-------------|
| `modality` | CT, MRI, XR, US, etc. |
| `body_part` | Anatomical region |
| `study_description` | Description from DICOM metadata |
| `study_date` | Date the study was performed |
| `study_instance_uid` | DICOM Study Instance UID |
| `is_dicom` | Whether DICOM files are available |
| `folder_path` | Path to the study folder |

### Imaging Series

| Field | Description |
|-------|-------------|
| `series_number` | Series number within the study |
| `series_description` | Description from DICOM metadata |
| `modality` | Modality for this specific series |
| `num_images` | Number of images in the series |
| `series_instance_uid` | DICOM Series Instance UID |
