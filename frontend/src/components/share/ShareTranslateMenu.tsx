import { useState } from "react";
import { Languages, Loader2 } from "lucide-react";

import shareApi from "@/api/shareClient";

interface ShareTranslateMenuProps {
  documentId: number;
  hasOcrText: boolean;
  /** Called after a translate request was queued so the parent can refetch
   * the document detail and surface the new translation when ready. */
  onQueued?: () => void;
}

/**
 * Lightweight translate trigger for the doctor share view.
 *
 * Reuses the same backend pipeline as the admin translate, just through
 * the share-scoped endpoint. The provider picker is intentionally
 * omitted — the doctor doesn't need to choose between configured LLMs.
 */
export default function ShareTranslateMenu({
  documentId,
  hasOcrText,
  onQueued,
}: ShareTranslateMenuProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await shareApi.post(`/documents/${documentId}/translate`);
      setMessage("Translation queued. Refresh in a moment to see the result.");
      onQueued?.();
    } catch (err: any) {
      const status = err?.response?.status;
      const retryAfter = err?.response?.headers?.["retry-after"];
      if (status === 429 && retryAfter) {
        setError(`Try again in ${retryAfter}s.`);
      } else if (status === 400) {
        setError(err?.response?.data?.detail || "Translation unavailable.");
      } else {
        setError("Translation request failed.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={onClick}
        disabled={submitting || !hasOcrText}
        title={hasOcrText ? undefined : "Translation needs OCR text first"}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Languages className="h-4 w-4" />
        )}
        Translate to English
      </button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
