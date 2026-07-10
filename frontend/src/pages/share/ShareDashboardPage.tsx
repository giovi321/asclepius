import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, FileText, Calendar, Moon, Sun } from "lucide-react";

import { useShareSession } from "@/contexts/ShareSessionContext";
import ShareLogo from "@/components/share/ShareLogo";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Doctor's home view inside an active share.
 *
 * Lists the curated documents and shows the session countdown. Each row
 * links into ShareDocumentPage. There is intentionally no upload, no
 * "share more docs" affordance, and no patient-level navigation: the
 * doctor sees this share's documents and nothing else.
 */
export default function ShareDashboardPage() {
  const { me, loading, logout, theme, toggleTheme } = useShareSession();

  if (loading) {
    return (
      <div className="min-h-dvh bg-muted/30">
        <main className="max-w-5xl mx-auto px-4 py-6 space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-2/3" />
            </div>
          ))}
        </main>
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <ShareLogo size="sm" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">
                {me.patient_name}
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                Shared with {me.recipient_label}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-xs text-muted-foreground sm:mr-0">
              Automatic logout in{" "}
              <SessionCountdown iso={me.session_expires_at} />
            </p>
            <IconButton
              onClick={toggleTheme}
              variant="secondary"
              label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </IconButton>
            <Button variant="secondary" size="md" onClick={logout}>
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {me.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents in this share.
          </p>
        ) : (
          <ul className="space-y-2">
            {me.documents.map((d) => (
              <li key={d.id}>
                <Link
                  to={`/share/documents/${d.id}`}
                  className="flex min-h-11 items-start gap-3 rounded-lg border bg-card p-4 hover:border-primary transition-colors"
                >
                  <FileText className="h-5 w-5 text-primary mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {d.original_filename || d.doc_type || "Untitled"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {d.doc_type && <span>{d.doc_type}</span>}
                      {d.event_date && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> {d.event_date}
                        </span>
                      )}
                      {d.specialty_display && (
                        <span>{d.specialty_display}</span>
                      )}
                      {d.facility_name && <span>{d.facility_name}</span>}
                    </div>
                    {d.summary_en && (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                        {d.summary_en}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

/**
 * Live countdown until a UTC ISO timestamp. Updates every second.
 *
 * The backend writes session expiry as a naive UTC ISO ("2026-05-02T..."
 * with no trailing Z), so we append the Z explicitly before constructing
 * a Date — otherwise the browser interprets it in local time and the
 * countdown is off by the local UTC offset.
 */
function SessionCountdown({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const target = new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
  const remaining = Math.max(0, Math.floor((target - now) / 1000));
  return <span className="font-mono">{formatDuration(remaining)}</span>;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0)
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
