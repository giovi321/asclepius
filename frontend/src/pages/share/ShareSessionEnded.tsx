import { Clock } from "lucide-react";

import type { ShareEndReason } from "@/api/shareClient";
import ShareLogo from "@/components/share/ShareLogo";
import Button from "@/components/ui/Button";

const TITLES: Record<ShareEndReason, string> = {
  logged_out: "You have logged out",
  idle: "Session ended after inactivity",
  expired: "Session expired",
  unauthorized: "Session no longer active",
  replaced: "Another share was opened in this browser",
};

/**
 * Terminal screen for the doctor share surface, shown in place of a
 * session page once the share session has ended.
 *
 * Deliberately inert: it makes no request and has no automatic retry.
 * A forgotten tab sitting here sends nothing, so it cannot push the
 * doctor's IP toward the public proxy's fail2ban threshold. With
 * ``reason`` null it reports a load failure that was not an auth error
 * (network, 5xx) and offers a manual retry.
 */
export default function ShareSessionEnded({
  reason,
  onRetry,
}: {
  reason: ShareEndReason | null;
  onRetry?: () => void;
}) {
  const title = reason ? TITLES[reason] : "Could not load this share";
  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 px-4">
      <div
        role="status"
        className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm space-y-6"
      >
        <div className="flex justify-center">
          <ShareLogo size="md" />
        </div>
        <div className="flex items-center gap-2 text-primary">
          <Clock className="h-6 w-6" />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {reason ? (
          <p className="text-sm text-muted-foreground">
            To view the documents again, open the share link you received and
            request a new access code.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              The server could not be reached. Check your connection and try
              again.
            </p>
            {onRetry && (
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={onRetry}
              >
                Try again
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
