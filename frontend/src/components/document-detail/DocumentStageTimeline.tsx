import { useEffect, useMemo, useState } from "react";
import {
  Check,
  X,
  Loader2,
  Ban,
  MinusCircle,
  ScanText,
  Brain,
  Eye,
  FolderOutput,
  FileSearch,
  Layers,
  Clock,
  Hourglass,
  Upload as UploadIcon,
  RefreshCw,
} from "lucide-react";
import api from "@/api/client";
import type {
  DocumentStageEvent,
  DocumentStagesResponse,
  PipelineJobKind,
} from "@/types";
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

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

type StatusVisual = {
  label: string;
  Icon: any;
  iconClass: string;       // for the marker dot
  rowAccentClass: string;  // left border accent on the card
  pillClass: string;       // small status pill
  spin?: boolean;
};

function statusVisuals(status: DocumentStageEvent["status"]): StatusVisual {
  switch (status) {
    case "completed":
      return {
        label: "Completed",
        Icon: Check,
        iconClass: "bg-emerald-500 text-white",
        rowAccentClass: "border-l-emerald-500",
        pillClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      };
    case "failed":
      return {
        label: "Failed",
        Icon: X,
        iconClass: "bg-red-500 text-white",
        rowAccentClass: "border-l-red-500",
        pillClass: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
      };
    case "started":
      return {
        label: "Running",
        Icon: Loader2,
        iconClass: "bg-blue-500 text-white",
        rowAccentClass: "border-l-blue-500",
        pillClass: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        spin: true,
      };
    case "cancelled":
      return {
        label: "Cancelled",
        Icon: Ban,
        iconClass: "bg-amber-500 text-white",
        rowAccentClass: "border-l-amber-500",
        pillClass: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
      };
    case "skipped":
    default:
      return {
        label: status === "skipped" ? "Skipped" : status,
        Icon: MinusCircle,
        iconClass: "bg-muted text-muted-foreground",
        rowAccentClass: "border-l-muted",
        pillClass: "bg-muted text-muted-foreground",
      };
  }
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatRunStartShort(ts: string | null): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
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

function runDuration(events: DocumentStageEvent[]): number | null {
  if (!events.length) return null;
  const first = events[0].started_at || events[0].finished_at;
  const last = events[events.length - 1].finished_at || events[events.length - 1].started_at;
  return durationMs(first, last);
}

function runOutcome(events: DocumentStageEvent[]): DocumentStageEvent["status"] {
  // Worst outcome wins so a run with one failed stage reads as failed.
  const order: DocumentStageEvent["status"][] = ["failed", "cancelled", "started", "skipped", "completed"];
  for (const o of order) {
    if (events.some((e) => e.status === o)) return o;
  }
  return "completed";
}

interface Props {
  documentId: number;
}

/** Per-document stage timeline. Reads the persisted ``document_stage_events``
 * rows and renders them as a vertical run-grouped timeline. Refetches every
 * few seconds while this doc is the active pipeline job so the user sees
 * stages tick in live. */
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

  const groups = useMemo(
    () => (data ? groupRuns(data.events).reverse() : []),
    [data],
  );

  if (loading) return null;
  if (!data || data.events.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Pipeline stages</h2>
          <p className="text-xs text-muted-foreground">
            {groups.length} run{groups.length === 1 ? "" : "s"}
            {data.events.length > 0 && ` · ${data.events.length} event${data.events.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {isLive && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-50 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
            </span>
            Live
          </span>
        )}
      </div>

      <div className="space-y-4">
        {groups.map((g, gi) => (
          <RunCard key={gi} group={g} isFirst={gi === 0 && isLive} />
        ))}
      </div>
    </div>
  );
}

function RunCard({ group, isFirst }: { group: RunGroup; isFirst: boolean }) {
  const isReprocess = group.job_kind === "reprocess";
  const KindIcon = isReprocess ? RefreshCw : UploadIcon;
  const startTs = group.events[0]?.started_at || group.events[0]?.finished_at;
  const totalMs = runDuration(group.events);
  const outcome = runOutcome(group.events);
  const outcomeVis = statusVisuals(outcome);

  const headerColor = isReprocess
    ? "bg-purple-50/60 dark:bg-purple-900/15 border-purple-200/60 dark:border-purple-900"
    : "bg-blue-50/60 dark:bg-blue-900/15 border-blue-200/60 dark:border-blue-900";
  const kindIconColor = isReprocess
    ? "bg-purple-500 text-white"
    : "bg-blue-500 text-white";

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* Run header */}
      <div className={`flex items-center gap-3 border-b px-3 py-2 ${headerColor}`}>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${kindIconColor}`}>
          <KindIcon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">
              {isReprocess ? "Reprocess" : "Upload"} run
            </span>
            {isFirst && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500 text-white px-1.5 py-0.5 text-[10px] font-semibold">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                In progress
              </span>
            )}
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${outcomeVis.pillClass}`}>
              {outcomeVis.label}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRunStartShort(startTs)}
            </span>
            {totalMs != null && (
              <span className="inline-flex items-center gap-1">
                <Hourglass className="h-3 w-3" />
                {formatDuration(totalMs)}
              </span>
            )}
            <span>
              {group.events.length} stage{group.events.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      {/* Stage events — vertical rail */}
      <ol className="relative px-4 py-3">
        {/* Vertical rail. Sits behind the markers; stops short top/bottom. */}
        <div className="absolute left-[1.4375rem] top-5 bottom-5 w-0.5 bg-muted" />

        {group.events.map((ev, i) => (
          <StageRow key={ev.id} event={ev} isLast={i === group.events.length - 1} />
        ))}
      </ol>
    </div>
  );
}

function StageRow({ event, isLast }: { event: DocumentStageEvent; isLast: boolean }) {
  const v = statusVisuals(event.status);
  const StageIcon = STAGE_ICONS[event.stage] ?? FileSearch;
  const dur = durationMs(event.started_at, event.finished_at);

  return (
    <li className={`relative flex gap-3 ${isLast ? "" : "pb-3"}`}>
      {/* Marker on the rail */}
      <span
        className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-card ${v.iconClass}`}
        title={v.label}
      >
        <v.Icon className={`h-3.5 w-3.5 ${v.spin ? "animate-spin" : ""}`} strokeWidth={2.5} />
      </span>

      {/* Stage card */}
      <div className={`flex-1 min-w-0 rounded-md border border-l-2 bg-card px-3 py-2 ${v.rowAccentClass}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <StageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">{stageLabel(event.stage)}</span>
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${v.pillClass}`}>
            {v.label}
          </span>
          {dur != null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
              <Hourglass className="h-3 w-3" />
              {formatDuration(dur)}
            </span>
          )}
          {event.page_total && event.page_current && (
            <span className="text-[11px] text-muted-foreground">
              · pages 1–{event.page_current}/{event.page_total}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground" title={formatTimestamp(event.finished_at)}>
          {formatTimestamp(event.started_at) || formatTimestamp(event.finished_at)}
        </div>
        {event.message && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400 break-words whitespace-pre-wrap">
            {event.message}
          </p>
        )}
      </div>
    </li>
  );
}
