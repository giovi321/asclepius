import { Link } from "react-router-dom";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  Loader2,
  Activity,
  Hourglass,
  AlertCircle,
  X,
} from "lucide-react";
import type {
  PipelineStatus,
  PipelineJobKind,
  PipelineProviders,
} from "@/types";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useConfirm } from "@/contexts/ConfirmContext";
import { usePipelineStatus } from "@/contexts/PipelineStatusContext";
import { useToast } from "@/contexts/ToastContext";
import { parseBackendTs } from "@/lib/utils";
import { kindBadgeClasses } from "@/lib/statusTokens";
import {
  stageLabel,
  stageIcon,
  flowBadge,
  formatElapsed,
  useNow,
} from "@/lib/pipelineStages";

function kindBadge(kind: PipelineJobKind | null): {
  label: string;
  pill: string;
  ring: string;
  glow: string;
} {
  if (kind === "reprocess") {
    return {
      label: "Reprocess",
      pill: kindBadgeClasses(kind),
      ring: "ring-cat-violet/30",
      glow: "from-cat-violet/10 via-cat-violet/5 to-transparent",
    };
  }
  if (kind === "translate") {
    return {
      label: "Translate",
      pill: kindBadgeClasses(kind),
      ring: "ring-cat-teal/30",
      glow: "from-cat-teal/10 via-cat-teal/5 to-transparent",
    };
  }
  if (kind === "ai_edit") {
    return {
      label: "AI edit",
      pill: kindBadgeClasses(kind),
      ring: "ring-warning/30",
      glow: "from-warning/10 via-warning/5 to-transparent",
    };
  }
  return {
    label: "Upload",
    pill: kindBadgeClasses("upload"),
    ring: "ring-info/30",
    glow: "from-info/10 via-info/5 to-transparent",
  };
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
              ? "bg-destructive-soft text-destructive"
              : "bg-success-soft text-success"
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
          <p className="text-xs text-muted-foreground sm:hidden">
            <span className="tabular-nums">{status.total_processed}</span>{" "}
            processed
            <span className="mx-1 opacity-30">|</span>
            <span
              className={
                status.total_errors > 0
                  ? "text-destructive font-medium tabular-nums"
                  : "tabular-nums"
              }
            >
              {status.total_errors}
            </span>{" "}
            errors
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
        className={`text-sm font-semibold tabular-nums ${tone === "red" ? "text-destructive" : ""}`}
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
  const startedAt = parseBackendTs(job.started_at);
  const elapsed = startedAt ? Math.max(0, now - startedAt) : null;
  const providers = (job.providers ?? null) as PipelineProviders | null;
  const providerNames = (job.provider_names ??
    null) as PipelineProviders | null;

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
            <div className="flex flex-wrap items-center gap-2">
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
          {job.doc_id != null && (
            <CancelJobButton
              docId={job.doc_id}
              filename={job.filename}
              variant="running"
            />
          )}
        </div>

        {/* Models in use */}
        {providers && (
          <ProvidersRow
            providers={providers}
            providerNames={providerNames}
            activeProviderId={job.stage_provider ?? null}
          />
        )}

        {/* Stage progress: compact bar + disclosure below md, connected
            horizontal stepper at md+ (the stepper's equal-width grid crushes
            to unreadable columns on phone widths). */}
        {planned.length > 0 && (
          <>
            <div className="md:hidden">
              <MobileStages
                planned={planned}
                done={done}
                currentStage={job.stage}
                progressIndex={progressIndex}
                overallPct={overallPct}
                providers={providers}
                providerNames={providerNames}
              />
            </div>
            <div className="hidden md:block">
              <Stepper
                planned={planned}
                done={done}
                currentStage={job.stage}
                progressIndex={progressIndex}
                overallPct={overallPct}
                providers={providers}
                providerNames={providerNames}
              />
            </div>
          </>
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

function providerForStage(
  stage: string,
  providers: PipelineProviders | null,
): string | null {
  if (!providers) return null;
  if (stage === "ocr" || stage === "cache_ocr") return providers.ocr ?? null;
  if (stage === "vision_extraction") return providers.vision ?? null;
  return providers.llm ?? null;
}

/** Prefer the user-chosen display name when the backend supplied one, else
 * fall back to the raw provider id. Both are keyed by family. */
function providerLabelForStage(
  stage: string,
  providers: PipelineProviders | null,
  providerNames: PipelineProviders | null,
): string | null {
  return (
    providerForStage(stage, providerNames) ?? providerForStage(stage, providers)
  );
}

function Stepper({
  planned,
  done,
  currentStage,
  progressIndex,
  overallPct,
  providers,
  providerNames,
}: {
  planned: string[];
  done: Set<string>;
  currentStage: string | null | undefined;
  progressIndex: number;
  overallPct: number;
  providers?: PipelineProviders | null;
  providerNames?: PipelineProviders | null;
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
          className="absolute left-5 top-5 h-0.5 -translate-y-1/2 bg-success transition-[width] duration-500"
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
            const Icon = stageIcon(s);
            return (
              <li
                key={`${s}-${i}`}
                className="flex flex-col items-center text-center"
              >
                <span
                  className={[
                    "relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                    isDone
                      ? "border-success bg-success text-white shadow-sm"
                      : isCurrent
                        ? "border-info bg-info-soft text-info"
                        : "border-muted bg-card text-muted-foreground",
                  ].join(" ")}
                >
                  {/* Pulsing ring around current stage */}
                  {isCurrent && (
                    <span className="absolute inset-0 rounded-full ring-4 ring-info/40 animate-pulse" />
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
                      ? "text-success font-medium"
                      : isCurrent
                        ? "text-info font-semibold"
                        : "text-muted-foreground",
                  ].join(" ")}
                  title={stageLabel(s)}
                >
                  {stageLabel(s)}
                </span>
                {providerLabelForStage(
                  s,
                  providers ?? null,
                  providerNames ?? null,
                ) && (
                  <span
                    className="mt-0.5 text-[10px] leading-tight max-w-full truncate text-muted-foreground/80"
                    title={
                      providerLabelForStage(
                        s,
                        providers ?? null,
                        providerNames ?? null,
                      ) ?? undefined
                    }
                  >
                    {providerLabelForStage(
                      s,
                      providers ?? null,
                      providerNames ?? null,
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Compact stage readout for phone widths: overall progress bar, a one-line
 * "Stage x of y · <stage> · <provider>" summary, and a "Details" disclosure
 * expanding a vertical checklist of the planned stages. Replaces the
 * horizontal Stepper below md. */
function MobileStages({
  planned,
  done,
  currentStage,
  progressIndex,
  overallPct,
  providers,
  providerNames,
}: {
  planned: string[];
  done: Set<string>;
  currentStage: string | null | undefined;
  progressIndex: number;
  overallPct: number;
  providers?: PipelineProviders | null;
  providerNames?: PipelineProviders | null;
}) {
  const activeStage =
    currentStage && planned.includes(currentStage)
      ? currentStage
      : planned[Math.min(progressIndex, planned.length - 1)];
  const activeProvider = providerLabelForStage(
    activeStage,
    providers ?? null,
    providerNames ?? null,
  );
  const summary = [
    `Stage ${Math.min(planned.length, progressIndex + 1)} of ${planned.length}`,
    stageLabel(activeStage),
    activeProvider ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <div className="mb-1 flex items-end justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pipeline
        </span>
        <span className="text-xs font-semibold tabular-nums">
          {overallPct}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-info transition-[width] duration-500"
          style={{ width: `${overallPct}%` }}
        />
      </div>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{summary}</p>

      <details className="group/stages mt-1">
        <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1 py-1 text-xs font-medium text-muted-foreground coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/stages:rotate-90" />
          Details
        </summary>
        <ol className="mt-1 space-y-1.5">
          {planned.map((s, i) => {
            const isDone = done.has(s);
            const isCurrent =
              !isDone && (i === progressIndex || s === currentStage);
            const provider = providerLabelForStage(
              s,
              providers ?? null,
              providerNames ?? null,
            );
            return (
              <li key={`${s}-${i}`} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {isDone ? (
                    <Check className="h-4 w-4 text-success" strokeWidth={3} />
                  ) : isCurrent ? (
                    <Loader2 className="h-4 w-4 animate-spin text-info" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                  )}
                </span>
                <span
                  className={[
                    "truncate text-xs",
                    isDone
                      ? "text-success font-medium"
                      : isCurrent
                        ? "text-info font-semibold"
                        : "text-muted-foreground",
                  ].join(" ")}
                >
                  {stageLabel(s)}
                </span>
                {provider && (
                  <span
                    className="min-w-0 truncate text-[10px] text-muted-foreground/80"
                    title={provider}
                  >
                    {provider}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </details>
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
          className="h-full rounded-full bg-gradient-to-r from-info via-info/70 to-info bg-[length:200%_100%] transition-[width] duration-700"
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
          Queue
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          {queued.length} waiting
        </span>
      </div>
      <ul className="space-y-1">
        {queued.slice(0, 5).map((q, i) => {
          const badge = kindBadge(q.kind);
          // Upload jobs in queue have no stable doc_id and the cancel
          // endpoint is keyed by doc_id, so we can't cancel them from here
          // yet — disable the button with a tooltip rather than hide it.
          const cancellable =
            (q.kind === "reprocess" || q.kind === "translate") &&
            q.doc_id != null;
          const inner = (
            <>
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.pill}`}
              >
                {badge.label}
              </span>
              <span className="truncate text-sm flex-1">{q.label}</span>
              {q.providers && (
                <ProviderPills
                  providers={q.providers}
                  providerNames={q.provider_names ?? null}
                />
              )}
            </>
          );
          const cls =
            "flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/50";
          return (
            <li
              key={`${q.kind}-${q.doc_id ?? "u"}-${i}`}
              className="group flex items-center gap-1"
            >
              <div className="flex-1 min-w-0">
                {q.doc_id ? (
                  <Link to={`/documents/${q.doc_id}`} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </div>
              <CancelJobButton
                docId={q.doc_id}
                filename={q.label}
                variant="queued"
                disabled={!cancellable}
              />
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

type ProviderEntry = {
  family: string;
  familyKey: keyof PipelineProviders;
  id: string;
  label: string;
};

function buildProviderEntries(
  providers: PipelineProviders,
  providerNames: PipelineProviders | null | undefined,
): ProviderEntry[] {
  const out: ProviderEntry[] = [];
  if (providers.ocr) {
    out.push({
      family: "OCR",
      familyKey: "ocr",
      id: providers.ocr,
      label: providerNames?.ocr || providers.ocr,
    });
  }
  if (providers.vision) {
    out.push({
      family: "Vision",
      familyKey: "vision",
      id: providers.vision,
      label: providerNames?.vision || providers.vision,
    });
  }
  if (providers.llm) {
    out.push({
      family: "LLM",
      familyKey: "llm",
      id: providers.llm,
      label: providerNames?.llm || providers.llm,
    });
  }
  return out;
}

function ProvidersRow({
  providers,
  providerNames,
  activeProviderId,
}: {
  providers: PipelineProviders;
  providerNames?: PipelineProviders | null;
  activeProviderId: string | null;
}) {
  const entries = buildProviderEntries(providers, providerNames);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Models
      </span>
      {entries.map(({ family, id, label }) => {
        const active = id === activeProviderId;
        const showRawId = label !== id;
        return (
          <span
            key={family}
            className={[
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5",
              active
                ? "border-info/25 bg-info-soft text-info"
                : "border-muted bg-muted/40 text-muted-foreground",
            ].join(" ")}
            title={
              showRawId ? `${family}: ${label} (${id})` : `${family}: ${id}`
            }
          >
            <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
              {family}
            </span>
            <span className="truncate max-w-[160px]">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function ProviderPills({
  providers,
  providerNames,
}: {
  providers: PipelineProviders;
  providerNames?: PipelineProviders | null;
}) {
  const entries = buildProviderEntries(providers, providerNames);
  if (entries.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {entries.map(({ family, id, label }) => {
        const showRawId = label !== id;
        return (
          <span
            key={family}
            className="inline-flex items-center gap-0.5 rounded border border-muted bg-muted/40 px-1 py-0.5 text-[9px] text-muted-foreground"
            title={
              showRawId ? `${family}: ${label} (${id})` : `${family}: ${id}`
            }
          >
            <span className="font-semibold uppercase tracking-wide opacity-70">
              {family}
            </span>
            <span className="truncate max-w-[100px]">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Cancel button used by both the running card and queued rows. Reuses
 * /api/documents/{id}/cancel: that endpoint sets cancelled_docs which the
 * worker's pop-guard now honours for queued reprocess too. Confirms first. */
function CancelJobButton({
  docId,
  filename,
  variant,
  disabled,
}: {
  docId: number | null;
  filename: string | null | undefined;
  variant: "running" | "queued";
  disabled?: boolean;
}) {
  const confirm = useConfirm();
  const { refresh } = usePipelineStatus();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || docId == null) return;
    const ok = await confirm({
      title:
        variant === "running"
          ? "Cancel running extraction?"
          : "Remove from queue?",
      description:
        variant === "running"
          ? `The current stage on ${filename || `doc#${docId}`} will be aborted and the document marked as cancelled.`
          : `${filename || `doc#${docId}`} will be removed from the queue and marked as cancelled.`,
      confirmText: "Cancel job",
      cancelText: "Keep",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      setBusy(true);
      await api.post(`/documents/${docId}/cancel`);
      await refresh();
    } catch (err: any) {
      toast({
        title: "Failed to cancel",
        description: getErrorMessage(err),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const title = disabled
    ? "Upload jobs can't be cancelled from the queue yet"
    : variant === "running"
      ? "Cancel this extraction"
      : "Remove from queue";

  if (variant === "running") {
    return (
      <button
        type="button"
        onClick={handle}
        disabled={disabled || busy || docId == null}
        title={title}
        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive-soft disabled:opacity-40 disabled:cursor-not-allowed coarse:min-h-11 coarse:px-3"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
        Cancel
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={disabled || busy || docId == null}
      title={title}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 coarse:h-11 coarse:w-11 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <X className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
