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
      // Send an empty JSON object so FastAPI's body-validation step sees
      // a present-but-empty body. Without this, axios sends no body at
      // all and the (defaulted-but-still-required) Pydantic model fails
      // validation with "Field required" — which used to surface as a
      // confusing JSON blob in the UI.
      await shareApi.post(`/documents/${documentId}/translate`, {});
      setMessage("Translation queued. Refresh in a moment to see the result.");
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
        // 400 / 404 / etc. — surface the backend's reason verbatim so
        // the admin gets enough info to diagnose without a console dive.
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
