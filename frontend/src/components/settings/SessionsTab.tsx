import { useEffect, useMemo, useState } from "react";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useToast } from "@/contexts/ToastContext";
import { RefreshCw, Trash2, Monitor, Smartphone, Globe } from "lucide-react";
import { formatDateTime, formatRelative, parseBackendTs } from "@/lib/datetime";

interface SessionRow {
  session_id: string;
  user_id: number;
  username: string;
  display_name: string | null;
  role: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  revoked_at: string | null;
  is_current: boolean;
}

// Tiny UA classifier — just enough to pick an icon and a readable label.
function describeUserAgent(ua: string | null): {
  label: string;
  icon: typeof Monitor;
} {
  if (!ua) return { label: "unknown", icon: Globe };
  const s = ua.toLowerCase();
  let icon: typeof Monitor = Monitor;
  if (/mobile|android|iphone|ipad/.test(s)) icon = Smartphone;
  const browser = /edg\//.test(s)
    ? "Edge"
    : /chrome\//.test(s) && !/edg\//.test(s)
      ? "Chrome"
      : /firefox\//.test(s)
        ? "Firefox"
        : /safari\//.test(s) && !/chrome\//.test(s)
          ? "Safari"
          : /curl|python|httpx|axios/.test(s)
            ? "API client"
            : "Browser";
  const os = /windows nt/.test(s)
    ? "Windows"
    : /mac os x|macintosh/.test(s)
      ? "macOS"
      : /android/.test(s)
        ? "Android"
        : /iphone|ipad|ios/.test(s)
          ? "iOS"
          : /linux/.test(s)
            ? "Linux"
            : "";
  return { label: os ? `${browser} on ${os}` : browser, icon };
}

export default function SessionsTab() {
  const confirm = useConfirm();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/settings/sessions", {
        params: { include_revoked: includeRevoked },
      });
      setSessions(res.data.items || []);
    } catch (err: any) {
      toast({
        title: "Failed to load sessions",
        description: getErrorMessage(err, ""),
        variant: "error",
      });
      setSessions([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [includeRevoked]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.username.toLowerCase().includes(q) ||
        (s.display_name || "").toLowerCase().includes(q) ||
        (s.ip_address || "").toLowerCase().includes(q) ||
        (s.user_agent || "").toLowerCase().includes(q),
    );
  }, [sessions, filter]);

  const counts = useMemo(() => {
    const active = sessions.filter((s) => !s.revoked_at).length;
    return {
      total: sessions.length,
      active,
      revoked: sessions.length - active,
    };
  }, [sessions]);

  const revoke = async (row: SessionRow) => {
    const warningSelf = row.is_current
      ? " This is your current session — you will be logged out immediately."
      : "";
    const ok = await confirm({
      title: `Revoke session for ${row.username}?`,
      description: `The user will be signed out on their next request.${warningSelf}`,
      variant: "destructive",
      confirmText: "Revoke",
    });
    if (!ok) return;
    setBusyId(row.session_id);
    try {
      await api.delete(
        `/settings/sessions/${encodeURIComponent(row.session_id)}`,
      );
      if (row.is_current) {
        // No point keeping the UI around — redirect to login.
        window.location.href = "/login";
        return;
      }
      await load();
    } catch (err: any) {
      toast({
        title: "Revoke failed",
        description: getErrorMessage(err, ""),
        variant: "error",
      });
    }
    setBusyId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Active Sessions</h3>
          <p className="text-xs text-muted-foreground">
            {counts.active} active
            {includeRevoked ? ` • ${counts.revoked} revoked/expired` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeRevoked}
              onChange={(e) => setIncludeRevoked(e.target.checked)}
            />
            Include revoked / expired
          </label>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Filter by user, IP, or browser..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {loading ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {sessions.length === 0
            ? "No sessions."
            : "No sessions match the filter."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">User</th>
                <th className="px-3 py-2 text-left font-medium">Client</th>
                <th className="px-3 py-2 text-left font-medium">IP</th>
                <th className="px-3 py-2 text-left font-medium">Last active</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
                <th className="px-3 py-2 text-left font-medium">Expires</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium w-px whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((s) => {
                const { label: uaLabel, icon: UAIcon } = describeUserAgent(
                  s.user_agent,
                );
                const isRevoked = s.revoked_at !== null;
                const expiresMs = parseBackendTs(s.expires_at);
                const isExpired =
                  !isRevoked && expiresMs != null && expiresMs < Date.now();
                return (
                  <tr
                    key={s.session_id}
                    className={
                      isRevoked || isExpired
                        ? "opacity-60"
                        : s.is_current
                          ? "bg-primary/5"
                          : ""
                    }
                  >
                    <td className="px-3 py-1.5">
                      <div className="font-medium">
                        {s.display_name || s.username}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        @{s.username} • {s.role}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className="inline-flex items-center gap-1.5"
                        title={s.user_agent || ""}
                      >
                        <UAIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate max-w-[180px]">
                          {uaLabel}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                      {s.ip_address || "—"}
                    </td>
                    <td
                      className="px-3 py-1.5 text-muted-foreground"
                      title={formatDateTime(s.last_active_at)}
                    >
                      {formatRelative(s.last_active_at, "past")}
                    </td>
                    <td
                      className="px-3 py-1.5 text-muted-foreground"
                      title={formatDateTime(s.created_at)}
                    >
                      {formatRelative(s.created_at, "past")}
                    </td>
                    <td
                      className="px-3 py-1.5 text-muted-foreground"
                      title={formatDateTime(s.expires_at)}
                    >
                      {formatRelative(s.expires_at, "future")}
                    </td>
                    <td className="px-3 py-1.5">
                      {isRevoked ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
                          revoked
                        </span>
                      ) : isExpired ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          expired
                        </span>
                      ) : s.is_current ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          current
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          active
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {!isRevoked && !isExpired && (
                        <button
                          onClick={() => revoke(s)}
                          disabled={busyId === s.session_id}
                          className="flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          title="Revoke this session"
                        >
                          <Trash2 className="h-3 w-3" /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
