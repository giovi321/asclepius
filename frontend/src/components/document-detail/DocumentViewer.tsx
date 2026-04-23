import { FileText, Download } from "lucide-react";
import PdfViewer from "@/components/PdfViewer";

export interface DocumentViewerProps {
  id: number | string;
  filePath: string | null | undefined;
  originalFilename: string | null | undefined;
  onRotate: (degrees: number, pages: number[] | null) => Promise<void>;
}

/**
 * Left-column preview on the Document Detail page. Shows a PDF viewer,
 * an image, or a download fallback depending on the file extension.
 */
export default function DocumentViewer({ id, filePath, originalFilename, onRotate }: DocumentViewerProps) {
  const fp = (filePath || "").toLowerCase();
  const fn = (originalFilename || "").toLowerCase();
  if (fp.endsWith(".pdf") || fn.endsWith(".pdf")) {
    return (
      <div className="rounded-lg border overflow-hidden h-[700px]">
        <PdfViewer key={`pdf-${id}`} url={`/api/documents/${id}/file`} onRotate={onRotate} />
      </div>
    );
  }
  if (fp.match(/\.(jpg|jpeg|png|tiff|tif)$/i)) {
    return (
      <div className="rounded-lg border overflow-hidden">
        <img
          src={`/api/documents/${id}/file`}
          alt={originalFilename || undefined}
          className="w-full object-contain max-h-[700px]"
        />
      </div>
    );
  }
  return (
    <div className="rounded-lg border p-8 text-center text-muted-foreground">
      <FileText className="h-12 w-12 mx-auto mb-2" />
      <p>Preview not available for this file type</p>
      <a
        href={`/api/documents/${id}/file`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 mt-2 text-sm text-primary hover:underline"
      >
        <Download className="h-4 w-4" /> Download file
      </a>
    </div>
  );
}
