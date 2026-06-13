import { Activity, Loader2, ScrollText } from "lucide-react";
import type { AuditEvent } from "./types";
import { formatLocal } from "./format";

export default function AuditPanel({
  loading,
  events,
}: {
  loading: boolean;
  events: AuditEvent[];
}) {
  if (loading) {
    return (
      <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading audit log...
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No events recorded yet.
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground mb-2">
        <ScrollText className="h-3 w-3" /> Audit log ({events.length})
      </div>
      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-2 py-1">When</th>
              <th className="text-left px-2 py-1">Action</th>
              <th className="text-left px-2 py-1">Doc</th>
              <th className="text-left px-2 py-1">IP</th>
              <th className="text-left px-2 py-1">User-Agent</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map((e) => (
              <tr key={e.id}>
                <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                  {formatLocal(e.created_at)}
                </td>
                <td className="px-2 py-1">
                  <ActionLabel action={e.action} />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  {e.document_id ?? ""}
                </td>
                <td className="px-2 py-1 font-mono text-muted-foreground">
                  {e.client_ip || ""}
                </td>
                <td className="px-2 py-1 text-muted-foreground truncate max-w-[260px]">
                  {e.user_agent || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionLabel({ action }: { action: string }) {
  const map: Record<string, string> = {
    otp_request: "OTP requested",
    otp_email_sent: "OTP emailed",
    otp_email_failed: "Email delivery failed",
    otp_email_rate_limited: "Email rate-limited",
    otp_verify_ok: "OTP verified",
    otp_verify_fail: "OTP failed",
    "share.locked": "Share locked (3-strike)",
    view_doc: "Viewed document",
    view_file: "Viewed file",
    translate: "Translated",
    logout: "Logged out",
    session_expired: "Session expired",
  };
  const tone =
    action === "otp_verify_fail" ||
    action === "otp_email_failed" ||
    action === "share.locked"
      ? "text-red-600 dark:text-red-400"
      : action === "otp_email_sent"
        ? "text-blue-700 dark:text-blue-400"
        : action === "otp_email_rate_limited"
          ? "text-amber-600 dark:text-amber-400"
          : action === "view_file" || action === "view_doc"
            ? "text-emerald-700 dark:text-emerald-400"
            : action === "translate"
              ? "text-blue-700 dark:text-blue-400"
              : "text-foreground";
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      <Activity className="h-3 w-3" /> {map[action] || action}
    </span>
  );
}
