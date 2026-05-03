import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Hourglass, Loader2, X } from "lucide-react";

import shareApi from "@/api/shareClient";

/**
 * Queueing UX.
 *
 * Shown to a doctor whose verify-otp call returned ``status: "queued"``
 * because another device already holds the share's only session slot.
 * Polls ``/api/share/claim`` every 5 seconds until:
 *   - the active session dies (logout / idle / TTL / revocation) and
 *     the server promotes our queue token into a real session →
 *     hard-navigate to ``/share/dashboard``, or
 *   - the queue token expires or the share is revoked → return to the
 *     landing page with an error toast, or
 *   - the doctor clicks "Cancel" → DELETE the queue token and bounce.
 */
export default function ShareWaitingPage() {
  const navigate = useNavigate();
  const [recipientLabel, setRecipientLabel] = useState<string | null>(null);
  const [queueExpiresAt, setQueueExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelledRef.current) return;
      try {
        const res = await shareApi.post<{
          status: "active" | "queued";
          queue_expires_at?: string;
          recipient_label?: string;
        }>("/claim");
        if (cancelled) return;
        if (res.data?.status === "active") {
          // Slot just freed and we won the race. Hard-navigate so the
          // new asclepius_share cookie is picked up cleanly.
          window.location.href = "/share/dashboard";
          return;
        }
        // Still queued. Refresh the displayed expiry / label.
        if (res.data?.queue_expires_at) {
          setQueueExpiresAt(res.data.queue_expires_at);
        }
        if (res.data?.recipient_label) {
          setRecipientLabel(res.data.recipient_label);
        }
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 410) {
          // Queue token expired or share revoked. Bounce home.
          setError(
            "Your waiting position has expired. Request a fresh access code to try again.",
          );
          window.setTimeout(() => navigate("/share", { replace: true }), 2500);
          return;
        }
        // Transient — keep polling.
      }
      if (!cancelled) {
        timer = window.setTimeout(tick, 5000);
      }
    };

    // Fire the first poll immediately so the user gets the recipient
    // label and a fresh queue expiry without waiting 5 seconds.
    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [navigate]);

  const onCancel = async () => {
    cancelledRef.current = true;
    try {
      await shareApi.delete("/queue");
    } catch {
      // Cookie clear must always succeed even if the network call did not.
    }
    navigate("/share", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-2 text-primary">
          <Hourglass className="h-6 w-6" />
          <h1 className="text-lg font-semibold">Share is currently in use</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {recipientLabel
            ? `${recipientLabel}, this share is currently being viewed on another device.`
            : "This share is currently being viewed on another device."}{" "}
          You will be admitted automatically once that session ends.
        </p>
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-muted-foreground">
            Waiting for the slot to free up...
          </span>
        </div>
        {queueExpiresAt && (
          <p className="text-xs text-muted-foreground">
            Your waiting position is valid until{" "}
            <span className="font-mono">
              {new Date(queueExpiresAt + "Z").toLocaleTimeString()}
            </span>
            . If the other session does not end before then you will need to
            request a fresh access code.
          </p>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-sm hover:bg-muted"
        >
          <X className="h-4 w-4" />
          Cancel and exit
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground border-t pt-4">
          Only one device can view a share at a time. If you closed an earlier
          tab, this should clear up within a few minutes.
        </p>
      </div>
    </div>
  );
}
