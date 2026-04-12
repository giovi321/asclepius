import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, RotateCcw } from "lucide-react";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Set worker source
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  /** Called when user clicks a rotate button. Receives degrees (90 or 270) and page numbers (null = all). */
  onRotate?: (degrees: number, pages: number[] | null) => Promise<void>;
}

export default function PdfViewer({ url, onRotate }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [pdfKey, setPdfKey] = useState(0); // force re-render after rotation

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    if (pageNumber > numPages) setPageNumber(1);
    setError(null);
  };

  const onDocumentLoadError = () => {
    setError("Failed to load PDF");
  };

  const handleRotate = async (degrees: number, mode: "page" | "all") => {
    if (!onRotate || rotating) return;
    setRotating(true);
    try {
      const pages = mode === "page" ? [pageNumber] : null;
      await onRotate(degrees, pages);
      // Force PDF reload after rotation
      setPdfKey((k) => k + 1);
    } catch {
      // parent handles errors
    }
    setRotating(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/30 gap-2 flex-wrap">
        {/* Page navigation */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className="rounded p-1.5 hover:bg-accent disabled:opacity-30"
            title="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground min-w-[60px] text-center">
            {pageNumber} / {numPages}
          </span>
          <button
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            disabled={pageNumber >= numPages}
            className="rounded p-1.5 hover:bg-accent disabled:opacity-30"
            title="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Zoom + Rotate */}
        <div className="flex items-center gap-1">
          {/* Zoom */}
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            className="rounded p-1.5 hover:bg-accent"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground min-w-[40px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(3.0, s + 0.2))}
            className="rounded p-1.5 hover:bg-accent"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          {/* Rotate controls */}
          {onRotate && (
            <>
              <div className="w-px h-5 bg-border mx-1.5" />

              <button
                onClick={() => handleRotate(270, "page")}
                disabled={rotating}
                className="rounded p-1.5 hover:bg-accent disabled:opacity-30"
                title="Rotate this page 90° left"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleRotate(90, "page")}
                disabled={rotating}
                className="rounded p-1.5 hover:bg-accent disabled:opacity-30"
                title="Rotate this page 90° right"
              >
                <RotateCw className="h-4 w-4" />
              </button>

              {/* Dropdown for "all pages" rotate */}
              <div className="relative group">
                <button
                  disabled={rotating}
                  className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 transition-colors"
                  title="Rotate all pages"
                >
                  All
                </button>
                <div className="absolute right-0 top-full mt-1 hidden group-hover:flex z-10 rounded-lg border bg-popover p-1 shadow-lg gap-1">
                  <button
                    onClick={() => handleRotate(270, "all")}
                    disabled={rotating}
                    className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs hover:bg-accent whitespace-nowrap disabled:opacity-30"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> All 90° left
                  </button>
                  <button
                    onClick={() => handleRotate(90, "all")}
                    disabled={rotating}
                    className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs hover:bg-accent whitespace-nowrap disabled:opacity-30"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> All 90° right
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* PDF display */}
      <div className="flex-1 overflow-auto flex justify-center bg-muted/20 p-4">
        {error ? (
          <div className="text-destructive text-sm py-8">{error}</div>
        ) : (
          <Document
            key={pdfKey}
            file={pdfKey > 0 ? `${url}${url.includes("?") ? "&" : "?"}t=${pdfKey}` : url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="text-muted-foreground text-sm py-8">Loading PDF...</div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          </Document>
        )}
      </div>
    </div>
  );
}
