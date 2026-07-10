import { useEffect, useState } from "react";
import { ChevronDown, Languages, Loader2, Crop, FileText } from "lucide-react";

import shareApi from "@/api/shareClient";
import Sheet from "@/components/ui/Sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { useMediaQuery } from "@/hooks/useMediaQuery";

interface ShareTranslateMenuProps {
  documentId: number;
  hasFile: boolean;
  /** Page the doctor is currently viewing in the PDF. Used by the
   * "Translate current page" option. */
  currentPage: number;
  /** True iff at least one region_translation row on this document
   * is still waiting on the worker (translated_text == null). The
   * parent computes this; we use it to keep the trigger disabled
   * past the POST so the doctor can't queue a second job while one
   * is still processing. */
  translationPending?: boolean;
  /** Languages the doctor is allowed to pick from, sourced from
   * /share/me. The selected value is sent in the translate-region
   * body and recorded on each region_translations row. */
  allowedLanguages: string[];
  /** Default language for the picker on first render. */
  defaultLanguage: string;
  /** Currently-selected language. The parent owns the state so the
   * region-selection flow (which routes through onSelectionConfirm)
   * can read the same value the menu shows. */
  targetLanguage: string;
  onTargetLanguageChange: (lang: string) => void;
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
 * One button opening a menu (anchored popover from sm up, bottom sheet
 * below sm) with a language picker and two choices:
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
  translationPending = false,
  allowedLanguages,
  defaultLanguage,
  targetLanguage,
  onTargetLanguageChange,
  onStartRegionSelection,
  onQueued,
}: ShareTranslateMenuProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Same content, two presentations: anchored popover from sm up, bottom
  // sheet below (thumb-reachable, no cramped floating panel at 390px).
  const isSm = useMediaQuery("(min-width: 640px)");

  // Ensure the parent's selected language is always one we can actually
  // send; if the admin removed it from the allow-list since the doctor
  // first loaded the page, fall back to the default (which the backend
  // also enforces is in the allow-list).
  useEffect(() => {
    if (allowedLanguages.length === 0) return;
    if (!allowedLanguages.includes(targetLanguage)) {
      onTargetLanguageChange(
        allowedLanguages.includes(defaultLanguage)
          ? defaultLanguage
          : allowedLanguages[0],
      );
    }
  }, [
    allowedLanguages,
    defaultLanguage,
    targetLanguage,
    onTargetLanguageChange,
  ]);

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
        target_language: targetLanguage,
      });
      setMessage(
        `Translation of page ${currentPage} into ${targetLanguage} queued. The translation will appear under "Region translations" in a moment; refresh to see it.`,
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

  // The button stays disabled past the request-roundtrip — i.e. while
  // any region translation row on this doc is still missing its
  // translated_text. That covers the worker time after our POST has
  // already returned 200, which would otherwise let the doctor queue
  // a second translate while the first is still in flight.
  const isBusy = submitting || translationPending;
  const disabledReason = !hasFile
    ? "This document has no file to translate."
    : translationPending
      ? "A translation is in progress; please wait."
      : undefined;

  const showPicker = allowedLanguages.length > 1;

  // Identical action list rendered inside the sm+ popover and the
  // below-sm bottom sheet.
  const menuOptions = (
    <>
      <button
        onClick={onTranslateCurrentPage}
        className="w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent coarse:min-h-11"
      >
        <FileText className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">Translate current page</div>
          <div className="text-xs text-muted-foreground">
            Page {currentPage} into {targetLanguage}.
          </div>
        </div>
      </button>
      <button
        onClick={onTranslateRegion}
        className="w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent coarse:min-h-11"
      >
        <Crop className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">Translate selected region</div>
          <div className="text-xs text-muted-foreground">
            Drag a rectangle on the page; output in {targetLanguage}.
          </div>
        </div>
      </button>
    </>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showPicker && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Into
            <select
              value={targetLanguage}
              onChange={(e) => onTargetLanguageChange(e.target.value)}
              disabled={isBusy}
              className="rounded-md border bg-background px-2 py-1 text-base sm:text-sm text-foreground disabled:opacity-50 coarse:min-h-11"
            >
              {allowedLanguages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </label>
        )}
        <Popover open={open && !isBusy && isSm} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              disabled={isBusy || !hasFile}
              title={disabledReason}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed coarse:min-h-11"
            >
              {isBusy ? (
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
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1.5">{menuOptions}</PopoverContent>
        </Popover>
      </div>
      <Sheet
        open={open && !isBusy && !isSm}
        onOpenChange={setOpen}
        title="Translate"
      >
        <div className="space-y-1">{menuOptions}</div>
      </Sheet>
      {message && (
        <p className="text-xs text-muted-foreground max-w-md">{message}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
