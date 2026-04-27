import { useCallback, useEffect, useState } from "react";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Image } from "lucide-react";
import DicomViewer from "@/components/DicomViewer";
import FileUpload from "@/components/FileUpload";

export default function ImagingPage() {
  const { selectedPatient } = usePatient();
  const [studies, setStudies] = useState<any[]>([]);
  const [viewingSeries, setViewingSeries] = useState<{ studyId: number; seriesId: number } | null>(null);
  const [selectedStudy, setSelectedStudy] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  const loadStudy = async (studyId: number) => {
    const res = await api.get(`/imaging/${studyId}`);
    setSelectedStudy(res.data);
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
                      {study.modality || "Imaging"} - {study.body_part || "Unknown"}
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
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 font-medium">
              {selectedStudy.modality || "Imaging"} - {selectedStudy.study_description || "Study Detail"}
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{selectedStudy.study_date || "Unknown"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Modality</span><span>{selectedStudy.modality || "Unknown"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Body Part</span><span>{selectedStudy.body_part || "Unknown"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Institution</span><span>{selectedStudy.institution_name || "Unknown"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Referring</span><span>{selectedStudy.referring_physician || "Unknown"}</span></div>
            </div>

            {selectedStudy.series?.length > 0 && (
              <div className="mt-4">
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
          </div>
        )}
      </div>

      {/* DICOM Viewer */}
      {viewingSeries && (
        <div className="rounded-lg border overflow-hidden h-[600px]">
          <DicomViewer
            studyId={viewingSeries.studyId}
            seriesId={viewingSeries.seriesId}
          />
        </div>
      )}
    </div>
  );
}
