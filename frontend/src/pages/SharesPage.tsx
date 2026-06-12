import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ScrollText,
  Activity,
  Copy,
  Check,
  Link as LinkIcon,
} from "lucide-react";

import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";

interface ShareSummary {
  id: number;
  patient_id: number;
  patient_name: string;
  /** Raw URL token. Null for shares created before the
   * token_clear column existed — those rows can't show a copy-link
   * button (admin must reissue if they need a new link). */
  token_clear: string | null;
  /** Server-built share link, decorated with ``share.public_base_url``
   * if set so split-host deployments hand the admin the doctor-facing
   * URL. Null when the row has no ``token_clear``. */
  share_url: string | null;
  recipient_label: string;
  recipient_contact: string;
  contact_kind: string;
  /** "manual" (legacy default) or "email". Email shares hide the
   * Show-active-code button because the OTP plaintext is never
   * persisted — there is nothing to show. */
  otp_delivery?: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  document_count: number;
  created_by_username: string;
  access_count: number;
  last_accessed_at: string | null;
}

interface AuditEvent {
  id: number;
  action: string;
  session_id: string | null;
  document_id: number | null;
  client_ip: string | null;
  user_agent: string | null;
  detail: any;
  created_at: string;
}

interface ActiveOtp {
  code: string;
  expires_at: string;
  attempts: number;
}

interface ActiveSessionRow {
  rowid: number;
  share_id: number;
  expires_at: string;
  last_seen_at: string | null;
  client_ip: string | null;
  user_agent: string | null;
  created_at: string;
  /** True when the session has been silent past the idle timeout — the
   * queue treats it as a free slot but the row is not yet revoked. */
  is_idle: boolean;
}

interface QueuedSessionRow {
  rowid: number;
  share_id: number;
  expires_at: string;
  client_ip: string | null;
  user_agent: string | null;
  created_at: string;
}

interface SessionsResponse {
  active: ActiveSessionRow[];
  queued: QueuedSessionRow[];
}

type ShareStatus = "active" | "expired" | "revoked";

const ALL_STATUSES: ShareStatus[] = ["active", "expired", "revoked"];

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
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [loading, setLoading] = useState(true);
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

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get<ShareSummary[]>("/shares");
      setShares(res.data);
    } catch (err: any) {
      toast({
        title: "Could not load shares",
        description: err?.response?.data?.detail || err.message,
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

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
        description: err?.response?.data?.detail || err.message,
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
        description: err?.response?.data?.detail || err.message,
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
        description: err?.response?.data?.detail || err.message,
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
        description: err?.response?.data?.detail || err.message,
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
        description: err?.response?.data?.detail || err.message,
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
        description: err?.response?.data?.detail || err.message,
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
        description: err?.response?.data?.detail || err.message,
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

function StatusBadge({ status }: { status: "active" | "expired" | "revoked" }) {
  const map = {
    active:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    expired:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    revoked: "bg-muted text-muted-foreground line-through",
  };
  return (
    <span
      className={`inline-block rounded-md px-1.5 py-0.5 text-xs ${map[status]}`}
    >
      {status}
    </span>
  );
}

function OtpCell({
  visible,
  loading,
  otp,
  onShow,
  onHide,
  onRefresh,
}: {
  visible: boolean;
  loading: boolean;
  otp: ActiveOtp | null;
  onShow: () => void;
  onHide: () => void;
  onRefresh: () => void;
}) {
  if (!visible) {
    return (
      <button
        onClick={onShow}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
      >
        <Eye className="h-3 w-3" /> Show
      </button>
    );
  }
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading...
      </span>
    );
  }
  return (
    // ``items-center`` aligns the refresh / hide / copy buttons with the
    // 6-digit code on the same horizontal axis. For the no-code branch
    // the buttons sit centred against the wrapped help text, which is
    // a smaller asymmetry than the previous top-aligned look.
    <div className="flex items-center gap-1">
      {otp?.code ? (
        <>
          <span className="font-mono text-base tracking-widest text-primary">
            {otp.code}
          </span>
          <CopyCodeButton code={otp.code} />
        </>
      ) : (
        // Fixed width + whitespace-normal forces the help text to wrap
        // inside the column instead of pushing every other column out.
        <p className="text-[11px] italic text-muted-foreground leading-tight w-[170px] whitespace-normal">
          No code yet. Doctor needs to click "Request access code" first.
        </p>
      )}
      <button
        onClick={onRefresh}
        className="rounded p-0.5 hover:bg-accent flex-shrink-0"
        title="Refetch"
      >
        <RefreshCw className="h-3 w-3" />
      </button>
      <button
        onClick={onHide}
        className="rounded p-0.5 hover:bg-accent flex-shrink-0"
        title="Hide"
      >
        <EyeOff className="h-3 w-3" />
      </button>
    </div>
  );
}

function CopyLinkButton({
  token,
  shareUrl,
}: {
  token: string;
  shareUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    // Server-built URL respects ``share.public_base_url`` so split-host
    // setups (LAN admin + public doctor host) hand the admin the
    // doctor-facing URL. Fall back to the admin's own origin only when
    // the server didn't provide one (single-host deployments where
    // public_base_url is empty AND the host header was missing).
    const url = shareUrl || `${window.location.origin}/share/${token}`;
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
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <LinkIcon className="h-3 w-3" />
      )}
      {copied ? "Copied" : "Link"}
    </button>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // older browsers may block navigator.clipboard outside HTTPS
    }
  };
  return (
    <button
      onClick={onCopy}
      className="rounded p-0.5 hover:bg-accent flex-shrink-0"
      title={copied ? "Copied" : "Copy code"}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

function SessionsPanel({
  loading,
  data,
  onRefresh,
  onRevokeSession,
  onDropQueue,
}: {
  loading: boolean;
  data: SessionsResponse | undefined;
  onRefresh: () => void;
  onRevokeSession: (rowid: number) => void;
  onDropQueue: (rowid: number) => void;
}) {
  const active = data?.active || [];
  const queued = data?.queued || [];
  const empty = !loading && active.length === 0 && queued.length === 0;
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground mb-2">
        <Activity className="h-3 w-3" /> Sessions
        <button
          onClick={onRefresh}
          className="rounded p-0.5 hover:bg-accent"
          title="Refresh sessions"
          aria-label="Refresh sessions"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading...
        </div>
      ) : empty ? (
        <div className="text-xs text-muted-foreground italic">
          No active session and no waiters.
        </div>
      ) : (
        <div className="space-y-3">
          {active.length > 0 && (
            <SessionsTable
              title="Active"
              caption="At most one slot per share. Idle sessions are still
                       listed but the queue treats them as free."
              rows={active}
              actionLabel="Kill"
              actionTitle="Force-terminate this session"
              onAction={onRevokeSession}
              renderStatus={(r) =>
                r.is_idle ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    idle
                  </span>
                ) : (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    live
                  </span>
                )
              }
            />
          )}
          {queued.length > 0 && (
            <SessionsTable
              title={`Queued (${queued.length})`}
              caption="Waiters are first-come, first-served once the active
                       session ends."
              rows={queued}
              actionLabel="Drop"
              actionTitle="Drop this queued waiter"
              onAction={onDropQueue}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface SessionTableRow {
  rowid: number;
  expires_at: string;
  client_ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at?: string | null;
  is_idle?: boolean;
}

function SessionsTable<T extends SessionTableRow>({
  title,
  caption,
  rows,
  actionLabel,
  actionTitle,
  onAction,
  renderStatus,
}: {
  title: string;
  caption: string;
  rows: T[];
  actionLabel: string;
  actionTitle: string;
  onAction: (rowid: number) => void;
  renderStatus?: (r: T) => React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="bg-muted/30 px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
        {title}
      </div>
      <table className="w-full text-xs">
        <thead className="bg-muted/20 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1 w-20">Status</th>
            <th className="text-left px-2 py-1">Started</th>
            <th className="text-left px-2 py-1">Last seen</th>
            <th className="text-left px-2 py-1">Expires</th>
            <th className="text-left px-2 py-1">IP</th>
            <th className="text-left px-2 py-1">User-Agent</th>
            <th className="text-right px-2 py-1 w-20"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.rowid}>
              <td className="px-2 py-1">
                {renderStatus ? (
                  renderStatus(r)
                ) : (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
                    waiting
                  </span>
                )}
              </td>
              <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                {formatLocal(r.created_at)}
              </td>
              <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                {r.last_seen_at ? formatLocal(r.last_seen_at) : "—"}
              </td>
              <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                {formatLocal(r.expires_at)}
              </td>
              <td className="px-2 py-1 font-mono text-muted-foreground">
                {r.client_ip || ""}
              </td>
              <td className="px-2 py-1 text-muted-foreground truncate max-w-[260px]">
                {r.user_agent || ""}
              </td>
              <td className="px-2 py-1 text-right">
                <button
                  onClick={() => onAction(r.rowid)}
                  className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-0.5 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                  title={actionTitle}
                >
                  <Trash2 className="h-3 w-3" /> {actionLabel}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[11px] italic text-muted-foreground border-t">
        {caption}
      </p>
    </div>
  );
}

function AuditPanel({
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

function formatLocal(iso: string): string {
  try {
    return new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString();
  } catch {
    return iso;
  }
}
