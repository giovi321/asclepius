import { useEffect, useRef, useState } from "react";
import { ChevronDown, Languages, Loader2, Crop, FileText } from "lucide-react";

import shareApi from "@/api/shareClient";

interface ShareTranslateMenuProps {
  documentId: number;
  hasFile: boolean;
  /** Page the doctor is currently viewing in the PDF. Used by the
   * "Translate current page" option. */
  currentPage: number;
  /** Called when the doctor picks "Translate selected region" — the
   * parent flips the viewer into selection mode and waits for a bbox
   * (it then calls /translate-region itself). */
  onStartRegionSelection: () => void;
  /** Called after a "current page" translate is queued so the parent
   * can refetch the document detail. */
  onQueued?: () => void;
}

/**
 * Translate trigger for the doctor share view.
 *
 * One button + a popover with two choices:
 *  - "Translate current page" — POSTs /translate-region with a
 *    full-page bbox so the existing region-translate pipeline handles
 *    it without a new endpoint.
 *  - "Translate selected region" — hands control to the parent, which
 *    enters selection mode in the viewer.
 *
 * Whole-document translate is intentionally absent from the doctor
 * surface (admin keeps that affordance).
 */
export default function ShareTranslateMenu({
  documentId,
  hasFile,
  currentPage,
  onStartRegionSelection,
  onQueued,
}: ShareTranslateMenuProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click-outside to dismiss the popover.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const onTranslateCurrentPage = async () => {
    setOpen(false);
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      // Reuse the region-translate endpoint with a full-page bbox.
      // The pipeline handles the cropping the same way; sharing the
      // endpoint keeps the rate-limit + audit accounting unified and
      // avoids a new code path.
      await shareApi.post(`/documents/${documentId}/translate-region`, {
        page: currentPage,
        bbox: { x: 0, y: 0, w: 1, h: 1 },
      });
      setMessage(
        `Translation of page ${currentPage} queued. The translation will appear under "Region translations" in a moment; refresh to see it.`,
      );
      onQueued?.();
    } catch (err: any) {
      const status = err?.response?.status;
      const retryAfter = err?.response?.headers?.["retry-after"];
      const detail = err?.response?.data?.detail;
      if (status === 429 && retryAfter) {
        setError(`Try again in ${retryAfter}s.`);
      } else if (status === 503) {
        setError(
          detail ||
            "Translation temporarily unavailable; ask the sender to retry later.",
        );
      } else if (detail) {
        setError(typeof detail === "string" ? detail : JSON.stringify(detail));
      } else {
        setError(
          `Translation request failed${status ? ` (HTTP ${status})` : ""}.`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onTranslateRegion = () => {
    setOpen(false);
    setError(null);
    setMessage(null);
    onStartRegionSelection();
  };

  return (
    <div className="space-y-2">
      <div className="relative inline-block" ref={popoverRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={submitting || !hasFile}
          title={
            hasFile ? undefined : "This document has no file to translate."
          }
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Translating...
            </>
          ) : (
            <>
              <Languages className="h-4 w-4" />
              Translate
              <ChevronDown className="h-3 w-3 opacity-60" />
            </>
          )}
        </button>
        {open && !submitting && (
          <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-lg border bg-background shadow-xl p-1.5 text-foreground">
            <button
              onClick={onTranslateCurrentPage}
              className="w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <FileText className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">Translate current page</div>
                <div className="text-xs text-muted-foreground">
                  Page {currentPage} only.
                </div>
              </div>
            </button>
            <button
              onClick={onTranslateRegion}
              className="w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Crop className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">Translate selected region</div>
                <div className="text-xs text-muted-foreground">
                  Drag a rectangle on the page.
                </div>
              </div>
            </button>
          </div>
        )}
      </div>
      {message && (
        <p className="text-xs text-muted-foreground max-w-md">{message}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
