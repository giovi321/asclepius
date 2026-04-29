import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Check,
  Loader2,
  ScanText,
  Brain,
  FileSearch,
  Eye,
  FolderOutput,
  FileImage,
  Layers,
  Activity,
  Hourglass,
  AlertCircle,
} from "lucide-react";
import type { PipelineStatus, PipelineJobKind } from "@/types";

const STAGE_LABELS: Record<string, string> = {
  ocr: "OCR",
  vision_extraction: "Vision",
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
  page_classification: FileSearch,
  section_extraction: Layers,
  organizing: FolderOutput,
  thumbnail: FileImage,
  cache_ocr: ScanText,
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

function kindBadge(kind: PipelineJobKind | null): {
  label: string;
  pill: string;
  ring: string;
  glow: string;
} {
  if (kind === "reprocess") {
    return {
      label: "Reprocess",
      pill: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
      ring: "ring-purple-300/60 dark:ring-purple-600/40",
      glow: "from-purple-500/10 via-purple-500/5 to-transparent",
    };
  }
  return {
    label: "Upload",
    pill: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
    ring: "ring-blue-300/60 dark:ring-blue-600/40",
    glow: "from-blue-500/10 via-blue-500/5 to-transparent",
  };
}

/** Infer the flow architecture from the planned stages.
 *
 * Backend doesn't expose ``flow`` directly on ``current_job``; the stage list
 * carries the same information unambiguously: ``vision_extraction`` only
 * appears in the Vision-LLM flow (single-step image → text + extraction),
 * everything else uses the OCR-then-LLM flow. We surface this so the user
 * can A/B-compare flows on the dashboard without having to read the stages.
 */
function flowBadge(stages: string[]): { label: string; pill: string } | null {
  if (stages.includes("vision_extraction")) {
    return {
      label: "Vision-LLM",
      pill: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
    };
  }
  if (stages.includes("ocr")) {
    return {
      label: "OCR + LLM",
      pill: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-700",
    };
  }
  return null;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

/** Tick once a second so the elapsed-time readout in the running card stays
 * live. Returns the current Date.now() — components that want a live clock
 * just call this and re-render when it changes. */
function useNow(active: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

interface Props {
  status: PipelineStatus;
}

/** Dashboard pipeline widget — one of the busiest spots in the app, so this
 * has been redesigned to read at a glance:
 *   - Live elapsed-time clock on the running card.
 *   - Connected horizontal stepper (line fills as stages complete).
 *   - Pulsing ring around the active stage.
 *   - Coloured ambient glow that hints at job kind (Upload / Reprocess).
 *   - Compact "Up next" rail underneath, scaled to feel secondary.
 */
export default function PipelineProgress({ status }: Props) {
  const job = status.current_job;
  const queued = status.queued_jobs ?? [];

  // The OCR loop only writes to the legacy ``processing_*`` fields; pull them
  // through onto current_job here so the page progress bar still works
  // without a deeper refactor of pipeline/ocr.py.
  const effectiveJob = job
    ? {
        ...job,
        page_current: job.page_current ?? status.processing_page_current,
        page_total: job.page_total ?? status.processing_pages,
        stage: job.stage ?? status.processing_step,
      }
    : null;

  if (!effectiveJob && queued.length === 0) {
    return <IdleCard status={status} />;
  }

  return (
    <div className="space-y-3">
      {effectiveJob && <RunningCard job={effectiveJob} status={status} />}
      {queued.length > 0 && <QueueCard queued={queued} />}
    </div>
  );
}

function IdleCard({ status }: { status: PipelineStatus }) {
  const stopped = status.watcher_active === false;
  const Icon = stopped ? AlertCircle : Activity;
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-muted/40 to-transparent" />
      <div className="relative flex items-center gap-4">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full ${
            stopped
              ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300"
              : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {stopped ? "Pipeline stopped" : "Pipeline idle"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {status.last_processed
              ? `Last processed: ${status.last_processed}`
              : "No documents in flight"}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
          <Stat label="Processed" value={status.total_processed} />
          <span className="opacity-30">|</span>
          <Stat
            label="Errors"
            value={status.total_errors}
            tone={status.total_errors > 0 ? "red" : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "red";
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div
        className={`text-sm font-semibold tabular-nums ${tone === "red" ? "text-red-600 dark:text-red-400" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function RunningCard({
  job,
  status,
}: {
  job: NonNullable<PipelineStatus["current_job"]>;
  status: PipelineStatus;
}) {
  const badge = kindBadge(job.kind);
  const planned = job.stages_planned ?? [];
  const flow = flowBadge(planned);
  const done = new Set(job.stages_done ?? []);
  const currentIndex = planned.findIndex((s) => s === job.stage);
  const progressIndex = currentIndex >= 0 ? currentIndex : done.size;
  const overallPct =
    planned.length > 0
      ? Math.min(
          100,
          Math.round(
            ((done.size + (currentIndex >= 0 ? 0.5 : 0)) / planned.length) *
              100,
          ),
        )
      : 0;

  const now = useNow(true);
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : null;
  const elapsed = startedAt ? Math.max(0, now - startedAt) : null;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-card p-5 ring-1 ${badge.ring}`}
    >
      {/* Ambient kind-tinted glow */}
      <div
        className={`pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-gradient-to-br ${badge.glow} blur-2xl`}
      />

      <div className="relative space-y-4">
        {/* Header: kind badge, filename, elapsed time */}
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.pill}`}
              >
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-50 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                </span>
                {badge.label}
              </span>
              {flow && (
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${flow.pill}`}
                  title={`Flow: ${flow.label}`}
                >
                  {flow.label}
                </span>
              )}
              {elapsed != null && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Hourglass className="h-3 w-3" />
                  <span className="tabular-nums">{formatElapsed(elapsed)}</span>
                </span>
              )}
            </div>
            {job.doc_id ? (
              <Link
                to={`/documents/${job.doc_id}`}
                className="block text-base font-semibold truncate hover:underline"
                title={job.filename || ""}
              >
                {job.filename || `Document #${job.doc_id}`}
              </Link>
            ) : (
              <span
                className="block text-base font-semibold truncate"
                title={job.filename || ""}
              >
                {job.filename || "(unknown)"}
              </span>
            )}
          </div>
          <div className="hidden sm:flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            <Stat label="Processed" value={status.total_processed} />
            <Stat
              label="Errors"
              value={status.total_errors}
              tone={status.total_errors > 0 ? "red" : undefined}
            />
          </div>
        </div>

        {/* Connected stepper */}
        {planned.length > 0 && (
          <Stepper
            planned={planned}
            done={done}
            currentStage={job.stage}
            progressIndex={progressIndex}
            overallPct={overallPct}
          />
        )}

        {/* Page progress (OCR phase, when known) */}
        {job.page_total && job.page_current != null && (
          <PageProgress
            current={job.page_current || 0}
            total={job.page_total}
            stage={job.stage}
          />
        )}
      </div>
    </div>
  );
}

function Stepper({
  planned,
  done,
  currentStage,
  progressIndex,
  overallPct,
}: {
  planned: string[];
  done: Set<string>;
  currentStage: string | null | undefined;
  progressIndex: number;
  overallPct: number;
}) {
  return (
    <div>
      <div className="flex items-end justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pipeline · stage {Math.min(planned.length, progressIndex + 1)} of{" "}
          {planned.length}
        </span>
        <span className="text-xs font-semibold tabular-nums">
          {overallPct}%
        </span>
      </div>

      {/* Steps with connector. The connector line sits behind the icons; the
          filled portion grows with progress. */}
      <div className="relative">
        {/* Background rail */}
        <div className="absolute left-5 right-5 top-5 h-0.5 -translate-y-1/2 bg-muted" />
        {/* Filled rail */}
        <div
          className="absolute left-5 top-5 h-0.5 -translate-y-1/2 bg-gradient-to-r from-emerald-400 to-emerald-500 transition-[width] duration-500"
          style={{
            width:
              planned.length > 1
                ? `calc((100% - 2.5rem) * ${Math.max(0, Math.min(progressIndex, planned.length - 1)) / (planned.length - 1)})`
                : "0px",
          }}
        />

        <ol
          className="relative grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${planned.length}, minmax(0, 1fr))`,
          }}
        >
          {planned.map((s, i) => {
            const isDone = done.has(s);
            const isCurrent =
              !isDone && (i === progressIndex || s === currentStage);
            const Icon = STAGE_ICONS[s] ?? FileSearch;
            return (
              <li
                key={`${s}-${i}`}
                className="flex flex-col items-center text-center"
              >
                <span
                  className={[
                    "relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                    isDone
                      ? "border-emerald-500 bg-emerald-500 text-white shadow-sm"
                      : isCurrent
                        ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
                        : "border-muted bg-card text-muted-foreground",
                  ].join(" ")}
                >
                  {/* Pulsing ring around current stage */}
                  {isCurrent && (
                    <span className="absolute inset-0 rounded-full ring-4 ring-blue-400/40 animate-pulse" />
                  )}
                  {isDone ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : isCurrent ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </span>
                <span
                  className={[
                    "mt-1.5 text-[11px] leading-tight max-w-full truncate",
                    isDone
                      ? "text-emerald-700 dark:text-emerald-300 font-medium"
                      : isCurrent
                        ? "text-blue-700 dark:text-blue-300 font-semibold"
                        : "text-muted-foreground",
                  ].join(" ")}
                  title={stageLabel(s)}
                >
                  {stageLabel(s)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function PageProgress({
  current,
  total,
  stage,
}: {
  current: number;
  total: number;
  stage: string | null | undefined;
}) {
  const pct = Math.min(100, Math.round((current / total) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">
          {stage ? `${stageLabel(stage)} · ` : ""}page {current} of {total}
        </span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 bg-[length:200%_100%] transition-[width] duration-700"
          style={{
            width: `${pct}%`,
            animation:
              pct > 0 && pct < 100 ? "shimmer 2s linear infinite" : undefined,
          }}
        />
      </div>
    </div>
  );
}

function QueueCard({
  queued,
}: {
  queued: NonNullable<PipelineStatus["queued_jobs"]>;
}) {
  return (
    <div className="rounded-xl border bg-card/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Up next
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          {queued.length} waiting
        </span>
      </div>
      <ul className="space-y-1">
        {queued.slice(0, 5).map((q, i) => {
          const badge = kindBadge(q.kind);
          const inner = (
            <>
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.pill}`}
              >
                {badge.label}
              </span>
              <span className="truncate text-sm">{q.label}</span>
            </>
          );
          const cls =
            "flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/50";
          return (
            <li key={`${q.kind}-${q.doc_id ?? "u"}-${i}`}>
              {q.doc_id ? (
                <Link to={`/documents/${q.doc_id}`} className={cls}>
                  {inner}
                </Link>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
        {queued.length > 5 && (
          <li className="px-2 pt-1 text-xs text-muted-foreground">
            + {queued.length - 5} more queued
          </li>
        )}
      </ul>
    </div>
  );
}
