import { useEffect, useState } from "react";
import api from "@/api/client";
import { Download, Play, Trash2, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import {
  SettingsForm, NumberField, SelectField, ToggleField, useSettingsSave,
} from "./SettingsFormHelpers";

type JobKind = "db" | "vault" | "full";

type JobState = {
  enabled: boolean;
  schedule: "hourly" | "daily" | "weekly";
  retention_count: number;
  retention_days: number;
};

type BackupState = {
  directory: string;
  db: JobState;
  vault: JobState;
  full: JobState;
  last_db_backup_at: string | null;
  last_vault_backup_at: string | null;
  last_full_backup_at: string | null;
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

const JOB_LABELS: Record<JobKind, { title: string; blurb: string }> = {
  db: {
    title: "Database backups",
    blurb: "SQLite snapshot only — small, fast, contains patients/documents metadata, audit log, and settings but not the vault files.",
  },
  vault: {
    title: "Vault backups (files only)",
    blurb: "Gzipped tarball of the vault directory (PDFs, DICOMs, images). Excludes the live database — pair with a DB backup, or use Full.",
  },
  full: {
    title: "Full backups (DB + vault)",
    blurb: "Gzipped tarball containing both a consistent DB snapshot and the vault directory. Heaviest option — run weekly or less.",
  },
};

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
  const [runningKind, setRunningKind] = useState<JobKind | null>(null);
  const [downloadingOneShot, setDownloadingOneShot] = useState(false);

  const loadSettings = async () => {
    const res = await api.get("/settings");
    const b: BackupState = res.data.backup;
    setState(b);
    setForm(structuredClone(b));
  };

  const loadFiles = async () => {
    try {
      const res = await api.get("/settings/backup/files");
      setFiles(res.data.files || []);
    } catch {
      // Directory may not exist yet; treat as empty.
      setFiles([]);
    }
  };

  useEffect(() => {
    loadSettings();
    loadFiles();
  }, []);

  if (!state || !form) return <div className="text-muted-foreground">Loading...</div>;

  const diffFor = (kind: JobKind): Record<string, any> => {
    const current = state[kind];
    const next = form[kind];
    const out: Record<string, any> = {};
    (Object.keys(next) as Array<keyof JobState>).forEach((k) => {
      if (next[k] !== current[k]) out[`backup_${kind}_${k}`] = next[k];
    });
    return out;
  };

  const saveJob = async (kind: JobKind) => {
    const updates = diffFor(kind);
    if (Object.keys(updates).length === 0) return;
    await save(updates);
    await loadSettings();
  };

  const runNow = async (kind: JobKind) => {
    setRunningKind(kind);
    try {
      const res = await api.post("/settings/backup/run", { kind });
      toast({ title: `Backup created: ${res.data.file}`, variant: "success" });
      await loadFiles();
      await loadSettings();
    } catch (e: any) {
      toast({
        title: `Backup failed: ${e?.response?.data?.detail ?? e?.message ?? "unknown"}`,
        variant: "error",
      });
    }
    setRunningKind(null);
  };

  const deleteFile = async (file: BackupFile) => {
    const ok = await confirm({
      title: `Delete ${file.name}?`,
      description: "This permanently removes the backup file from disk.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/settings/backup/files/${encodeURIComponent(file.name)}`);
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
      const response = await api.get("/settings/backup", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const filename = response.headers["content-disposition"]
        ?.split("filename=")[1]?.replace(/"/g, "")
        || `asclepius_backup_${new Date().toISOString().slice(0, 10)}.sqlite`;
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

  const updateJobField = <K extends keyof JobState>(kind: JobKind, field: K, value: JobState[K]) => {
    setForm((prev) => (prev ? { ...prev, [kind]: { ...prev[kind], [field]: value } } : prev));
  };

  const renderJobCard = (kind: JobKind, lastRun: string | null) => {
    const labels = JOB_LABELS[kind];
    const f = form[kind];
    const isRunning = runningKind === kind;
    return (
      <SettingsForm
        key={kind}
        title={labels.title}
        saving={saving}
        saved={saved}
        onSave={() => saveJob(kind)}
      >
        <p className="text-sm text-muted-foreground">{labels.blurb}</p>

        <ToggleField
          label="Enabled"
          value={f.enabled}
          onChange={(v) => updateJobField(kind, "enabled", v)}
          description="When on, the scheduler runs this job on its schedule in the background."
        />
        <SelectField
          label="Schedule"
          value={f.schedule}
          onChange={(v) => updateJobField(kind, "schedule", v as JobState["schedule"])}
          options={SCHEDULE_OPTIONS}
        />
        <NumberField
          label="Retention — keep last N backups"
          value={f.retention_count}
          onChange={(v) => updateJobField(kind, "retention_count", Math.max(1, Math.floor(v)))}
          min={1}
          max={365}
          step={1}
          description="Older files beyond this count are deleted after each run."
        />
        <NumberField
          label="Retention — max age (days)"
          value={f.retention_days}
          onChange={(v) => updateJobField(kind, "retention_days", Math.max(1, Math.floor(v)))}
          min={1}
          max={3650}
          step={1}
          description="Files older than this are deleted after each run. Both limits apply — whichever hits first."
        />

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>Last run: <span className="font-mono">{formatWhen(lastRun)}</span></span>
          <button
            type="button"
            onClick={() => runNow(kind)}
            disabled={isRunning}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {isRunning ? "Running..." : "Run now"}
          </button>
        </div>
      </SettingsForm>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Backup scheduler</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Scheduled backups are written to <code>{state.directory}</code>. You can also trigger any job
          manually with "Run now" below, or download the current database as a one-shot snapshot at the
          bottom of this page.
        </p>
      </div>

      {renderJobCard("db", state.last_db_backup_at)}
      {renderJobCard("vault", state.last_vault_backup_at)}
      {renderJobCard("full", state.last_full_backup_at)}

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
            No backup files yet. Enable a job or click "Run now" on one of the cards above.
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
                  <tr key={f.name} className="border-b last:border-0 hover:bg-accent/20">
                    <td className="py-2 pr-2 font-mono text-xs break-all">{f.name}</td>
                    <td className="py-2 pr-2 uppercase text-xs">{f.type}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">{formatSize(f.size)}</td>
                    <td className="py-2 pr-2 whitespace-nowrap font-mono text-xs">{f.created_at.replace("T", " ")}</td>
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
          Download a consistent SQLite snapshot right now, without saving it on the server. Handy for
          ad-hoc pulls; use the scheduler above for regular backups with retention.
        </p>
        <button
          onClick={downloadOneShot}
          disabled={downloadingOneShot}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {downloadingOneShot ? "Downloading..." : "Download Database Backup"}
        </button>
      </div>
    </div>
  );
}
