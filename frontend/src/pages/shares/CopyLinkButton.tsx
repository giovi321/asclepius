import { useState } from "react";
import { Check, Link as LinkIcon } from "lucide-react";

/**
 * Server-built URL respects ``share.public_base_url`` so split-host
 * setups (LAN admin + public doctor host) hand the admin the
 * doctor-facing URL. Fall back to the admin's own origin only when
 * the server didn't provide one (single-host deployments where
 * public_base_url is empty AND the host header was missing).
 */
export function buildShareUrl(token: string, shareUrl: string | null): string {
  return shareUrl || `${window.location.origin}/share/${token}`;
}

export default function CopyLinkButton({
  token,
  shareUrl,
}: {
  token: string;
  shareUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const url = buildShareUrl(token, shareUrl);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // older browsers may block navigator.clipboard outside HTTPS
    }
  };
  return (
    <button
      onClick={onCopy}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
      title={copied ? "Copied" : "Copy share link"}
    >
      {copied ? (
        <Check className="h-3 w-3 text-success" />
      ) : (
        <LinkIcon className="h-3 w-3" />
      )}
      {copied ? "Copied" : "Link"}
    </button>
  );
}
