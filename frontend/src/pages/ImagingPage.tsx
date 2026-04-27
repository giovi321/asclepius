import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Image, Pencil, Trash2, Link2, FileText, FileImage, Paperclip, X } from "lucide-react";
import DicomViewer from "@/components/DicomViewer";
import FileUpload from "@/components/FileUpload";
import SearchableSelect from "@/components/SearchableSelect";

// "Modality" is the DICOM standard term for imaging type (CT, MR, US, XR…).
// We surface it as "Type" in the UI because that's how clinicians read it.
const MODALITY_LABELS: Record<string, string> = {
  CT: "CT scan",
  MR: "MRI",
  US: "Ultrasound",
  XR: "X-ray",
  CR: "X-ray (computed)",
  DX: "X-ray (digital)",
  MG: "Mammography",
  PT: "PET",
  NM: "Nuclear medicine",
  RF: "Fluoroscopy",
  OT: "Other",
};

function modalityLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return MODALITY_LABELS[code.toUpperCase()] || code;
}

interface BundleFile {
  name: string;
  size: number;
  kind: string;
}

interface LinkedDoc {
  link_id: number;
  link_type: string;
  id: number;
  original_filename: string;
  doc_type: string | null;
  event_date: string | null;
}

export default function ImagingPage() {
  const { selectedPatient } = usePatient();
  const navigate = useNavigate();
  const [studies, setStudies] = useState<any[]>([]);
  const [viewingSeries, setViewingSeries] = useState<{ studyId: number; seriesId: number } | null>(null);
  const [selectedStudy, setSelectedStudy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bundleFiles, setBundleFiles] = useState<BundleFile[]>([]);
  const [linkedDocs, setLinkedDocs] = useState<LinkedDoc[]>([]);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkChoice, setLinkChoice] = useState<string>("");
  const [linkableDocs, setLinkableDocs] = useState<any[]>([]);

  const refresh = useCallback(() => {
    if (!selectedPatient) {
      setStudies([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .get("/imaging", { params: { patient_id: selectedPatient.id } })
      .then((res) => {
        setStudies(res.data.items || []);
        setLoading(false);
      });
  }, [selectedPatient]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadStudy = useCallback(async (studyId: number) => {
    const [studyRes, bundleRes, linksRes] = await Promise.all([
      api.get(`/imaging/${studyId}`),
      api.get(`/imaging/${studyId}/bundle-files`).catch(() => ({ data: { items: [] } })),
      api.get(`/imaging/${studyId}/links`).catch(() => ({ data: { items: [] } })),
    ]);
    setSelectedStudy(studyRes.data);
    setBundleFiles(bundleRes.data.items || []);
    setLinkedDocs(linksRes.data.items || []);
    // Auto-open the first series so the viewer pops up immediately.
    const series = studyRes.data.series || [];
    if (series.length > 0) {
      setViewingSeries({ studyId, seriesId: series[0].id });
    } else {
      setViewingSeries(null);
    }
  }, []);

  const handleDelete = async () => {
    if (!selectedStudy?.document_id) return;
    if (!window.confirm(
      `Delete this imaging study? All ${selectedStudy.num_images} frames, bundle files, and links will be removed.`,
    )) return;
    try {
      await api.delete(`/documents/${selectedStudy.document_id}`);
      setSelectedStudy(null);
      setViewingSeries(null);
      setBundleFiles([]);
      setLinkedDocs([]);
      refresh();
    } catch (e: any) {
      alert(`Delete failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  const openLinkPicker = async () => {
    if (!selectedPatient) return;
    setShowLinkPicker(true);
    try {
      // Pull the patient's documents minus the imaging study itself and any
      // already-linked targets so the picker only offers fresh choices.
      const res = await api.get("/documents", {
        params: { patient_id: selectedPatient.id, limit: 200 },
      });
      const all = Array.isArray(res.data) ? res.data : (res.data.items || []);
      const linkedIds = new Set(linkedDocs.map((d) => d.id));
      linkedIds.add(selectedStudy.document_id);
      setLinkableDocs(all.filter((d: any) => !linkedIds.has(d.id)));
    } catch {
      setLinkableDocs([]);
    }
  };

  const submitLink = async () => {
    if (!linkChoice || !selectedStudy) return;
    try {
      await api.post(`/imaging/${selectedStudy.id}/links`, {
        target_document_id: Number(linkChoice),
        link_type: "imaging_for",
      });
      setShowLinkPicker(false);
      setLinkChoice("");
      // Refresh just the links list.
      const res = await api.get(`/imaging/${selectedStudy.id}/links`);
      setLinkedDocs(res.data.items || []);
    } catch (e: any) {
      alert(`Link failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  const removeLink = async (linkId: number) => {
    if (!selectedStudy) return;
    try {
      await api.delete(`/imaging/${selectedStudy.id}/links/${linkId}`);
      setLinkedDocs((prev) => prev.filter((l) => l.link_id !== linkId));
    } catch (e: any) {
      alert(`Unlink failed: ${e?.response?.data?.detail || e.message}`);
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

  return (
    <div className="space-y-4">
      <FileUpload onUploadComplete={refresh} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Study list */}
        <div className="space-y-3">
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : studies.length === 0 ? (
            <p className="text-muted-foreground">No imaging studies found</p>
          ) : (
            studies.map((study) => (
              <button
                key={study.id}
                onClick={() => loadStudy(study.id)}
                className={`w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent/50 ${
                  selectedStudy?.id === study.id ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {modalityLabel(study.modality)} - {study.body_part || "Unknown"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {study.study_date || "Unknown date"} | {study.institution_name || "Unknown institution"}
                    </p>
                    {study.study_description && (
                      <p className="text-xs text-muted-foreground">{study.study_description}</p>
                    )}
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <p>{study.num_series} series</p>
                    <p>{study.num_images} images</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Study detail */}
        {selectedStudy && (
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-medium">
                {modalityLabel(selectedStudy.modality)} - {selectedStudy.study_description || "Study Detail"}
              </h3>
              <div className="flex items-center gap-1 flex-shrink-0">
                {selectedStudy.document_id && (
                  <Link
                    to={`/documents/${selectedStudy.document_id}`}
                    title="Edit metadata in document view"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                )}
                <button
                  onClick={openLinkPicker}
                  title="Link a document"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Link2 className="h-4 w-4" />
                </button>
                <button
                  onClick={handleDelete}
                  title="Delete this imaging study"
                  className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{selectedStudy.study_date || "Unknown"}</span></div>
              <div className="flex justify-between" title="DICOM modality (CT, MR, US…); shown as 'Type' for readability">
                <span className="text-muted-foreground">Type</span>
                <span>{modalityLabel(selectedStudy.modality)}{selectedStudy.modality ? ` (${selectedStudy.modality})` : ""}</span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Body Part</span><span>{selectedStudy.body_part || "Unknown"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Institution</span><span>{selectedStudy.institution_name || "Unknown"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Referring</span><span>{selectedStudy.referring_physician || "Unknown"}</span></div>
            </div>

            {selectedStudy.series?.length > 0 && (
              <div>
                <h4 className="mb-2 font-medium">Series</h4>
                {selectedStudy.series.map((s: any, idx: number) => (
                  <button
                    key={s.id}
                    onClick={() => setViewingSeries({ studyId: selectedStudy.id, seriesId: s.id })}
                    className={`flex w-full items-center justify-between border-b py-2 text-sm text-left hover:bg-accent/50 ${
                      viewingSeries?.seriesId === s.id ? "bg-primary/5 text-primary" : ""
                    }`}
                  >
                    <span>
                      Series {s.series_number ?? idx + 1}: {s.series_description || s.modality || "Untitled"}
                    </span>
                    <span className="text-muted-foreground">{s.num_images} images</span>
                  </button>
                ))}
              </div>
            )}

            {/* Linked documents */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  Linked documents
                </h4>
                <button
                  onClick={openLinkPicker}
                  className="text-xs text-primary hover:underline"
                >
                  Add link
                </button>
              </div>
              {linkedDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No linked documents</p>
              ) : (
                <ul className="space-y-1">
                  {linkedDocs.map((d) => (
                    <li key={d.link_id} className="flex items-center justify-between text-sm gap-2">
                      <button
                        onClick={() => navigate(`/documents/${d.id}`)}
                        className="flex items-center gap-1.5 text-left flex-1 min-w-0 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate">{d.original_filename}</span>
                      </button>
                      <button
                        onClick={() => removeLink(d.link_id)}
                        title="Remove link"
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {showLinkPicker && (
                <div className="mt-2 rounded-md border bg-card p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Pick a document to link to this imaging study:</p>
                  <SearchableSelect
                    value={linkChoice || null}
                    onChange={(v) => setLinkChoice(v || "")}
                    options={linkableDocs.map((d: any) => ({
                      value: String(d.id),
                      label: d.original_filename,
                      hint: [d.doc_type, d.event_date].filter(Boolean).join(" · "),
                    }))}
                    placeholder={linkableDocs.length ? "Select a document" : "No other documents for this patient"}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={submitLink}
                      disabled={!linkChoice}
                      className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
                    >
                      Link
                    </button>
                    <button
                      onClick={() => { setShowLinkPicker(false); setLinkChoice(""); }}
                      className="rounded-md border px-3 py-1 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bundle files (DICOMDIR + JPEG previews + LOCKFILE etc.) */}
            {bundleFiles.length > 0 && (
              <div>
                <h4 className="mb-2 font-medium flex items-center gap-1.5">
                  <FileImage className="h-3.5 w-3.5" />
                  Bundle files
                </h4>
                <ul className="max-h-40 overflow-y-auto space-y-0.5 text-xs">
                  {bundleFiles.map((f) => (
                    <li key={f.name} className="flex items-center justify-between">
                      <a
                        href={`/api/imaging/${selectedStudy.id}/bundle-file/${encodeURI(f.name)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate hover:underline text-primary"
                      >
                        {f.name}
                      </a>
                      <span className="text-muted-foreground tabular-nums ml-2">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* DICOM Viewer */}
      {viewingSeries && (
        <div className="rounded-lg border overflow-hidden h-[600px]">
          <DicomViewer
            studyId={viewingSeries.studyId}
            seriesId={viewingSeries.seriesId}
            modality={selectedStudy?.modality || null}
          />
        </div>
      )}
    </div>
  );
}
