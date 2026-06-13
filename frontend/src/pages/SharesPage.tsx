import { Fragment, useMemo, useState } from "react";
import {
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/contexts/ToastContext";
import {
  type AuditEvent,
  type ActiveOtp,
  type SessionsResponse,
  type ShareStatus,
  ALL_STATUSES,
} from "@/pages/shares/types";
import { useShares } from "@/pages/shares/useShares";
import { formatLocal } from "@/pages/shares/format";
import StatusBadge from "@/pages/shares/StatusBadge";
import OtpCell from "@/pages/shares/OtpCell";
import CopyLinkButton from "@/pages/shares/CopyLinkButton";
import SessionsPanel from "@/pages/shares/SessionsPanel";
import AuditPanel from "@/pages/shares/AuditPanel";

/**
 * Admin dashboard listing every doctor share the caller can manage.
 *
 * Per row: patient, recipient, status (active/expired/revoked), expiry,
 * document count, total accesses, last access timestamp, and inline
 * actions for revealing the active OTP, viewing the audit log, and
 * revoking. The audit panel is rendered as an expanded row to avoid a
 * second navigation step for what's usually a quick lookup.
 */
export default function SharesPage() {
  const { toast } = useToast();
  const { shares, loading, refresh } = useShares();
  // Multi-select status filter — admins want to see e.g. active +
  // expired without revoked. Default includes everything so first
  // page load looks identical to the "all" view we used to ship.
  const [statusFilter, setStatusFilter] = useState<Set<ShareStatus>>(
    () => new Set(ALL_STATUSES),
  );
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [auditByShare, setAuditByShare] = useState<
    Record<number, AuditEvent[]>
  >({});
  const [auditLoading, setAuditLoading] = useState<Record<number, boolean>>({});
  const [sessionsByShare, setSessionsByShare] = useState<
    Record<number, SessionsResponse>
  >({});
  const [sessionsLoading, setSessionsLoading] = useState<
    Record<number, boolean>
  >({});
  const [activeOtp, setActiveOtp] = useState<Record<number, ActiveOtp | null>>(
    {},
  );
  const [otpVisible, setOtpVisible] = useState<Record<number, boolean>>({});
  const [otpLoading, setOtpLoading] = useState<Record<number, boolean>>({});

  const filtered = useMemo(() => {
    const now = new Date().toISOString();
    return shares.filter((s) => {
      const isRevoked = !!s.revoked_at;
      const isExpired = !isRevoked && s.expires_at < now;
      const status: ShareStatus = isRevoked
        ? "revoked"
        : isExpired
          ? "expired"
          : "active";
      if (!statusFilter.has(status)) return false;
      if (search) {
        const q = search.toLowerCase();
        // patient_name can be null for orphaned legacy rows (the list
        // query LEFT JOINs patients), so coalesce before lowercasing.
        if (
          !(s.recipient_label || "").toLowerCase().includes(q) &&
          !(s.patient_name || "").toLowerCase().includes(q) &&
          !(s.recipient_contact || "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [shares, statusFilter, search]);

  const toggleStatus = (status: ShareStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const onRevoke = async (id: number) => {
    if (
      !confirm(
        "Revoke this share? The doctor's session will be killed immediately.",
      )
    )
      return;
    try {
      await api.delete(`/shares/${id}`);
      toast({ title: "Share revoked", variant: "success" });
      refresh();
    } catch (err: any) {
      toast({
        title: "Revoke failed",
        description: getErrorMessage(err),
        variant: "error",
      });
    }
  };

  const onDelete = async (id: number) => {
    if (
      !confirm(
        "Permanently delete this share? It will be removed from the database " +
          "along with its OTPs, sessions, and audit history. Any live doctor " +
          "session is killed. This cannot be undone.",
      )
    )
      return;
    try {
      await api.delete(`/shares/${id}/purge`);
      toast({ title: "Share deleted", variant: "success" });
      if (expandedId === id) setExpandedId(null);
      refresh();
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: getErrorMessage(err),
        variant: "error",
      });
    }
  };

  const onShowOtp = async (id: number) => {
    setOtpVisible((s) => ({ ...s, [id]: true }));
    setOtpLoading((s) => ({ ...s, [id]: true }));
    try {
      // Lightweight endpoint that skips the audit-event listing — the
      // /audit response can be 200 rows of user-agent strings, which
      // made every "Show active code" click feel sluggish on a busy
      // install.
      const res = await api.get(`/shares/${id}/active-otp`);
      setActiveOtp((s) => ({ ...s, [id]: res.data?.active_otp || null }));
    } catch (err: any) {
      toast({
        title: "Could not load code",
        description: getErrorMessage(err),
        variant: "error",
      });
      setOtpVisible((s) => ({ ...s, [id]: false }));
    } finally {
      setOtpLoading((s) => ({ ...s, [id]: false }));
    }
  };

  const loadSessions = async (id: number) => {
    setSessionsLoading((s) => ({ ...s, [id]: true }));
    try {
      const res = await api.get<SessionsResponse>(`/shares/${id}/sessions`);
      setSessionsByShare((s) => ({
        ...s,
        [id]: { active: res.data.active || [], queued: res.data.queued || [] },
      }));
    } catch (err: any) {
      toast({
        title: "Could not load sessions",
        description: getErrorMessage(err),
        variant: "error",
      });
    } finally {
      setSessionsLoading((s) => ({ ...s, [id]: false }));
    }
  };

  const onToggleAudit = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    // Fetch sessions on every expand so the data is fresh — sessions
    // come and go quickly, unlike audit history which only ever grows.
    loadSessions(id);
    if (auditByShare[id]) return;
    setAuditLoading((s) => ({ ...s, [id]: true }));
    try {
      const res = await api.get(`/shares/${id}/audit`);
      setAuditByShare((s) => ({ ...s, [id]: res.data?.events || [] }));
    } catch (err: any) {
      toast({
        title: "Could not load audit log",
        description: getErrorMessage(err),
        variant: "error",
      });
    } finally {
      setAuditLoading((s) => ({ ...s, [id]: false }));
    }
  };

  const onRevokeSession = async (shareId: number, rowid: number) => {
    if (
      !confirm(
        "Kill this active doctor session? They will be bounced back to the landing page.",
      )
    ) {
      return;
    }
    try {
      await api.delete(`/shares/${shareId}/sessions/${rowid}`);
      toast({ title: "Session terminated", variant: "success" });
      loadSessions(shareId);
    } catch (err: any) {
      toast({
        title: "Could not terminate session",
        description: getErrorMessage(err),
        variant: "error",
      });
    }
  };

  const onDropQueue = async (shareId: number, rowid: number) => {
    try {
      await api.delete(`/shares/${shareId}/queue/${rowid}`);
      toast({ title: "Queue entry dropped", variant: "success" });
      loadSessions(shareId);
    } catch (err: any) {
      toast({
        title: "Could not drop queue entry",
        description: getErrorMessage(err),
        variant: "error",
      });
    }
  };

  const counts = useMemo(() => {
    const now = new Date().toISOString();
    let active = 0;
    let expired = 0;
    let revoked = 0;
    for (const s of shares) {
      if (s.revoked_at) revoked += 1;
      else if (s.expires_at < now) expired += 1;
      else active += 1;
    }
    return { active, expired, revoked, total: shares.length };
  }, [shares]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Multi-select status filter. Each chip is a checkbox-style
            toggle; the selection set is the union of statuses to show.
            Click "All" to flip every status on, "None" to show nothing
            (handy for hiding the table during a search). */}
        <div className="flex items-center gap-1 rounded-md border bg-card p-0.5 text-sm">
          {ALL_STATUSES.map((s) => {
            const on = statusFilter.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`rounded px-3 py-1 capitalize transition-colors ${
                  on
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-muted-foreground"
                }`}
                title={on ? `Hide ${s} shares` : `Show ${s} shares`}
              >
                {s}
                <span className="ml-1.5 text-xs opacity-70">{counts[s]}</span>
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-border" />
          <button
            onClick={() => setStatusFilter(new Set(ALL_STATUSES))}
            disabled={statusFilter.size === ALL_STATUSES.length}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-default"
            title="Show all statuses"
          >
            All
          </button>
          <button
            onClick={() => setStatusFilter(new Set())}
            disabled={statusFilter.size === 0}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-default"
            title="Hide all statuses"
          >
            None
          </button>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by recipient, patient, contact..."
          className="flex-1 min-w-[200px] rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        {counts.total} share{counts.total === 1 ? "" : "s"} total ·{" "}
        <span className="text-emerald-600 dark:text-emerald-400">
          {counts.active} active
        </span>{" "}
        ·{" "}
        <span className="text-amber-600 dark:text-amber-400">
          {counts.expired} expired
        </span>{" "}
        ·{" "}
        <span className="text-muted-foreground">{counts.revoked} revoked</span>
      </p>

      {loading ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading shares...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          {shares.length === 0
            ? "No doctor shares yet. Open a document and click 'Share with doctor' to create one."
            : "No shares match the current filter."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 w-8"></th>
                <th className="text-left px-3 py-2">Recipient</th>
                <th className="text-left px-3 py-2">Patient</th>
                <th className="text-left px-3 py-2">Docs</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Expires</th>
                <th className="text-left px-3 py-2">Accesses</th>
                <th className="text-left px-3 py-2">Last access</th>
                <th className="text-left px-3 py-2 w-[230px]">Active code</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((s) => {
                const now = new Date().toISOString();
                const isRevoked = !!s.revoked_at;
                const isExpired = !isRevoked && s.expires_at < now;
                const status = isRevoked
                  ? "revoked"
                  : isExpired
                    ? "expired"
                    : "active";
                const isOpen = expandedId === s.id;
                return (
                  <Fragment key={s.id}>
                    <tr className={isOpen ? "bg-muted/20" : ""}>
                      <td className="px-3 py-2 align-top">
                        <button
                          onClick={() => onToggleAudit(s.id)}
                          className="rounded p-0.5 hover:bg-accent"
                          title="Toggle audit log"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{s.recipient_label}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.recipient_contact}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">{s.patient_name}</td>
                      <td className="px-3 py-2 align-top">
                        {s.document_count}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {formatLocal(s.expires_at)}
                      </td>
                      <td className="px-3 py-2 align-top">{s.access_count}</td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {s.last_accessed_at
                          ? formatLocal(s.last_accessed_at)
                          : "never"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {isRevoked || isExpired ? (
                          <span className="text-xs text-muted-foreground italic">
                            n/a
                          </span>
                        ) : s.otp_delivery === "email" ? (
                          // The OTP plaintext is never persisted for
                          // email shares — the admin cannot read it
                          // back. Showing the Show button would just
                          // dead-end on an empty `active_otp`.
                          <span className="text-xs text-muted-foreground italic whitespace-normal">
                            Emailed to{" "}
                            <span className="font-mono not-italic">
                              {s.recipient_contact}
                            </span>
                          </span>
                        ) : (
                          <OtpCell
                            visible={!!otpVisible[s.id]}
                            loading={!!otpLoading[s.id]}
                            otp={activeOtp[s.id] ?? null}
                            onShow={() => onShowOtp(s.id)}
                            onHide={() =>
                              setOtpVisible((st) => ({ ...st, [s.id]: false }))
                            }
                            onRefresh={() => onShowOtp(s.id)}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {/* Copy-link is hidden for legacy rows that
                              predate the token_clear column — those have
                              token_clear=null and we can't recover the
                              raw URL from the hash. Admin must reissue. */}
                          {!isRevoked && !isExpired && s.token_clear && (
                            <CopyLinkButton
                              token={s.token_clear}
                              shareUrl={s.share_url}
                            />
                          )}
                          {!isRevoked && (
                            <button
                              onClick={() => onRevoke(s.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                              title="Revoke share (keeps the row, kills the session)"
                            >
                              <Trash2 className="h-3 w-3" /> Revoke
                            </button>
                          )}
                          {/* Permanent delete — removes the row and all
                              its history. Offered for every status so old
                              and legacy shares can be cleaned out. */}
                          <button
                            onClick={() => onDelete(s.id)}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-red-600"
                            title="Permanently delete this share from the database"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/10">
                        <td></td>
                        <td colSpan={9} className="px-3 py-3 space-y-4">
                          <SessionsPanel
                            loading={!!sessionsLoading[s.id]}
                            data={sessionsByShare[s.id]}
                            onRefresh={() => loadSessions(s.id)}
                            onRevokeSession={(rowid) =>
                              onRevokeSession(s.id, rowid)
                            }
                            onDropQueue={(rowid) => onDropQueue(s.id, rowid)}
                          />
                          <AuditPanel
                            loading={!!auditLoading[s.id]}
                            events={auditByShare[s.id] || []}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
