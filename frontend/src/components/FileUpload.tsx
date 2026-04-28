import { useCallback, useRef, useState } from "react";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Upload, CheckCircle, AlertCircle, X, Calendar } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import { usePatients, useEvents } from "@/hooks/data";

interface FileUploadProps {
  onUploadComplete?: () => void;
}

interface UploadResult {
  filename: string;
  status: string;
  suggestion?: string;
  message?: string;
  queue_size?: number;
  // Returned when the upload was a zip bundle (e.g. a DICOM exam):
  // the server extracted N members and queued each one for processing.
  extracted?: number;
  dicom?: number;
  other?: number;
}

export default function FileUpload({ onUploadComplete }: FileUploadProps) {
  const { selectedPatient } = usePatient();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; failures?: { file: string; reason: string }[] } | null>(null);
  const [showFailures, setShowFailures] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [showPatientPrompt, setShowPatientPrompt] = useState(false);
  // Synchronous re-entry guard. ``uploading`` (state) only flips on
  // the next render, so two onClicks fired in the same frame both see
  // ``uploading === false`` and would each kick off a full upload of
  // the same files. The ref short-circuits the second call before the
  // network request goes out.
  const uploadInFlightRef = useRef(false);
  const { data: patientsData } = usePatients();
  const patients = Array.isArray(patientsData) ? patientsData : [];
  const [chosenPatientId, setChosenPatientId] = useState<string>("");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [uploadedDocIds, setUploadedDocIds] = useState<number[]>([]);
  const [uploadedCount, setUploadedCount] = useState(0);

  const { data: eventsData } = useEvents({
    patientId: selectedPatient?.id,
    enabled: !!selectedPatient,
  });
  const events = Array.isArray(eventsData) ? eventsData : [];
  const [chosenEventId, setChosenEventId] = useState<string>("");

  const scheduleBatch = useCallback(
    async (processAt: string | null) => {
      if (uploadedDocIds.length === 0) return;
      try {
        await api.post("/documents/schedule-batch", {
          document_ids: uploadedDocIds,
          process_at: processAt,
        });
        setResult({
          ok: true,
          message: processAt
            ? `${uploadedDocIds.length} file(s) scheduled for later processing`
            : `${uploadedDocIds.length} file(s) queued for immediate processing`,
        });
      } catch {
        setResult({ ok: false, message: "Failed to schedule batch" });
      }
      setShowScheduleDialog(false);
      setUploadedDocIds([]);
    },
    [uploadedDocIds]
  );

  const doUpload = useCallback(
    async (files: File[], patientId: number | null, eventId: number | null = null) => {
      if (uploadInFlightRef.current) return;
      uploadInFlightRef.current = true;
      setUploading(true);
      setResult(null);
      setShowPatientPrompt(false);
      setPendingFiles(null);

      let successCount = 0;
      let errorCount = 0;
      let hasSuggestion = false;
      let zipExtracted = 0;
      let zipDicom = 0;
      let zipOther = 0;
      let sawZip = false;
      const failures: { file: string; reason: string }[] = [];
      for (const file of files) {
        try {
          const form = new FormData();
          form.append("file", file);
          const qp = new URLSearchParams();
          if (patientId) qp.set("patient_id", String(patientId));
          if (eventId) qp.set("event_id", String(eventId));
          const params = qp.toString() ? `?${qp.toString()}` : "";
          const res = await api.post(`/documents/upload${params}`, form, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          successCount++;
          const data = res.data as UploadResult;
          if (data.suggestion === "batch_schedule") {
            hasSuggestion = true;
          }
          if (typeof data.extracted === "number") {
            sawZip = true;
            zipExtracted += data.extracted;
            zipDicom += data.dicom || 0;
            zipOther += data.other || 0;
          }
        } catch (err: any) {
          // Capture as much detail as possible — backend returns
          // ``{detail: "..."}`` on validation errors; axios surfaces both
          // the response body and the wire error message.
          const detail = err?.response?.data?.detail;
          const reason = (typeof detail === "string" && detail)
            || err?.message
            || "Upload failed";
          failures.push({ file: file.name, reason });
          errorCount++;
        }
      }

      setUploading(false);
      uploadInFlightRef.current = false;
      setUploadedCount(successCount);
      setShowFailures(false);

      if (errorCount === 0) {
        const baseMsg = sawZip
          ? `Extracted ${zipExtracted} files (${zipDicom} DICOM frames, ${zipOther} other) and queued for processing`
          : `${successCount} file(s) uploaded`;
        setResult({ ok: true, message: baseMsg });
      } else {
        setResult({
          ok: false,
          message: `${successCount} uploaded, ${errorCount} failed`,
          failures,
        });
      }

      // If batch scheduling was suggested, fetch pending doc IDs and show dialog
      if (hasSuggestion && successCount > 0) {
        try {
          const docsRes = await api.get("/documents", { params: { status: "pending", limit: 100 } });
          const docs = Array.isArray(docsRes.data) ? docsRes.data : [];
          const ids = docs.map((d: any) => d.id);
          if (ids.length > 0) {
            setUploadedDocIds(ids);
            setShowScheduleDialog(true);
          }
        } catch {
          // Ignore — just don't show the dialog
        }
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
          <SearchableSelect
            value={chosenPatientId || null}
            onChange={(v) => setChosenPatientId(v || "")}
            options={patients.map((p) => ({ value: String(p.id), label: p.display_name }))}
            placeholder="No patient (process unassigned)"
          />
          <SearchableSelect
            value={chosenEventId || null}
            onChange={(v) => setChosenEventId(v || "")}
            options={events.map((ev) => ({
              value: String(ev.id),
              label: ev.title,
              hint: ev.event_type?.replace(/_/g, " "),
            }))}
            placeholder="No medical event"
          />
          <div className="flex gap-2">
            <button
              onClick={() => doUpload(pendingFiles, chosenPatientId ? Number(chosenPatientId) : null, chosenEventId ? Number(chosenEventId) : null)}
              disabled={uploading}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
            <button
              onClick={() => { setShowPatientPrompt(false); setPendingFiles(null); }}
              disabled={uploading}
              className="rounded-md border px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Batch schedule dialog */}
      {showScheduleDialog && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium">
              You uploaded {uploadedCount} file(s). Process now or schedule for later?
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Scheduling allows processing during off-peak hours to avoid slowdowns.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => scheduleBatch(null)}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Process Now
            </button>
            <button
              onClick={() => {
                const tonight = new Date();
                tonight.setHours(22, 0, 0, 0);
                if (tonight <= new Date()) tonight.setDate(tonight.getDate() + 1);
                scheduleBatch(tonight.toISOString());
              }}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              Schedule for Tonight (22:00)
            </button>
            <button
              onClick={() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(6, 0, 0, 0);
                scheduleBatch(tomorrow.toISOString());
              }}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              Schedule for Tomorrow (06:00)
            </button>
            <button
              onClick={() => { setShowScheduleDialog(false); setUploadedDocIds([]); }}
              className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Dismiss
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
                  accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.dcm,.zip"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />
              </label>
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, JPEG, PNG, TIFF, DICOM, ZIP (DICOM bundle)
              {selectedPatient && (
                <span className="ml-1">
                  — assigning to <strong>{selectedPatient.display_name}</strong>
                </span>
              )}
            </p>
            {selectedPatient && events.length > 0 && (
              <div className="mt-2 inline-block text-left min-w-[220px]">
                <SearchableSelect
                  value={chosenEventId || null}
                  onChange={(v) => setChosenEventId(v || "")}
                  options={events.map((ev) => ({
                    value: String(ev.id),
                    label: ev.title,
                    hint: ev.event_type?.replace(/_/g, " "),
                  }))}
                  placeholder="No medical event"
                />
              </div>
            )}
          </>
        )}

        {result && (
          <div className="mt-3 space-y-2">
            <div className={`flex items-center justify-center gap-2 text-sm ${
              result.ok ? "text-green-600" : "text-destructive"
            }`}>
              {result.ok ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {result.message}
              {result.failures && result.failures.length > 0 && (
                <button
                  onClick={() => setShowFailures((v) => !v)}
                  className="ml-1 underline text-xs"
                >
                  {showFailures ? "Hide" : "Show"} details
                </button>
              )}
              <button onClick={() => setResult(null)} className="ml-1"><X className="h-3 w-3" /></button>
            </div>
            {showFailures && result.failures && result.failures.length > 0 && (
              <ul className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs space-y-1 max-h-48 overflow-y-auto">
                {result.failures.map((f, i) => (
                  <li key={i} className="flex flex-col">
                    <span className="font-medium truncate">{f.file}</span>
                    <span className="text-muted-foreground">{f.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
