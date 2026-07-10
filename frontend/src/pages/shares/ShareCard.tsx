import { useState } from "react";
import {
  Check,
  ChevronDown,
  Link as LinkIcon,
  MoreVertical,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/Menu";
import type {
  ActiveOtp,
  AuditEvent,
  SessionsResponse,
  ShareStatus,
  ShareSummary,
} from "./types";
import { formatLocal } from "./format";
import { buildShareUrl } from "./CopyLinkButton";
import OtpCell from "./OtpCell";
import SessionsPanel from "./SessionsPanel";
import AuditPanel from "./AuditPanel";

/** Mirrors StatusBadge's table colors: emerald→success, amber→warning,
 *  muted→neutral. */
const STATUS_VARIANT: Record<ShareStatus, BadgeVariant> = {
  active: "success",
  expired: "warning",
  revoked: "neutral",
};

export interface ShareCardProps {
  share: ShareSummary;
  status: ShareStatus;
  /** Accordion open state — shared with the md+ table's expanded row so
   *  rotating the device keeps the same share open. */
  expanded: boolean;
  onToggleExpand: () => void;
  otpVisible: boolean;
  otpLoading: boolean;
  otp: ActiveOtp | null;
  onShowOtp: () => void;
  onHideOtp: () => void;
  onRevoke: () => void;
  onDelete: () => void;
  sessionsLoading: boolean;
  sessions: SessionsResponse | undefined;
  onRefreshSessions: () => void;
  onRevokeSession: (rowid: number) => void;
  onDropQueue: (rowid: number) => void;
  auditLoading: boolean;
  auditEvents: AuditEvent[];
}

/**
 * Phone-width replacement for one row of the shares table. The card body
 * is a single tap target that toggles an inline accordion hosting the
 * same SessionsPanel + AuditPanel the desktop expanded row shows; the
 * actions row (copy link, OTP reveal, overflow menu) sits outside the
 * tap target so a fat-finger on Copy never toggles the accordion.
 */
export default function ShareCard({
  share: s,
  status,
  expanded,
  onToggleExpand,
  otpVisible,
  otpLoading,
  otp,
  onShowOtp,
  onHideOtp,
  onRevoke,
  onDelete,
  sessionsLoading,
  sessions,
  onRefreshSessions,
  onRevokeSession,
  onDropQueue,
  auditLoading,
  auditEvents,
}: ShareCardProps) {
  const isRevoked = status === "revoked";
  const isExpired = status === "expired";

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className="w-full px-3 pb-2 pt-3 text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium">{s.recipient_label}</span>
              <Badge variant={STATUS_VARIANT[status]} size="sm">
                {status}
              </Badge>
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {s.patient_name}
            </div>
          </div>
          <ChevronDown
            aria-hidden
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast",
              expanded && "rotate-180",
            )}
          />
        </div>
        <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
          <div>expires {formatLocal(s.expires_at)}</div>
          <div>
            {s.document_count} doc{s.document_count === 1 ? "" : "s"} ·{" "}
            {s.access_count} access{s.access_count === 1 ? "" : "es"} · last{" "}
            {s.last_accessed_at ? formatLocal(s.last_accessed_at) : "never"}
          </div>
        </div>
      </button>

      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {/* Copy-link is hidden for legacy rows that predate the
            token_clear column — those have token_clear=null and we can't
            recover the raw URL from the hash. Admin must reissue. */}
        {!isRevoked && !isExpired && s.token_clear && (
          <CopyLinkAction token={s.token_clear} shareUrl={s.share_url} />
        )}
        {!isRevoked &&
          !isExpired &&
          (s.otp_delivery === "email" ? (
            // The OTP plaintext is never persisted for email shares — the
            // admin cannot read it back, so there is no Show button.
            <span className="min-w-0 text-xs italic text-muted-foreground">
              Code emailed to{" "}
              <span className="font-mono not-italic">
                {s.recipient_contact}
              </span>
            </span>
          ) : (
            <OtpCell
              visible={otpVisible}
              loading={otpLoading}
              otp={otp}
              onShow={onShowOtp}
              onHide={onHideOtp}
              onRefresh={onShowOtp}
            />
          ))}
        <div className="ml-auto">
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="Share actions" size="sm">
                <MoreVertical className="h-4 w-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              {!isRevoked && (
                <MenuItem destructive onSelect={onRevoke}>
                  <Trash2 className="h-4 w-4" aria-hidden /> Revoke
                </MenuItem>
              )}
              {/* Permanent delete — removes the row and all its history.
                  Offered for every status so old and legacy shares can be
                  cleaned out. */}
              <MenuItem destructive onSelect={onDelete}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t bg-muted/10 px-3 py-3">
          <SessionsPanel
            loading={sessionsLoading}
            data={sessions}
            onRefresh={onRefreshSessions}
            onRevokeSession={onRevokeSession}
            onDropQueue={onDropQueue}
          />
          <AuditPanel loading={auditLoading} events={auditEvents} />
        </div>
      )}
    </div>
  );
}

/** Same clipboard behavior as the table's CopyLinkButton, restyled as a
 *  Button primitive so it clears the 44px touch minimum on phones. */
function CopyLinkAction({
  token,
  shareUrl,
}: {
  token: string;
  shareUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(token, shareUrl));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // older browsers may block navigator.clipboard outside HTTPS
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={onCopy}>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      ) : (
        <LinkIcon className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
