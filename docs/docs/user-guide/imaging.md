# Medical Imaging

## Supported Formats

- **DICOM** (.dcm) — native medical imaging format from CT, MRI, X-ray, ultrasound
- **Non-DICOM images** — JPEG, PNG, TIFF (scanned films, wound photos)

## DICOM Processing

When DICOM files are dropped into the inbox:

1. Metadata is extracted via pydicom (without loading pixel data)
2. Patient matching against known patients
3. Files are organized into the imaging folder structure
4. Study and series records are created in the database

## Imaging Page

The Imaging page shows all imaging studies for the selected patient:

- Study cards with modality, body part, date, and institution
- Series list with image counts
- Click a study to see details

## DICOM Viewer

The full deployment includes a Cornerstone.js-based DICOM viewer with:

- Windowing/leveling controls
- Zoom and pan
- Scroll through slices
- Series navigator

## Vault Organization

```
patients/{slug}/{year}/imaging/
  └── {date}_{provider}_{modality}/
      ├── series-001/
      │   ├── 00001.dcm
      │   └── ...
      └── series-002/
```
