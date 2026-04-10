import { useCallback, useState } from "react";
import api from "@/api/client";
import { Upload, CheckCircle, AlertCircle, X } from "lucide-react";

interface FileUploadProps {
  onUploadComplete?: () => void;
}

export default function FileUpload({ onUploadComplete }: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setUploading(true);
      setResult(null);

      let successCount = 0;
      let errorCount = 0;

      for (const file of Array.from(files)) {
        try {
          const form = new FormData();
          form.append("file", file);
          await api.post("/documents/upload", form, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          successCount++;
        } catch {
          errorCount++;
        }
      }

      setUploading(false);

      if (errorCount === 0) {
        setResult({ ok: true, message: `${successCount} file(s) uploaded to inbox` });
      } else {
        setResult({
          ok: false,
          message: `${successCount} uploaded, ${errorCount} failed`,
        });
      }

      onUploadComplete?.();
    },
    [onUploadComplete]
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
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`relative rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
        dragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
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
          </p>
        </>
      )}

      {result && (
        <div
          className={`mt-3 flex items-center justify-center gap-2 text-sm ${
            result.ok ? "text-green-600" : "text-destructive"
          }`}
        >
          {result.ok ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {result.message}
          <button onClick={() => setResult(null)} className="ml-1">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
