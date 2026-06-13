import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  X,
  Loader2,
  Ban,
  MinusCircle,
  Brain,
  Clock,
  Hourglass,
  Upload as UploadIcon,
  RefreshCw,
  Languages,
} from "lucide-react";
import api from "@/api/client";
import type {
  DocumentStageEvent,
  DocumentStagesResponse,
  PipelineJobKind,
} from "@/types";
import { usePipelineStatus } from "@/contexts/PipelineStatusContext";
import { useCollapseState } from "@/components/document-detail/DocumentDetailHelpers";
import { parseBackendTs } from "@/lib/utils";
import { stageLabel, stageIcon, flowBadge } from "@/lib/pipelineStages";

type StatusVisual = {
  label: string;
  Icon: any;
  iconClass: string; // for the marker dot
  rowAccentClass: string; // left border accent on the card
  pillClass: string; // small status pill
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
        pillClass:
          "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      };
    case "failed":
      return {
        label: "Failed",
        Icon: X,
        iconClass: "bg-red-500 text-white",
        rowAccentClass: "border-l-red-500",
        pillClass:
          "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
      };
    case "started":
      return {
        label: "Running",
        Icon: Loader2,
        iconClass: "bg-blue-500 text-white",
        rowAccentClass: "border-l-blue-500",
        pillClass:
          "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        spin: true,
      };
    case "cancelled":
      return {
        label: "Cancelled",
        Icon: Ban,
        iconClass: "bg-amber-500 text-white",
        rowAccentClass: "border-l-amber-500",
        pillClass:
          "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
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
  const ms = parseBackendTs(ts);
  if (ms == null) return ts;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRunStartShort(ts: string | null): string {
  if (!ts) return "";
  const ms = parseBackendTs(ts);
  if (ms == null) return ts;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
/** Build a synthetic run group from ``current_job`` so the timeline reflects
 * the in-flight run before any stage event row has been written. Real DB
 * events that have already arrived (``persisted``) take precedence over the
 * synthesized ones for the same stage. */
function synthesizeLiveGroup(
  job: NonNullable<
    NonNullable<ReturnType<typeof usePipelineStatus>["status"]>
  >["current_job"],
  persisted: DocumentStageEvent[],
): RunGroup {
  const liveJob = job!;
  const planned = liveJob.stages_planned ?? [];
  const done = new Set(liveJob.stages_done ?? []);
  const persistedByStage = new Map<string, DocumentStageEvent>();
  for (const ev of persisted) persistedByStage.set(ev.stage, ev);

  const events: DocumentStageEvent[] = [];
  let syntheticId = -1;
  for (const stage of planned) {
    const real = persistedByStage.get(stage);
    if (real) {
      events.push(real);
      continue;
    }
    if (done.has(stage)) {
      events.push({
        id: syntheticId--,
        stage,
        status: "completed",
        job_kind: (liveJob.kind ?? "upload") as PipelineJobKind,
        message: null,
        page_current: null,
        page_total: null,
        started_at: liveJob.started_at,
        finished_at: null,
      });
    } else if (stage === liveJob.stage) {
      events.push({
        id: syntheticId--,
        stage,
        status: "started",
        job_kind: (liveJob.kind ?? "upload") as PipelineJobKind,
        message: null,
        page_current: liveJob.page_current ?? null,
        page_total: liveJob.page_total ?? null,
        started_at: liveJob.started_at,
        finished_at: null,
      });
    }
  }

  // Surface persisted events for stages we didn't expect (e.g. a stage that
  // was added mid-flow) so they don't get dropped.
  for (const ev of persisted) {
    if (!planned.includes(ev.stage)) events.push(ev);
  }

  return {
    job_kind: (liveJob.kind ?? "upload") as PipelineJobKind,
    events,
  };
}

function groupRuns(events: DocumentStageEvent[]): RunGroup[] {
  const groups: RunGroup[] = [];
  let current: RunGroup | null = null;
  // Stages that mark the start of a new run within the same job_kind.
  // Seeing one of these after we've already passed one in the current
  // group means the user kicked off a fresh attempt (e.g. clicked AI Edit
  // again on the same doc) — split into a new run group.
  const startStages = new Set(["ocr", "vision_extraction", "ai_edit"]);
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
  const last =
    events[events.length - 1].finished_at ||
    events[events.length - 1].started_at;
  return durationMs(first, last);
}

function runOutcome(
  events: DocumentStageEvent[],
): DocumentStageEvent["status"] {
  // Worst outcome wins so a run with one failed stage reads as failed.
  const order: DocumentStageEvent["status"][] = [
    "failed",
    "cancelled",
    "started",
    "skipped",
    "completed",
  ];
  for (const o of order) {
    if (events.some((e) => e.status === o)) return o;
  }
  return "completed";
}

function runFlowBadge(
  events: DocumentStageEvent[],
): { label: string; pill: string } | null {
  return flowBadge(events.map((e) => e.stage));
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
        const res = await api.get<DocumentStagesResponse>(
          `/documents/${documentId}/stages`,
        );
        if (!cancelled) setData(res.data);
      } catch {
        // 404 etc — leave data null, render nothing.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    if (!isLive)
      return () => {
        cancelled = true;
      };
    const interval = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [documentId, isLive]);

  const liveJob = isLive ? (pipeline?.current_job ?? null) : null;

  const groups = useMemo(() => {
    if (!data) return [];

    // When this doc is the active pipeline job, fold the in-memory current_job
    // block into the timeline. Without this the previous run's "completed"
    // events keep rendering as the latest run because stage_events.stage()
    // only persists rows on stage *exit* — long stages would otherwise leave
    // the DB empty for the new run, and groupRuns() can't see what isn't there.
    if (liveJob && liveJob.started_at) {
      const liveStartedMs = new Date(liveJob.started_at).getTime();
      const beforeLive: DocumentStageEvent[] = [];
      const duringLive: DocumentStageEvent[] = [];
      for (const ev of data.events) {
        const ts = ev.started_at ? new Date(ev.started_at).getTime() : NaN;
        if (!isNaN(ts) && ts >= liveStartedMs) duringLive.push(ev);
        else beforeLive.push(ev);
      }
      const oldGroups = groupRuns(beforeLive);
      const liveGroup = synthesizeLiveGroup(liveJob, duringLive);
      return [...oldGroups, liveGroup].reverse();
    }

    return groupRuns(data.events).reverse();
  }, [data, liveJob]);

  // Default closed: this is reference detail, not primary content.
  // Auto-open when this doc is the active pipeline job so the user sees
  // progress without clicking to expand.
  const [open, setOpen] = useCollapseState("pipeline-stages", isLive);

  if (loading) return null;
  if (!data || (data.events.length === 0 && !liveJob)) return null;

  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 hover:bg-accent/30 rounded-xl"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Pipeline stages</h2>
          <p className="text-xs text-muted-foreground">
            {groups.length} run{groups.length === 1 ? "" : "s"}
            {data.events.length > 0 &&
              ` · ${data.events.length} event${data.events.length === 1 ? "" : "s"}`}
          </p>
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
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open && (
        <div className="space-y-4 px-5 pb-5">
          {groups.map((g, gi) => (
            <RunCard key={gi} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({ group }: { group: RunGroup }) {
  const isReprocess = group.job_kind === "reprocess";
  const isTranslate =
    group.job_kind === "translate" || group.job_kind === "translate_region";
  const isRegionTranslate = group.job_kind === "translate_region";
  const isAiEdit = group.job_kind === "ai_edit";
  const KindIcon = isAiEdit
    ? Brain
    : isTranslate
      ? Languages
      : isReprocess
        ? RefreshCw
        : UploadIcon;
  const runLabel = isAiEdit
    ? "AI edit"
    : isRegionTranslate
      ? "Region translate"
      : isTranslate
        ? "Translate"
        : isReprocess
          ? "Reprocess"
          : "Upload";
  const startTs = group.events[0]?.started_at || group.events[0]?.finished_at;
  const totalMs = runDuration(group.events);
  const outcome = runOutcome(group.events);
  const outcomeVis = statusVisuals(outcome);
  const flow = runFlowBadge(group.events);

  const headerColor = isAiEdit
    ? "bg-amber-50/60 dark:bg-amber-900/15 border-amber-200/60 dark:border-amber-900"
    : isTranslate
      ? "bg-emerald-50/60 dark:bg-emerald-900/15 border-emerald-200/60 dark:border-emerald-900"
      : isReprocess
        ? "bg-purple-50/60 dark:bg-purple-900/15 border-purple-200/60 dark:border-purple-900"
        : "bg-blue-50/60 dark:bg-blue-900/15 border-blue-200/60 dark:border-blue-900";
  const kindIconColor = isAiEdit
    ? "bg-amber-500 text-white"
    : isTranslate
      ? "bg-emerald-500 text-white"
      : isReprocess
        ? "bg-purple-500 text-white"
        : "bg-blue-500 text-white";

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* Run header */}
      <div
        className={`flex items-center gap-3 border-b px-3 py-2 ${headerColor}`}
      >
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${kindIconColor}`}
        >
          <KindIcon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{runLabel} run</span>
            {/* Live-in-progress badge shown when any stage in this run is
                still ``started`` — that's the authoritative signal, and
                avoids the previous bug where the topmost (``isFirst``)
                row always painted "In progress" alongside the default
                "Completed" outcome even when the run had finished. */}
            {outcome === "started" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500 text-white px-1.5 py-0.5 text-[10px] font-semibold">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                In progress
              </span>
            ) : (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${outcomeVis.pillClass}`}
              >
                {outcomeVis.label}
              </span>
            )}
            {flow && (
              <span
                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${flow.pill}`}
                title={`Flow: ${flow.label}`}
              >
                {flow.label}
              </span>
            )}
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
          <StageRow
            key={ev.id}
            event={ev}
            isLast={i === group.events.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

function StageRow({
  event,
  isLast,
}: {
  event: DocumentStageEvent;
  isLast: boolean;
}) {
  const v = statusVisuals(event.status);
  const StageIcon = stageIcon(event.stage);
  const dur = durationMs(event.started_at, event.finished_at);

  return (
    <li className={`relative flex gap-3 ${isLast ? "" : "pb-3"}`}>
      {/* Marker on the rail */}
      <span
        className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-card ${v.iconClass}`}
        title={v.label}
      >
        <v.Icon
          className={`h-3.5 w-3.5 ${v.spin ? "animate-spin" : ""}`}
          strokeWidth={2.5}
        />
      </span>

      {/* Stage card */}
      <div
        className={`flex-1 min-w-0 rounded-md border border-l-2 bg-card px-3 py-2 ${v.rowAccentClass}`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <StageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">{stageLabel(event.stage)}</span>
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${v.pillClass}`}
          >
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
        <div
          className="mt-0.5 text-[11px] text-muted-foreground"
          title={formatTimestamp(event.finished_at)}
        >
          {formatTimestamp(event.started_at) ||
            formatTimestamp(event.finished_at)}
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
