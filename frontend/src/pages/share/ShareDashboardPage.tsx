import { Link } from "react-router-dom";
import { LogOut, FileText, Calendar, Clock } from "lucide-react";

import { useShareSession } from "@/contexts/ShareSessionContext";

/**
 * Doctor's home view inside an active share.
 *
 * Lists the curated documents and shows the session countdown. Each row
 * links into ShareDocumentPage. There is intentionally no upload, no
 * "share more docs" affordance, and no patient-level navigation: the
 * doctor sees this share's documents and nothing else.
 */
export default function ShareDashboardPage() {
  const { me, loading, logout } = useShareSession();

  if (loading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }
  if (!me) return null;

  const sessionExpiresLocal = formatLocal(me.session_expires_at);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{me.patient_name}</h1>
            <p className="text-xs text-muted-foreground">
              Shared with {me.recipient_label} · session expires{" "}
              {sessionExpiresLocal}
            </p>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
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
                  className="flex items-start gap-3 rounded-lg border bg-card p-4 hover:border-primary transition-colors"
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

        <p className="mt-8 inline-flex items-center gap-1 text-xs text-muted-foreground border-t pt-4">
          <Clock className="h-3 w-3" /> Translate is rate-limited to keep costs
          predictable. After the session expires you will need a new access
          code.
        </p>
      </main>
    </div>
  );
}

function formatLocal(iso: string): string {
  try {
    const dt = new Date(iso + "Z"); // backend writes UTC ISO without Z
    return dt.toLocaleString();
  } catch {
    return iso;
  }
}
