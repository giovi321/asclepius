import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Hourglass, Loader2, X } from "lucide-react";

import shareApi from "@/api/shareClient";
import ShareLogo from "@/components/share/ShareLogo";
import { usePolling } from "@/lib/polling";
import Button from "@/components/ui/Button";

const CLAIM_POLL_MS = 5000;
const CLAIM_STOP_STATUSES = [401, 403, 404, 410];

/**
 * Queueing UX.
 *
 * Shown to a doctor whose verify-otp call returned ``status: "queued"``
 * because another device already holds the share's only session slot.
 * Polls ``/api/share/claim`` every 5 seconds (paused while the tab is
 * hidden) until:
 *   - the active session dies (logout / idle / TTL / revocation) and
 *     the server promotes our queue token into a real session →
 *     hard-navigate to ``/share/dashboard``, or
 *   - the queue token expires or the share is revoked (410, or any
 *     other 4xx) → stop polling and return to the landing page, or
 *   - the doctor clicks "Cancel" → DELETE the queue token and bounce.
 */
export default function ShareWaitingPage() {
  const navigate = useNavigate();
  const [recipientLabel, setRecipientLabel] = useState<string | null>(null);
  const [queueExpiresAt, setQueueExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Poll /claim every 5s (paused while the tab is hidden, backoff on
  // network / 5xx / 429). 410 is the server's "queue position gone"
  // answer and is final; 401/403/404 cannot succeed on retry and count
  // toward the public proxy's fail2ban threshold, so they stop the poll
  // too instead of being retried as "transient".
  const [stopped, setStopped] = useState(false);
  usePolling(
    async () => {
      if (cancelledRef.current) return;
      const res = await shareApi.post<{
        status: "active" | "queued";
        queue_expires_at?: string;
        recipient_label?: string;
      }>("/claim");
      if (res.data?.status === "active") {
        // Slot just freed and we won the race. Hard-navigate so the
        // new asclepius_share cookie is picked up cleanly.
        setStopped(true);
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
    },
    {
      intervalMs: CLAIM_POLL_MS,
      // Fire the first poll immediately so the user gets the recipient
      // label and a fresh queue expiry without waiting 5 seconds.
      immediate: true,
      enabled: !stopped,
      stopOn: CLAIM_STOP_STATUSES,
      onStop: (status) => {
        setStopped(true);
        if (status === 410) {
          setError(
            "Your waiting position has expired. Request a fresh access code to try again.",
          );
        } else {
          setError(
            "Your waiting position is no longer valid. Open the share link again to request a fresh access code.",
          );
        }
        window.setTimeout(() => navigate("/share", { replace: true }), 2500);
      },
    },
  );

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
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm space-y-6">
        <div className="flex justify-center">
          <ShareLogo size="md" />
        </div>
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
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={onCancel}
        >
          <X className="h-4 w-4" />
          Cancel and exit
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground border-t pt-4">
          Only one device can view a share at a time. If you closed an earlier
          tab, this should clear up within a few minutes.
        </p>
      </div>
    </div>
  );
}
