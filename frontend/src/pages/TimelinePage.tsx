import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Loader2 } from "lucide-react";

interface TimelineDoc {
  id: number;
  doc_type: string;
  doc_date: string | null;
  date_visit: string | null;
  date_issued: string | null;
  original_filename: string;
  doctor_name: string | null;
  facility_name: string | null;
  summary_en: string | null;
  event_title: string | null;
  event_type: string | null;
  event_color: string | null;
}

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  specialist_report: { bg: "bg-primary/10", text: "text-primary", dot: "bg-primary", label: "Specialist Report" },
  discharge: { bg: "bg-primary/10", text: "text-primary", dot: "bg-primary", label: "Discharge" },
  er_report: { bg: "bg-primary/10", text: "text-primary", dot: "bg-primary", label: "ER Report" },
  surgical_report: { bg: "bg-primary/10", text: "text-primary", dot: "bg-primary", label: "Surgical Report" },
  bloodtest: { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500", label: "Blood Test" },
  labtest_other: { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500", label: "Lab Test" },
  invoice: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", label: "Invoice" },
  receipt: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", label: "Receipt" },
  insurance_claim: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", label: "Insurance" },
  radiology_report: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500", label: "Radiology" },
  imaging_dicom: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500", label: "DICOM" },
  prescription: { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500", label: "Prescription" },
  vaccination: { bg: "bg-teal-500/10", text: "text-teal-600 dark:text-teal-400", dot: "bg-teal-500", label: "Vaccination" },
};

function getStyle(t: string) {
  return TYPE_COLORS[t] || { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground", label: t?.replace(/_/g, " ") || "Other" };
}

function bestDate(d: TimelineDoc) { return d.date_visit || d.date_issued || d.doc_date || ""; }

function fmtDate(s: string | null) {
  if (!s) return "No date";
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function getYear(s: string | null): string { return s ? s.substring(0, 4) : "Unknown"; }

export default function TimelinePage() {
  const { selectedPatient } = usePatient();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<TimelineDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetDate, setTargetDate] = useState("");
  const [currentYear, setCurrentYear] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const yearRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mainRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const [viewportIndicator, setViewportIndicator] = useState({ top: 0, height: 0 });

  // Restore scroll position when returning from document detail
  useEffect(() => {
    if (!loading && documents.length > 0 && mainRef.current) {
      const saved = sessionStorage.getItem("timeline_scroll");
      if (saved) {
        const parent = mainRef.current.closest("main");
        if (parent) parent.scrollTop = parseInt(saved, 10);
        sessionStorage.removeItem("timeline_scroll");
      }
    }
  }, [loading, documents.length]);

  const openDocument = (docId: number, e: React.MouseEvent) => {
    // Save scroll position before navigating
    const parent = mainRef.current?.closest("main");
    if (parent) sessionStorage.setItem("timeline_scroll", String(parent.scrollTop));

    // Middle-click or ctrl/cmd+click → new tab
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      window.open(`/documents/${docId}`, "_blank");
    } else {
      navigate(`/documents/${docId}`);
    }
  };

  useEffect(() => {
    setLoading(true);
    const params: Record<string, any> = { limit: 5000 };
    if (selectedPatient) params.patient_id = selectedPatient.id;
    api.get("/documents", { params })
      .then((res) => {
        const items: TimelineDoc[] = res.data.items || res.data || [];
        items.sort((a, b) => {
          const da = bestDate(a), db = bestDate(b);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return db.localeCompare(da);
        });
        setDocuments(items);
      })
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [selectedPatient]);

  // Group by year
  const grouped: Record<string, TimelineDoc[]> = {};
  for (const doc of documents) {
    const y = getYear(bestDate(doc) || null);
    if (!grouped[y]) grouped[y] = [];
    grouped[y].push(doc);
  }
  const years = Object.keys(grouped).sort((a, b) => {
    if (a === "Unknown") return 1;
    if (b === "Unknown") return -1;
    return b.localeCompare(a);
  });

  // Scroll to target date
  const scrollToDate = () => {
    if (!targetDate) return;
    const targetYear = targetDate.substring(0, 4);
    const el = yearRefs.current[targetYear];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Track which year is visible + position viewport indicator on mini-map
  useEffect(() => {
    if (years.length === 0) return;
    const scrollParent = mainRef.current?.closest("main") || window;

    const updateIndicator = () => {
      // Find which year section is in the viewport
      const viewHeight = window.innerHeight;

      for (const y of years) {
        const el = yearRefs.current[y];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        // Year section is visible if its top is in the upper half of viewport
        if (rect.top <= viewHeight * 0.4 && rect.bottom > 0) {
          setCurrentYear(y);
        }
      }

      // Position the viewport indicator on the mini-map
      const minimap = minimapRef.current;
      const timeline = scrollRef.current;
      if (!minimap || !timeline) return;

      const timelineRect = timeline.getBoundingClientRect();
      const minimapRect = minimap.getBoundingClientRect();
      const timelineH = timeline.scrollHeight;

      if (timelineH <= 0 || minimapRect.height <= 0) return;

      // How much of the timeline is above the viewport top
      const scrolledPast = -timelineRect.top;
      const visibleFraction = viewHeight / timelineH;
      const scrollFraction = scrolledPast / timelineH;

      const indicatorTop = Math.max(0, scrollFraction * minimapRect.height);
      const indicatorHeight = Math.max(8, Math.min(minimapRect.height, visibleFraction * minimapRect.height));

      setViewportIndicator({ top: indicatorTop, height: indicatorHeight });
    };

    const target = scrollParent instanceof Element ? scrollParent : window;
    target.addEventListener("scroll", updateIndicator, { passive: true });
    window.addEventListener("resize", updateIndicator, { passive: true });
    // Initial position
    requestAnimationFrame(updateIndicator);

    return () => {
      target.removeEventListener("scroll", updateIndicator);
      window.removeEventListener("resize", updateIndicator);
    };
  }, [years.join(",")]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div ref={mainRef}>
      {documents.length === 0 ? (
        <p className="text-muted-foreground">
          No documents found.
          {selectedPatient && ' Try selecting "All patients" in the sidebar.'}
        </p>
      ) : (
        <div className="flex gap-4">
          {/* Mini-map sidebar */}
          <div className="hidden md:flex flex-col sticky top-0 h-[calc(100vh-12rem)] pt-2">
            <div ref={minimapRef} className="relative flex-1 flex flex-col justify-between py-2 pl-1 pr-2">
              {/* Vertical line */}
              <div className="absolute left-[3px] top-0 bottom-0 w-0.5 bg-border" />

              {/* Viewport indicator — shows current visible area */}
              <div
                className="absolute left-0 right-0 bg-primary/10 border-l-2 border-primary rounded-r-sm pointer-events-none transition-all duration-150"
                style={{ top: viewportIndicator.top, height: viewportIndicator.height }}
              />

              {years.map((year) => {
                const isActive = currentYear === year;
                const count = grouped[year].length;
                // Collect months for this year
                const months = new Set<string>();
                for (const doc of grouped[year]) {
                  const d = bestDate(doc);
                  if (d && d.length >= 7) months.add(d.substring(0, 7)); // "YYYY-MM"
                }
                const monthLabels = Array.from(months).sort().reverse().map((m) => {
                  const dt = new Date(m + "-01");
                  return dt.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
                });
                const tooltip = `${year} — ${count} doc${count !== 1 ? "s" : ""}${monthLabels.length > 0 ? "\n" + monthLabels.join(", ") : ""}`;
                return (
                  <button
                    key={year}
                    onClick={() => {
                      const el = yearRefs.current[year];
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className={`relative z-10 text-left pl-3 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? "text-primary font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title={tooltip}
                  >
                    {/* Tick mark on the line */}
                    <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-0.5 ${
                      isActive ? "bg-primary" : "bg-muted-foreground/40"
                    }`} />
                    {year}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main timeline */}
          <div ref={scrollRef} className="flex-1 relative pl-6 overflow-y-auto">
            {/* Vertical line */}
            <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-border" />

            {years.map((year) => (
              <div
                key={year}
                ref={(el) => { yearRefs.current[year] = el; }}
                data-year={year}
                className="mb-6"
              >
                {/* Year label */}
                <div className="relative flex items-center mb-3 -ml-6">
                  <div className="w-6 flex justify-center">
                    <div className="h-1 w-3 bg-primary rounded-full" />
                  </div>
                  <span className="ml-2 text-lg font-bold">{year}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({grouped[year].length} document{grouped[year].length !== 1 ? "s" : ""})
                  </span>
                </div>

                {/* Documents */}
                {grouped[year].map((doc) => {
                  const style = getStyle(doc.doc_type);
                  return (
                    <div key={doc.id} className="relative mb-2">
                      {/* Tick mark aligned with line */}
                      <div className="absolute -left-6 top-5 w-6 flex justify-center">
                        <div className={`h-0.5 w-2 rounded-full ${style.dot}`} />
                      </div>

                      {/* Card */}
                      <button
                        onClick={(e) => openDocument(doc.id, e)}
                        onAuxClick={(e) => { if (e.button === 1) openDocument(doc.id, e); }}
                        className="w-full rounded-lg border bg-card text-left transition-colors hover:bg-accent/50 overflow-hidden"
                      >
                        {/* Medical event banner */}
                        {doc.event_title && (
                          <div
                            className="px-3 py-1.5 text-xs font-semibold flex items-center gap-2"
                            style={{
                              backgroundColor: doc.event_color ? `${doc.event_color}20` : "rgb(var(--primary) / 0.1)",
                              color: doc.event_color || "rgb(var(--primary))",
                              borderBottom: `2px solid ${doc.event_color || "rgb(var(--primary))"}`,
                            }}
                          >
                            <span className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: doc.event_color || "rgb(var(--primary))" }} />
                            {doc.event_title}
                            {doc.event_type && (
                              <span className="opacity-60 text-[10px] font-normal">
                                {doc.event_type.replace(/_/g, " ")}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="p-3">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-sm font-medium">{fmtDate(bestDate(doc) || null)}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}>
                              {style.label}
                            </span>
                          </div>
                          <p className="text-sm font-medium truncate">{doc.original_filename}</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            {doc.doctor_name && <span>{doc.doctor_name}</span>}
                            {doc.facility_name && <span>{doc.facility_name}</span>}
                          </div>
                          {doc.summary_en && (
                            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{doc.summary_en}</p>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Floating "Go to date" picker — bottom right */}
      {documents.length > 0 && (
        <div className="fixed bottom-6 right-6 z-20 flex items-center gap-2 rounded-lg border bg-background shadow-lg px-3 py-2">
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
          <button onClick={scrollToDate}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 whitespace-nowrap">
            Go to date
          </button>
        </div>
      )}
    </div>
  );
}
