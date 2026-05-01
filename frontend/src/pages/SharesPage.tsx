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
} from "lucide-react";

import api from "@/api/client";
import { useToast } from "@/contexts/ToastContext";

interface ShareSummary {
  id: number;
  patient_id: number;
  patient_name: string;
  recipient_label: string;
  recipient_contact: string;
  contact_kind: string;
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

type StatusFilter = "all" | "active" | "expired" | "revoked";

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
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [auditByShare, setAuditByShare] = useState<
    Record<number, AuditEvent[]>
  >({});
  const [auditLoading, setAuditLoading] = useState<Record<number, boolean>>({});
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
      const status = isRevoked ? "revoked" : isExpired ? "expired" : "active";
      if (filter !== "all" && status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !s.recipient_label.toLowerCase().includes(q) &&
          !s.patient_name.toLowerCase().includes(q) &&
          !s.recipient_contact.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [shares, filter, search]);

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

  const onToggleAudit = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
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
        <div className="flex items-center gap-1 rounded-md border bg-card p-0.5 text-sm">
          {(["all", "active", "expired", "revoked"] as StatusFilter[]).map(
            (f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-3 py-1 capitalize transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {f}
                {f !== "all" && (
                  <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
                )}
              </button>
            ),
          )}
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
                        {!isRevoked && !isExpired ? (
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
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            n/a
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        {!isRevoked && (
                          <button
                            onClick={() => onRevoke(s.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                            title="Revoke share"
                          >
                            <Trash2 className="h-3 w-3" /> Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/10">
                        <td></td>
                        <td colSpan={9} className="px-3 py-3">
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
    <div className="flex items-start gap-1">
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
    otp_verify_ok: "OTP verified",
    otp_verify_fail: "OTP failed",
    view_doc: "Viewed document",
    view_file: "Viewed file",
    translate: "Translated",
    logout: "Logged out",
    session_expired: "Session expired",
  };
  const tone =
    action === "otp_verify_fail"
      ? "text-red-600 dark:text-red-400"
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
