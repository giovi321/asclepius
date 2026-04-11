import { useCallback, useEffect, useState } from "react";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Upload, CheckCircle, AlertCircle, X } from "lucide-react";

interface FileUploadProps {
  onUploadComplete?: () => void;
}

export default function FileUpload({ onUploadComplete }: FileUploadProps) {
  const { selectedPatient } = usePatient();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [showPatientPrompt, setShowPatientPrompt] = useState(false);
  const [patients, setPatients] = useState<any[]>([]);
  const [chosenPatientId, setChosenPatientId] = useState<string>("");

  useEffect(() => {
    api.get("/patients").then((res) => {
      setPatients(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
  }, []);

  const [events, setEvents] = useState<any[]>([]);
  const [chosenEventId, setChosenEventId] = useState<string>("");

  useEffect(() => {
    if (selectedPatient) {
      api.get("/events", { params: { patient_id: selectedPatient.id } })
        .then((res) => setEvents(res.data || []))
        .catch(() => {});
    }
  }, [selectedPatient]);

  const doUpload = useCallback(
    async (files: File[], patientId: number | null, eventId: number | null = null) => {
      setUploading(true);
      setResult(null);
      setShowPatientPrompt(false);
      setPendingFiles(null);

      let successCount = 0;
      let errorCount = 0;

      for (const file of files) {
        try {
          const form = new FormData();
          form.append("file", file);
          const qp = new URLSearchParams();
          if (patientId) qp.set("patient_id", String(patientId));
          if (eventId) qp.set("event_id", String(eventId));
          const params = qp.toString() ? `?${qp.toString()}` : "";
          await api.post(`/documents/upload${params}`, form, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          successCount++;
        } catch {
          errorCount++;
        }
      }

      setUploading(false);

      if (errorCount === 0) {
        setResult({ ok: true, message: `${successCount} file(s) uploaded` });
      } else {
        setResult({ ok: false, message: `${successCount} uploaded, ${errorCount} failed` });
      }

      onUploadComplete?.();
    },
    [onUploadComplete]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (selectedPatient) {
        const eid = chosenEventId ? Number(chosenEventId) : null;
        doUpload(fileArray, selectedPatient.id, eid);
      } else {
        setPendingFiles(fileArray);
        setShowPatientPrompt(true);
      }
    },
    [selectedPatient, doUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  return (
    <div className="space-y-3">
      {/* Patient prompt */}
      {showPatientPrompt && pendingFiles && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-medium">
            Assign {pendingFiles.length} file(s) to a patient:
          </p>
          <select
            value={chosenPatientId}
            onChange={(e) => setChosenPatientId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">No patient (process unassigned)</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          <select
            value={chosenEventId}
            onChange={(e) => setChosenEventId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">No medical event (auto-assign later)</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.title} ({ev.event_type?.replace(/_/g, " ")})</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => doUpload(pendingFiles, chosenPatientId ? Number(chosenPatientId) : null, chosenEventId ? Number(chosenEventId) : null)}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Upload
            </button>
            <button
              onClick={() => { setShowPatientPrompt(false); setPendingFiles(null); }}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`relative rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }`}
      >
        {uploading ? (
          <div className="text-muted-foreground">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-sm">Uploading...</p>
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-1">
              Drag & drop files here, or{" "}
              <label className="text-primary cursor-pointer hover:underline">
                browse
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.dcm"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />
              </label>
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, JPEG, PNG, TIFF, DICOM
              {selectedPatient && (
                <span className="ml-1">
                  — assigning to <strong>{selectedPatient.display_name}</strong>
                </span>
              )}
            </p>
            {selectedPatient && events.length > 0 && (
              <select
                value={chosenEventId}
                onChange={(e) => setChosenEventId(e.target.value)}
                className="mt-2 rounded-md border bg-background px-2 py-1 text-xs"
              >
                <option value="">Medical event: auto-assign</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              </select>
            )}
          </>
        )}

        {result && (
          <div className={`mt-3 flex items-center justify-center gap-2 text-sm ${
            result.ok ? "text-green-600" : "text-destructive"
          }`}>
            {result.ok ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {result.message}
            <button onClick={() => setResult(null)} className="ml-1"><X className="h-3 w-3" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
