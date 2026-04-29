import { useEffect, useState } from "react";
import { Check, X, Loader2, Ban, MinusCircle, ScanText, Brain, Eye, FolderOutput, FileSearch, Layers } from "lucide-react";
import api from "@/api/client";
import type { DocumentStageEvent, DocumentStagesResponse, PipelineJobKind } from "@/types";
import { usePipelineStatus } from "@/contexts/PipelineStatusContext";

const STAGE_LABELS: Record<string, string> = {
  ocr: "OCR",
  vision_extraction: "Vision extraction",
  llm_extraction: "LLM extraction",
  page_classification: "Page classification",
  section_extraction: "Section extraction",
  organizing: "Organizing",
  thumbnail: "Thumbnail",
  cache_ocr: "Cache OCR",
};

const STAGE_ICONS: Record<string, any> = {
  ocr: ScanText,
  vision_extraction: Eye,
  llm_extraction: Brain,
  organizing: FolderOutput,
  page_classification: FileSearch,
  section_extraction: Layers,
};

function statusVisuals(status: DocumentStageEvent["status"]) {
  switch (status) {
    case "completed":
      return { Icon: Check, className: "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800" };
    case "failed":
      return { Icon: X, className: "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800" };
    case "started":
      return { Icon: Loader2, className: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800", spin: true };
    case "cancelled":
      return { Icon: Ban, className: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800" };
    case "skipped":
      return { Icon: MinusCircle, className: "bg-muted text-muted-foreground border-muted" };
    default:
      return { Icon: MinusCircle, className: "bg-muted text-muted-foreground border-muted" };
  }
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function durationMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, b - a);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

interface RunGroup {
  job_kind: PipelineJobKind;
  events: DocumentStageEvent[];
}

/** Group events by run.
 *
 * A "run" is a contiguous sequence of events that share a job_kind and don't
 * have a long gap between them. We start a fresh group whenever the job_kind
 * changes OR whenever we see a new ``ocr`` / ``vision_extraction`` event
 * after we've already passed one in the current group — that's the signal
 * the user clicked Reprocess again. */
function groupRuns(events: DocumentStageEvent[]): RunGroup[] {
  const groups: RunGroup[] = [];
  let current: RunGroup | null = null;
  const startStages = new Set(["ocr", "vision_extraction"]);
  let seenStart = false;
  for (const ev of events) {
    const isStart = startStages.has(ev.stage);
    if (
      !current ||
      current.job_kind !== ev.job_kind ||
      (isStart && seenStart)
    ) {
      current = { job_kind: ev.job_kind, events: [] };
      groups.push(current);
      seenStart = false;
    }
    if (isStart) seenStart = true;
    current.events.push(ev);
  }
  return groups;
}

interface Props {
  documentId: number;
}

/** Per-document stage timeline. Reads the persisted ``document_stage_events``
 * rows and renders them as a vertical list grouped by run (one group per
 * upload / reprocess invocation). Refetches every few seconds while this doc
 * is the one currently in the pipeline so the user sees stages tick in. */
export default function DocumentStageTimeline({ documentId }: Props) {
  const [data, setData] = useState<DocumentStagesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { status: pipeline } = usePipelineStatus();

  const isLive = pipeline?.current_job?.doc_id === documentId;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get<DocumentStagesResponse>(`/documents/${documentId}/stages`);
        if (!cancelled) setData(res.data);
      } catch {
        // 404 etc — leave data null, render nothing.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    if (!isLive) return () => { cancelled = true; };
    const interval = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [documentId, isLive]);

  if (loading) return null;
  if (!data || data.events.length === 0) return null;

  const groups = groupRuns(data.events);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Pipeline stages</h2>
        {isLive && (
          <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Updating live
          </span>
        )}
      </div>

      <div className="space-y-4">
        {groups.map((g, gi) => (
          <div key={gi} className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className={`uppercase tracking-wide rounded px-1.5 py-0.5 border ${
                g.job_kind === "reprocess"
                  ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800"
                  : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800"
              }`}>
                {g.job_kind === "reprocess" ? "Reprocess run" : "Upload run"}
              </span>
              <span className="text-muted-foreground">
                {formatTimestamp(g.events[0]?.started_at || g.events[0]?.finished_at)}
              </span>
            </div>

            <ol className="space-y-1.5 pl-1 border-l-2 border-muted ml-2">
              {g.events.map((ev) => {
                const v = statusVisuals(ev.status);
                const Icon = v.Icon;
                const StageIcon = STAGE_ICONS[ev.stage] ?? FileSearch;
                const dur = durationMs(ev.started_at, ev.finished_at);
                return (
                  <li key={ev.id} className="relative pl-4">
                    <span className={`absolute -left-2 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full border ${v.className}`}>
                      <Icon className={`h-2.5 w-2.5 ${"spin" in v && (v as any).spin ? "animate-spin" : ""}`} />
                    </span>
                    <div className="flex items-center gap-2 text-sm">
                      <StageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{STAGE_LABELS[ev.stage] ?? ev.stage}</span>
                      <span className="text-xs text-muted-foreground">{ev.status}</span>
                      {dur != null && (
                        <span className="text-xs text-muted-foreground">· {formatDuration(dur)}</span>
                      )}
                      {ev.page_total && ev.page_current && (
                        <span className="text-xs text-muted-foreground">· page {ev.page_current}/{ev.page_total}</span>
                      )}
                    </div>
                    {ev.message && (
                      <p className="text-xs text-destructive break-words">{ev.message}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
