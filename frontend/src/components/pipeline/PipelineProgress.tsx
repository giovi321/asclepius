import { Link } from "react-router-dom";
import { Check, Loader2, ScanText, Brain, FileSearch, Eye, FolderOutput, FileImage, Layers } from "lucide-react";
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

function kindBadge(kind: PipelineJobKind | null): { label: string; className: string } {
  if (kind === "reprocess") {
    return {
      label: "Reprocess",
      className: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800",
    };
  }
  return {
    label: "Upload",
    className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800",
  };
}

interface Props {
  status: PipelineStatus;
}

/** Dashboard widget showing the current pipeline job: which doc is processing,
 * which stages are done, which is in flight, and what's queued behind it.
 *
 * Replaces the old single-line "Processing: X | Step: Y" display.
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
    return (
      <div className="rounded-lg border p-4">
        <h2 className="mb-2 font-medium">Pipeline</h2>
        <p className="text-sm text-muted-foreground">
          {status.watcher_active === false ? "Stopped" : "Idle"}
          {status.last_processed ? ` — last processed: ${status.last_processed}` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Processed: {status.total_processed} · Errors: {status.total_errors}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Pipeline</h2>
        <span className="text-xs text-muted-foreground">
          Processed: {status.total_processed} · Errors: {status.total_errors}
        </span>
      </div>

      {effectiveJob && <CurrentJob job={effectiveJob} />}

      {queued.length > 0 && (
        <div className="border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Up next ({queued.length})
          </p>
          <ul className="space-y-1 text-sm">
            {queued.slice(0, 5).map((q, i) => {
              const badge = kindBadge(q.kind);
              const inner = (
                <>
                  <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="truncate">{q.label}</span>
                </>
              );
              return (
                <li key={`${q.kind}-${q.doc_id ?? "u"}-${i}`} className="flex items-center gap-2">
                  {q.doc_id ? (
                    <Link to={`/documents/${q.doc_id}`} className="flex items-center gap-2 min-w-0 hover:underline">
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">{inner}</div>
                  )}
                </li>
              );
            })}
            {queued.length > 5 && (
              <li className="text-xs text-muted-foreground">
                + {queued.length - 5} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function CurrentJob({ job }: { job: NonNullable<PipelineStatus["current_job"]> }) {
  const badge = kindBadge(job.kind);
  const planned = job.stages_planned ?? [];
  const done = new Set(job.stages_done ?? []);
  const currentIndex = planned.findIndex((s) => s === job.stage);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${badge.className}`}>
          {badge.label}
        </span>
        {job.doc_id ? (
          <Link to={`/documents/${job.doc_id}`} className="text-sm font-medium truncate hover:underline">
            {job.filename || `Document #${job.doc_id}`}
          </Link>
        ) : (
          <span className="text-sm font-medium truncate">{job.filename || "(unknown)"}</span>
        )}
      </div>

      {planned.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {planned.map((s, i) => {
            const isDone = done.has(s);
            const isCurrent = !isDone && (i === currentIndex || s === job.stage);
            const Icon = STAGE_ICONS[s] ?? FileSearch;
            const cls = isDone
              ? "border-green-300 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800"
              : isCurrent
              ? "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800"
              : "border-muted text-muted-foreground";
            return (
              <div key={`${s}-${i}`} className="flex items-center gap-1">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${cls}`}>
                  {isDone ? (
                    <Check className="h-3 w-3" />
                  ) : isCurrent ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                  {stageLabel(s)}
                </span>
                {i < planned.length - 1 && (
                  <span className="text-muted-foreground">→</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {job.page_total && job.page_current != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Page {job.page_current} of {job.page_total}
              {job.stage ? ` · ${stageLabel(job.stage)}` : ""}
            </span>
            <span className="font-medium tabular-nums">
              {Math.round(((job.page_current || 0) / job.page_total) * 100)}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${((job.page_current || 0) / job.page_total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
