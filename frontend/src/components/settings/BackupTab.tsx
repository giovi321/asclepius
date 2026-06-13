import { useEffect, useState } from "react";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { Download, Play, Trash2, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import {
  SettingsForm,
  NumberField,
  SelectField,
  ToggleField,
  useSettingsSave,
} from "./SettingsFormHelpers";
import { useSettings } from "@/hooks/data";

type JobKind = "db" | "vault" | "full";
type Schedule = "hourly" | "daily" | "weekly";
type RetentionMode = "count" | "days";

type BackupState = {
  directory: string;
  enabled: boolean;
  include_database: boolean;
  include_vault: boolean;
  schedule: Schedule;
  retention_mode: RetentionMode;
  retention_value: number;
  last_backup_at: string | null;
};

type BackupFile = {
  name: string;
  size: number;
  created_at: string;
  type: JobKind;
};

const SCHEDULE_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const RETENTION_OPTIONS = [
  { value: "count", label: "Keep the last N backups" },
  { value: "days", label: "Keep backups newer than N days" },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[i]}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  return iso.replace("T", " ");
}

export default function BackupTab() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { saving, saved, save } = useSettingsSave();

  const [state, setState] = useState<BackupState | null>(null);
  const [form, setForm] = useState<BackupState | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [running, setRunning] = useState(false);
  const [downloadingOneShot, setDownloadingOneShot] = useState(false);
  const { data: settingsData, refetch: refetchSettings } = useSettings();

  useEffect(() => {
    if (!settingsData) return;
    const b: BackupState = settingsData.backup;
    setState(b);
    setForm(structuredClone(b));
  }, [settingsData]);

  const loadSettings = async () => {
    await refetchSettings();
  };

  const loadFiles = async () => {
    try {
      const res = await api.get("/settings/backup/files");
      setFiles(res.data.files || []);
    } catch {
      setFiles([]);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  if (!state || !form)
    return <div className="text-muted-foreground">Loading...</div>;

  const scopeOk = form.include_database || form.include_vault;

  const changedUpdates = (): Record<string, any> => {
    const out: Record<string, any> = {};
    const keys: (keyof BackupState)[] = [
      "enabled",
      "include_database",
      "include_vault",
      "schedule",
      "retention_mode",
      "retention_value",
    ];
    keys.forEach((k) => {
      if (form[k] !== state[k]) out[`backup_${k}`] = form[k];
    });
    return out;
  };

  const saveJob = async () => {
    if (!scopeOk) {
      toast({
        title: "Select at least one of Database or Vault",
        variant: "error",
      });
      return;
    }
    const updates = changedUpdates();
    if (Object.keys(updates).length === 0) return;
    await save(updates);
    await loadSettings();
  };

  const runNow = async () => {
    if (!scopeOk) {
      toast({
        title: "Select at least one of Database or Vault",
        variant: "error",
      });
      return;
    }
    setRunning(true);
    try {
      const res = await api.post("/settings/backup/run", {});
      toast({ title: `Backup created: ${res.data.file}`, variant: "success" });
      await loadFiles();
      await loadSettings();
    } catch (e: any) {
      toast({
        title: `Backup failed: ${getErrorMessage(e, "unknown")}`,
        variant: "error",
      });
    }
    setRunning(false);
  };

  const deleteFile = async (file: BackupFile) => {
    const ok = await confirm({
      title: `Delete ${file.name}?`,
      description: "This permanently removes the backup file from disk.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(
        `/settings/backup/files/${encodeURIComponent(file.name)}`,
      );
      await loadFiles();
    } catch {
      toast({ title: "Delete failed", variant: "error" });
    }
  };

  const downloadFile = async (file: BackupFile) => {
    try {
      const response = await api.get(
        `/settings/backup/files/${encodeURIComponent(file.name)}`,
        { responseType: "blob" },
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", file.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "error" });
    }
  };

  const downloadOneShot = async () => {
    setDownloadingOneShot(true);
    try {
      const response = await api.get("/settings/backup", {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const filename =
        response.headers["content-disposition"]
          ?.split("filename=")[1]
          ?.replace(/"/g, "") ||
        `asclepius_backup_${new Date().toISOString().slice(0, 10)}.sqlite`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Backup failed", variant: "error" });
    }
    setDownloadingOneShot(false);
  };

  const retentionLabel =
    form.retention_mode === "count"
      ? "Number of backups to keep"
      : "Age limit in days";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Scheduled backups</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Files are written to <code>{state.directory}</code>. Pick what to back
          up, how often, and a single retention strategy.
        </p>
      </div>

      <SettingsForm
        title="Backup job"
        saving={saving}
        saved={saved}
        onSave={saveJob}
      >
        <ToggleField
          label="Enabled"
          value={form.enabled}
          onChange={(v) => setForm({ ...form, enabled: v })}
          description="When on, the scheduler runs this job in the background on the chosen interval."
        />

        <div className="space-y-2">
          <span className="text-sm font-medium">What to back up</span>
          <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.include_database}
                onChange={(e) =>
                  setForm({ ...form, include_database: e.target.checked })
                }
                className="h-4 w-4 rounded"
              />
              <span>Database (SQLite snapshot)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.include_vault}
                onChange={(e) =>
                  setForm({ ...form, include_vault: e.target.checked })
                }
                className="h-4 w-4 rounded"
              />
              <span>Vault (document files)</span>
            </label>
          </div>
          {!scopeOk && (
            <p className="text-xs text-destructive">Select at least one.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Selecting both produces a single combined archive.
          </p>
        </div>

        <SelectField
          label="Schedule"
          value={form.schedule}
          onChange={(v) => setForm({ ...form, schedule: v as Schedule })}
          options={SCHEDULE_OPTIONS}
        />

        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <span className="text-sm font-medium">Retention strategy</span>
          <p className="text-xs text-muted-foreground">
            Pick one strategy. The other is ignored.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            {RETENTION_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="retention_mode"
                  value={opt.value}
                  checked={form.retention_mode === opt.value}
                  onChange={() =>
                    setForm({
                      ...form,
                      retention_mode: opt.value as RetentionMode,
                    })
                  }
                  className="h-4 w-4"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
          <div className="pt-2">
            <NumberField
              label={retentionLabel}
              value={form.retention_value}
              onChange={(v) =>
                setForm({
                  ...form,
                  retention_value: Math.max(1, Math.floor(v)),
                })
              }
              min={1}
              max={3650}
              step={1}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>
            Last run:{" "}
            <span className="font-mono">
              {formatWhen(state.last_backup_at)}
            </span>
          </span>
          <button
            type="button"
            onClick={runNow}
            disabled={running || !scopeOk}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {running ? "Running..." : "Run now"}
          </button>
        </div>
      </SettingsForm>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            Backup files
            {files.length > 0 && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {files.length}
              </span>
            )}
          </h3>
          <button
            onClick={loadFiles}
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No backup files yet. Enable the job or click &quot;Run now&quot;
            above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2 font-medium">Name</th>
                  <th className="py-2 pr-2 font-medium">Type</th>
                  <th className="py-2 pr-2 font-medium">Size</th>
                  <th className="py-2 pr-2 font-medium">Created</th>
                  <th className="py-2 pr-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr
                    key={f.name}
                    className="border-b last:border-0 hover:bg-accent/20"
                  >
                    <td className="py-2 pr-2 font-mono text-xs break-all">
                      {f.name}
                    </td>
                    <td className="py-2 pr-2 uppercase text-xs">{f.type}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {formatSize(f.size)}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap font-mono text-xs">
                      {f.created_at.replace("T", " ")}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => downloadFile(f)}
                          className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                          title="Download"
                        >
                          <Download className="h-3 w-3" /> Download
                        </button>
                        <button
                          onClick={() => deleteFile(f)}
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <h3 className="font-medium">One-shot database download</h3>
        <p className="text-sm text-muted-foreground">
          Download a consistent SQLite snapshot right now, without saving it on
          the server. Handy for ad-hoc pulls; use the scheduler above for
          regular backups with retention.
        </p>
        <button
          onClick={downloadOneShot}
          disabled={downloadingOneShot}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {downloadingOneShot ? "Downloading..." : "Download database backup"}
        </button>
      </div>
    </div>
  );
}
