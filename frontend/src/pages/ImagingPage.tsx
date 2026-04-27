import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Image, Pencil, Trash2 } from "lucide-react";
import FileUpload from "@/components/FileUpload";
import MetadataEditor from "@/components/document-detail/MetadataEditor";
import EventSelector from "@/components/document-detail/EventSelector";
import LinksSection from "@/components/document-detail/LinksSection";
import NotesEditor from "@/components/document-detail/NotesEditor";
import {
  ImagingStudiesSection,
} from "@/components/document-detail/ChildRecordSections";
import { EditableSummary } from "@/components/document-detail/DocumentDetailHelpers";

const MODALITY_LABELS: Record<string, string> = {
  CT: "CT scan", MR: "MRI", US: "Ultrasound", XR: "X-ray", CR: "X-ray (computed)",
  DX: "X-ray (digital)", MG: "Mammography", PT: "PET", NM: "Nuclear medicine",
  RF: "Fluoroscopy", OT: "Other",
};
function modalityLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return MODALITY_LABELS[code.toUpperCase()] || code;
}

/**
 * Imaging page. The list on the left is filtered to imaging studies; the
 * right-hand panel shows the SAME metadata + child-record stack used on
 * the document detail page (MetadataEditor, EventSelector, LinksSection,
 * NotesEditor) plus the imaging-specific block (ImagingStudiesSection)
 * with the embedded DICOM viewer + bundle files. Editing happens in
 * place, so a clinician can stay on this page to update metadata,
 * navigate frames, link a radiology report, etc.
 */
export default function ImagingPage() {
  const { selectedPatient } = usePatient();
  const navigate = useNavigate();
  const [studies, setStudies] = useState<any[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<number | null>(null);
  const [doc, setDoc] = useState<any>(null);
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const refresh = useCallback(() => {
    if (!selectedPatient) {
      setStudies([]);
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    api.get("/imaging", { params: { patient_id: selectedPatient.id } })
      .then((res) => {
        setStudies(res.data.items || []);
        setLoadingList(false);
      });
  }, [selectedPatient]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Lightweight doc update — merges fields without a full reload (preserves scroll).
  const updateDocFields = (updated?: any) => {
    if (updated) setDoc((prev: any) => ({ ...prev, ...updated }));
  };

  const reloadDoc = useCallback(async (documentId: number) => {
    setLoadingDoc(true);
    try {
      const res = await api.get(`/documents/${documentId}`);
      setDoc(res.data);
      setLinkedDocs(res.data.links || []);
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  const loadStudy = async (studyId: number) => {
    setSelectedStudyId(studyId);
    const res = await api.get(`/imaging/${studyId}`);
    if (res.data?.document_id) {
      await reloadDoc(res.data.document_id);
    }
  };

  const handleDelete = async () => {
    if (!doc?.id) return;
    if (!window.confirm(
      "Delete this imaging study? All frames, bundle files, and links will be removed.",
    )) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      setDoc(null);
      setSelectedStudyId(null);
      setLinkedDocs([]);
      refresh();
    } catch (e: any) {
      alert(`Delete failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  if (!selectedPatient) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <Image className="h-8 w-8" />
        <p>Select a patient to view imaging studies</p>
      </div>
    );
  }

  const headlineStudy = doc?.imaging_studies?.[0];

  return (
    <div className="space-y-4">
      <FileUpload onUploadComplete={refresh} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* Study list */}
        <div className="space-y-3">
          {loadingList ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : studies.length === 0 ? (
            <p className="text-muted-foreground">No imaging studies found</p>
          ) : (
            studies.map((study) => (
              <button
                key={study.id}
                onClick={() => loadStudy(study.id)}
                className={`w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent/50 ${
                  selectedStudyId === study.id ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {modalityLabel(study.modality)} - {study.body_part || "Unknown"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {study.study_date || "Unknown date"} | {study.institution_name || "Unknown institution"}
                    </p>
                    {study.study_description && (
                      <p className="text-xs text-muted-foreground truncate">{study.study_description}</p>
                    )}
                  </div>
                  <div className="text-right text-sm text-muted-foreground flex-shrink-0 ml-2">
                    <p>{study.num_series} series</p>
                    <p>{study.num_images} images</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right column: identical to the right column of DocumentDetailPage,
            so editing parity is exact. */}
        {!doc ? (
          selectedStudyId == null ? (
            <div className="rounded-lg border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Select a study on the left to view and edit its metadata.
            </div>
          ) : (
            <div className="text-muted-foreground p-4">
              {loadingDoc ? "Loading study..." : "No document for this study"}
            </div>
          )
        ) : (
          <div className="space-y-4 min-w-0">
            {/* Header line — modality + dates + manage actions, mirroring
                the title row on DocumentDetailPage. */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">
                  {modalityLabel(headlineStudy?.modality)}
                  {headlineStudy?.body_part ? ` - ${headlineStudy.body_part}` : ""}
                  {headlineStudy?.study_date ? ` - ${headlineStudy.study_date}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {doc.original_filename} | {doc.patient_name || "Unclassified"}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/documents/${doc.id}`}
                  title="Open full document view"
                  className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <Pencil className="h-4 w-4" />
                  Open in document view
                </Link>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            </div>

            <EditableSummary value={doc.summary_en} docId={doc.id} onSave={updateDocFields} />

            <ImagingStudiesSection studies={doc.imaging_studies || []} />

            <MetadataEditor doc={doc} onSave={updateDocFields} />

            <EventSelector
              docId={doc.id}
              patientId={doc.patient_id}
              currentEventId={doc.event_id}
              onUpdate={(eventId) => setDoc((prev: any) => ({ ...prev, event_id: eventId }))}
            />

            <NotesEditor docId={doc.id} initialNotes={doc.user_notes || ""} />

            <LinksSection
              docId={doc.id}
              patientId={doc.patient_id}
              links={linkedDocs}
              onLinksChange={setLinkedDocs}
            />

            <p className="text-xs text-muted-foreground">
              Need to reprocess, rotate, or run AI edits? Use{" "}
              <button
                onClick={() => navigate(`/documents/${doc.id}`)}
                className="underline hover:text-foreground"
              >
                the full document view
              </button>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
