import { useEffect, useState } from "react";
import api from "@/api/client";
import {
  RotateCcw,
  Trash2,
  Power,
  AlertTriangle,
  Loader2,
  Play,
} from "lucide-react";
import {
  SettingsForm,
  NumberField,
  SelectField,
  useSettingsSave,
} from "./SettingsFormHelpers";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useSettings } from "@/hooks/data";

export default function PipelineTab() {
  const { data: settingsData } = useSettings();
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { toast } = useToast();
  const confirm = useConfirm();
  const { saving, saved, save } = useSettingsSave();
  const [failedDocs, setFailedDocs] = useState<any[]>([]);
  const [retryingAll, setRetryingAll] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<any>(null);
  const [startingPipeline, setStartingPipeline] = useState(false);

  const loadStatus = () => {
    api
      .get("/pipeline/status")
      .then((res) => setPipelineStatus(res.data))
      .catch(() => {});
  };

  useEffect(() => {
    if (!settingsData) return;
    setS(settingsData);
    setF({
      pipeline_watch_enabled: settingsData.pipeline.watch_enabled,
      pipeline_poll_interval: settingsData.pipeline.poll_interval_seconds,
      pipeline_retry_interval: settingsData.pipeline.retry_interval_seconds,
      pipeline_max_retries: settingsData.pipeline.max_retries,
      pipeline_default_flow: settingsData.pipeline.default_flow || "ocr_llm",
      session_ttl_hours: settingsData.auth.session_ttl_hours,
    });
  }, [settingsData]);

  useEffect(() => {
    loadFailed();
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadFailed = () => {
    api
      .get("/documents/failed")
      .then((res) => setFailedDocs(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  };

  const retryDoc = async (docId: number) => {
    await api.post(`/documents/${docId}/reprocess`);
    loadFailed();
  };

  const retryAllFailed = async () => {
    setRetryingAll(true);
    try {
      await api.post("/documents/retry-all-failed");
      setTimeout(loadFailed, 2000);
    } catch {
      toast({ title: "Failed to retry", variant: "error" });
    }
    setRetryingAll(false);
  };

  const deleteDoc = async (docId: number) => {
    const ok = await confirm({
      title: "Delete this document?",
      description:
        "The file will be removed from disk and cannot be recovered.",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/documents/${docId}`);
    loadFailed();
  };

  if (!s) return <div className="text-muted-foreground">Loading...</div>;

  const startPipeline = async () => {
    setStartingPipeline(true);
    try {
      await api.post("/pipeline/start");
      // Also update the setting so it persists across restarts
      await api.patch("/settings", { pipeline_watch_enabled: true });
      setF((prev: any) => ({ ...prev, pipeline_watch_enabled: true }));
      setTimeout(loadStatus, 1000);
    } catch {
      toast({ title: "Failed to start pipeline", variant: "error" });
    }
    setStartingPipeline(false);
  };

  const stopPipeline = async () => {
    setStartingPipeline(true);
    try {
      await api.post("/pipeline/stop");
      await api.patch("/settings", { pipeline_watch_enabled: false });
      setF((prev: any) => ({ ...prev, pipeline_watch_enabled: false }));
      setTimeout(loadStatus, 1000);
    } catch {
      toast({ title: "Failed to stop pipeline", variant: "error" });
    }
    setStartingPipeline(false);
  };

  const isActive = pipelineStatus?.watcher_active;

  return (
    <div className="space-y-6">
      {/* Auto-stop warning banner */}
      {pipelineStatus?.auto_stopped && (
        <div className="rounded-lg border border-warning/40 bg-warning-soft p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-warning">
              Pipeline automatically paused
            </p>
            <p className="text-sm text-warning/90 mt-1">
              {pipelineStatus.auto_stop_reason ||
                "All providers appear unreachable after consecutive failures."}{" "}
              Check your provider settings and restart when ready.
            </p>
          </div>
          <button
            onClick={startPipeline}
            disabled={startingPipeline}
            className="flex items-center gap-1.5 rounded-md bg-warning px-3 py-1.5 text-sm font-medium text-white hover:bg-warning/90 disabled:opacity-50 flex-shrink-0 coarse:min-h-11"
          >
            {startingPipeline ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Restart
          </button>
        </div>
      )}

      {/* Pipeline status & controls */}
      {pipelineStatus && (
        <div
          className={`rounded-lg border-2 p-5 ${
            isActive
              ? "border-success/40 bg-success-soft/50"
              : "border-border bg-muted/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className={`flex items-center justify-center h-10 w-10 rounded-full ${
                  isActive
                    ? "bg-success-soft"
                    : "bg-muted"
                }`}
              >
                {isActive ? (
                  <Play className="h-5 w-5 text-success" />
                ) : (
                  <Power className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      isActive ? "bg-success animate-pulse" : "bg-muted-foreground/50"
                    }`}
                  />
                  <span className="font-semibold">
                    {isActive ? "Pipeline Running" : "Pipeline Stopped"}
                  </span>
                </div>
                {isActive && pipelineStatus.processing ? (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Processing:{" "}
                    <span className="font-medium">
                      {pipelineStatus.processing}
                    </span>
                    {pipelineStatus.processing_step && (
                      <span className="ml-1 text-xs">
                        ({pipelineStatus.processing_step})
                      </span>
                    )}
                  </p>
                ) : isActive ? (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Watching inbox for new documents
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Documents in inbox will not be processed
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right text-xs text-muted-foreground mr-2">
                <div>
                  Processed:{" "}
                  <span className="font-medium">
                    {pipelineStatus.total_processed}
                  </span>
                </div>
                {pipelineStatus.total_errors > 0 && (
                  <div className="text-destructive">
                    Errors: {pipelineStatus.total_errors}
                  </div>
                )}
              </div>
              {isActive ? (
                <button
                  onClick={stopPipeline}
                  disabled={startingPipeline}
                  className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors coarse:min-h-11"
                >
                  {startingPipeline ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                  Stop Pipeline
                </button>
              ) : (
                <button
                  onClick={startPipeline}
                  disabled={startingPipeline}
                  className="flex items-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white hover:bg-success/90 disabled:opacity-50 transition-colors coarse:min-h-11"
                >
                  {startingPipeline ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Start Pipeline
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <SettingsForm
        title="Pipeline Settings"
        saving={saving}
        saved={saved}
        onSave={() =>
          save({
            pipeline_poll_interval:
              f.pipeline_poll_interval !== s.pipeline.poll_interval_seconds
                ? f.pipeline_poll_interval
                : undefined,
            pipeline_retry_interval:
              f.pipeline_retry_interval !== s.pipeline.retry_interval_seconds
                ? f.pipeline_retry_interval
                : undefined,
            pipeline_max_retries:
              f.pipeline_max_retries !== s.pipeline.max_retries
                ? f.pipeline_max_retries
                : undefined,
            pipeline_default_flow:
              f.pipeline_default_flow !== (s.pipeline.default_flow || "ocr_llm")
                ? f.pipeline_default_flow
                : undefined,
            session_ttl_hours:
              f.session_ttl_hours !== s.auth.session_ttl_hours
                ? f.session_ttl_hours
                : undefined,
          })
        }
      >
        <SelectField
          label="Default Processing Flow"
          value={f.pipeline_default_flow || "ocr_llm"}
          onChange={(v) => setF({ ...f, pipeline_default_flow: v })}
          options={[
            { value: "ocr_llm", label: "OCR + LLM (text pipeline)" },
            { value: "vision_llm", label: "Vision-LLM (single-step)" },
          ]}
        />
        <NumberField
          label="Poll Interval (seconds)"
          value={f.pipeline_poll_interval}
          onChange={(v) => setF({ ...f, pipeline_poll_interval: v })}
          min={1}
          max={60}
          step={1}
        />
        <NumberField
          label="Retry Interval (seconds)"
          value={f.pipeline_retry_interval}
          onChange={(v) => setF({ ...f, pipeline_retry_interval: v })}
          min={60}
          max={3600}
          step={60}
        />
        <NumberField
          label="Max Retries"
          value={f.pipeline_max_retries}
          onChange={(v) => setF({ ...f, pipeline_max_retries: v })}
          min={0}
          max={10}
          step={1}
        />
        <NumberField
          label="Session TTL (hours)"
          value={f.session_ttl_hours}
          onChange={(v) => setF({ ...f, session_ttl_hours: v })}
          min={1}
          max={8760}
          step={1}
        />
      </SettingsForm>

      {/* Failed Documents Queue */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            Failed Documents
            {failedDocs.length > 0 && (
              <span className="ml-2 rounded-full bg-destructive-soft px-2 py-0.5 text-xs font-medium text-destructive">
                {failedDocs.length}
              </span>
            )}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={loadFailed}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              Refresh
            </button>
            {failedDocs.length > 0 && (
              <button
                onClick={retryAllFailed}
                disabled={retryingAll}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />{" "}
                {retryingAll ? "Retrying..." : "Retry All"}
              </button>
            )}
          </div>
        </div>

        {failedDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No failed documents. All good!
          </p>
        ) : (
          <div className="rounded-lg border divide-y max-h-[400px] overflow-y-auto">
            {failedDocs.map((doc) => (
              <div key={doc.id} className="p-3 space-y-1.5 hover:bg-accent/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">
                      {doc.original_filename}
                    </span>
                    {doc.patient_name && (
                      <span className="text-xs text-muted-foreground">
                        ({doc.patient_name})
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        doc.status === "failed"
                          ? "bg-destructive-soft text-destructive"
                          : "bg-warning-soft text-warning"
                      }`}
                    >
                      {doc.status}
                    </span>
                    {doc.retry_count > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {doc.retry_count} retries
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => retryDoc(doc.id)}
                      className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      <RotateCcw className="h-3 w-3" /> Retry
                    </button>
                    <button
                      onClick={() => deleteDoc(doc.id)}
                      className="flex items-center justify-center rounded p-1 text-muted-foreground hover:text-destructive coarse:min-h-11 coarse:min-w-11"
                      aria-label="Delete document"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {doc.error_message && (
                  <div className="rounded-md bg-destructive-soft px-3 py-2 text-xs text-destructive font-mono break-all">
                    {doc.error_message}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  Last attempt: {doc.updated_at?.replace("T", " ").slice(0, 19)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
