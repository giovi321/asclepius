import { useState } from "react";
import api from "@/api/client";
import { Download } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

export default function BackupTab() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleBackup = async () => {
    setDownloading(true);
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
    setDownloading(false);
  };

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <h3 className="font-medium">Database Backup</h3>
      <p className="text-sm text-muted-foreground">
        Download a consistent snapshot of the SQLite database. This includes all documents metadata,
        patients, events, normalization mappings, and settings — everything except the actual files
        in the vault.
      </p>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>The backup uses SQLite's built-in backup API, so it's safe to download while the server is running.</p>
        <p>To do a full backup, also copy the <code>vault/</code> directory (contains the actual PDF/DICOM files).</p>
      </div>
      <button
        onClick={handleBackup}
        disabled={downloading}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {downloading ? "Downloading..." : "Download Database Backup"}
      </button>
    </div>
  );
}
