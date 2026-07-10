import { type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { Hourglass, Loader2 } from "lucide-react";
import { usePipelineStatus } from "@/contexts/PipelineStatusContext";
import type { PipelineProviders } from "@/types";
import { parseBackendTs } from "@/lib/utils";
import { stageLabel, formatElapsed, useNow } from "@/lib/pipelineStages";

interface Props {
  docId: number;
}

/** Header-bar pill that replaces the Reprocess button while a document is
 * in the pipeline. Shows either live progress (when this doc is the active
 * job) or its position in the queue (when it's still waiting). Falls back
 * to a generic "Queued" pill until pipeline-status arrives from the server.
 */
export default function DocumentQueueStatus({ docId }: Props) {
  const { status } = usePipelineStatus();

  const current = status?.current_job;
  const queued = status?.queued_jobs ?? [];

  if (current?.doc_id === docId) {
    const stage = stageLabel(current.stage);
    const page =
      current.page_total && current.page_current != null
        ? `page ${current.page_current}/${current.page_total}`
        : null;
    const detail = [stage, page].filter(Boolean).join(" · ");
    return (
      <PillTooltip
        content={
          <ProcessingTooltipBody
            stage={current.stage}
            pageCurrent={current.page_current}
            pageTotal={current.page_total}
            startedAt={current.started_at}
            providers={(current.providers ?? null) as PipelineProviders | null}
            providerNames={
              (current.provider_names ?? null) as PipelineProviders | null
            }
            stageProvider={current.stage_provider ?? null}
          />
        }
      >
        <div className="flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 cursor-help">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-medium">Processing</span>
          {detail && (
            <span className="text-xs opacity-80 tabular-nums">{detail}</span>
          )}
        </div>
      </PillTooltip>
    );
  }

  const queueIndex = queued.findIndex((q) => q.doc_id === docId);
  if (queueIndex >= 0) {
    const ahead = queueIndex + (current ? 1 : 0);
    const aheadText =
      ahead === 0 ? "next up" : `${ahead} doc${ahead === 1 ? "" : "s"} ahead`;
    const aheadFilenames = [
      ...(current?.doc_id != null ? [current.filename || "(running)"] : []),
      ...queued.slice(0, queueIndex).map((q) => q.label),
    ];
    return (
      <PillTooltip
        content={
          <QueuedTooltipBody
            ahead={ahead}
            aheadFilenames={aheadFilenames}
            providers={
              (queued[queueIndex].providers ?? null) as PipelineProviders | null
            }
            providerNames={
              (queued[queueIndex].provider_names ??
                null) as PipelineProviders | null
            }
          />
        }
      >
        <div className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 cursor-help">
          <Hourglass className="h-4 w-4" />
          <span className="font-medium">Queued</span>
          <span className="text-xs opacity-80 tabular-nums">{aheadText}</span>
        </div>
      </PillTooltip>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground"
      title="Queued for processing"
    >
      <Hourglass className="h-4 w-4" />
      <span className="font-medium">Queued</span>
    </div>
  );
}

function PillTooltip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          sideOffset={6}
          className="w-72 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-overlay"
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ProcessingTooltipBody({
  stage,
  pageCurrent,
  pageTotal,
  startedAt,
  providers,
  providerNames,
  stageProvider,
}: {
  stage: string | null | undefined;
  pageCurrent: number | null | undefined;
  pageTotal: number | null | undefined;
  startedAt: string | null | undefined;
  providers: PipelineProviders | null;
  providerNames: PipelineProviders | null;
  stageProvider: string | null;
}) {
  const now = useNow(true);
  const startedMs = parseBackendTs(startedAt);
  const elapsed = startedMs ? Math.max(0, now - startedMs) : null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Processing
      </p>
      <div className="space-y-1 text-xs">
        {stage && (
          <Row label="Stage">
            <span className="font-medium text-foreground">
              {stageLabel(stage)}
            </span>
          </Row>
        )}
        {pageTotal && pageCurrent != null && (
          <Row label="Page">
            <span className="tabular-nums">
              {pageCurrent} of {pageTotal}
            </span>
          </Row>
        )}
        {elapsed != null && (
          <Row label="Elapsed">
            <span className="tabular-nums">{formatElapsed(elapsed)}</span>
          </Row>
        )}
      </div>
      {providers && (
        <ProvidersBlock
          providers={providers}
          providerNames={providerNames}
          active={stageProvider}
        />
      )}
    </div>
  );
}

function QueuedTooltipBody({
  ahead,
  aheadFilenames,
  providers,
  providerNames,
}: {
  ahead: number;
  aheadFilenames: string[];
  providers: PipelineProviders | null;
  providerNames: PipelineProviders | null;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Waiting in queue
      </p>
      <div className="space-y-1 text-xs">
        <Row label="Position">
          <span className="tabular-nums">
            {ahead === 0 ? "next up" : `${ahead} ahead`}
          </span>
        </Row>
        {aheadFilenames.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Ahead of this doc
            </p>
            <ul className="space-y-0.5 text-foreground">
              {aheadFilenames.slice(0, 5).map((f, i) => (
                <li key={i} className="truncate" title={f}>
                  {i === 0 && ahead > 0 ? "• " : "• "}
                  {f}
                </li>
              ))}
              {aheadFilenames.length > 5 && (
                <li className="text-muted-foreground">
                  + {aheadFilenames.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
      {providers && (
        <ProvidersBlock
          providers={providers}
          providerNames={providerNames}
          active={null}
        />
      )}
    </div>
  );
}

function ProvidersBlock({
  providers,
  providerNames,
  active,
}: {
  providers: PipelineProviders;
  providerNames: PipelineProviders | null;
  active: string | null;
}) {
  const entries: Array<{ family: string; id: string; label: string }> = [];
  if (providers.ocr) {
    entries.push({
      family: "OCR",
      id: providers.ocr,
      label: providerNames?.ocr || providers.ocr,
    });
  }
  if (providers.vision) {
    entries.push({
      family: "Vision",
      id: providers.vision,
      label: providerNames?.vision || providers.vision,
    });
  }
  if (providers.llm) {
    entries.push({
      family: "LLM",
      id: providers.llm,
      label: providerNames?.llm || providers.llm,
    });
  }
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1 border-t pt-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        Models
      </p>
      <div className="flex flex-wrap gap-1">
        {entries.map(({ family, id, label }) => {
          const isActive = id === active;
          const showRawId = label !== id;
          return (
            <span
              key={family}
              className={[
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]",
                isActive
                  ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                  : "border-muted bg-muted/40 text-muted-foreground",
              ].join(" ")}
              title={
                showRawId ? `${family}: ${label} (${id})` : `${family}: ${id}`
              }
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                {family}
              </span>
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
