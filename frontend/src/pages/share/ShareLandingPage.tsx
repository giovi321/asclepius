import { FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";

import shareApi from "@/api/shareClient";

/**
 * Entry point for a share link.
 *
 * The doctor lands here from a `/share/{token}` URL the admin sent them.
 * Clicking "Send me a code" calls request-otp; the admin then conveys
 * the 6-digit code out-of-band (phone, in-person) since this v1 has no
 * email/SMS delivery wired up.
 *
 * The endpoint always returns 204 — no information is leaked to the
 * doctor about whether the token is valid.
 */
export default function ShareLandingPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await shareApi.post(`/${token}/request-otp`);
      navigate(`/share/${token}/verify`);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429) {
        setError("Too many requests. Please wait a few minutes and try again.");
      } else {
        setError("Could not request a code. Please retry.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="h-6 w-6" />
          <h1 className="text-lg font-semibold">Secure document share</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          You have been invited to view a curated set of medical documents. To
          continue, request a 6-digit access code. The person who shared this
          link with you will tell you the code directly.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <button
            type="submit"
            disabled={submitting || !token}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Request access code
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <p className="text-xs text-muted-foreground border-t pt-4">
          Sessions expire automatically. The documents are read-only and cannot
          be downloaded or modified.
        </p>
      </div>
    </div>
  );
}
