import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Download, Image as ImageIcon, FileX2 } from "lucide-react";
import api from "@/api/client";
import PdfViewer from "@/components/PdfViewer";

export interface DocumentViewerProps {
  id: number | string;
  filePath: string | null | undefined;
  originalFilename: string | null | undefined;
  onRotate: (degrees: number, pages: number[] | null) => Promise<void>;
  /** When set, this document is the parent of a DICOM imaging study —
   * the preview fallback links into the Imaging view instead of just
   * offering a download. */
  imagingStudyId?: number | null;
}

/**
 * Left-column preview on the Document Detail page. Shows a PDF viewer,
 * an image, or a download fallback depending on the file extension. When
 * the document is the parent of an imaging study, the fallback turns
 * into a "switch to the imaging view" hint with a deep link.
 */
export default function DocumentViewer({
  id, filePath, originalFilename, onRotate, imagingStudyId,
}: DocumentViewerProps) {
  const fp = (filePath || "").toLowerCase();
  const fn = (originalFilename || "").toLowerCase();
  // HEAD-check the file before handing it to PdfViewer / <img>; pdf.js
  // surfaces "Missing PDF" as a hard error, and a broken <img> just
  // shows the alt text. Both are a worse UX than a small "file is
  // missing" card. The check runs only once per id.
  const [fileMissing, setFileMissing] = useState(false);
  useEffect(() => {
    if (!filePath) {
      setFileMissing(true);
      return;
    }
    let alive = true;
    setFileMissing(false);
    api.head(`/documents/${id}/file`).catch(() => {
      if (alive) setFileMissing(true);
    });
    return () => { alive = false; };
  }, [id, filePath]);

  if (fileMissing) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground space-y-2">
        <FileX2 className="h-12 w-12 mx-auto mb-2 text-amber-500" />
        <p className="text-foreground font-medium">File not available</p>
        <p className="text-sm">
          The document record exists but its file is missing on disk
          {filePath ? ` (${filePath})` : ""}.
        </p>
        {imagingStudyId && (
          <Link
            to={`/imaging/${imagingStudyId}`}
            className="inline-flex items-center gap-1 mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <ImageIcon className="h-4 w-4" /> Open in Imaging view
          </Link>
        )}
      </div>
    );
  }

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
  // Imaging-aware fallback: when this document represents the report-side
  // of a DICOM study but no PDF is attached yet (or the file just isn't
  // previewable), point the user at the Imaging view where the frames
  // and the upload-report flow live.
  if (imagingStudyId) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground space-y-2">
        <ImageIcon className="h-12 w-12 mx-auto mb-2 text-primary" />
        <p className="text-foreground font-medium">This document is the report for an imaging study</p>
        <p className="text-sm">
          Open the Imaging view to scroll through the DICOM frames, attach a PDF report,
          or change contrast on MRI series.
        </p>
        <Link
          to={`/imaging/${imagingStudyId}`}
          className="inline-flex items-center gap-1 mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <ImageIcon className="h-4 w-4" /> Open in Imaging view
        </Link>
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
