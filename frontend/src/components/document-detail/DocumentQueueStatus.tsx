import { Hourglass, Loader2 } from "lucide-react";
import { usePipelineStatus } from "@/contexts/PipelineStatusContext";

interface Props {
  docId: number;
}

const STAGE_LABELS: Record<string, string> = {
  ocr: "OCR",
  vision_extraction: "Vision",
  llm_extraction: "LLM",
  page_classification: "Classifying",
  section_extraction: "Sections",
  organizing: "Organizing",
  thumbnail: "Thumbnail",
  cache_ocr: "Cache OCR",
};

function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "";
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
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
      <div
        className="flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
        title="This document is currently being processed"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="font-medium">Processing</span>
        {detail && (
          <span className="text-xs opacity-80 tabular-nums">{detail}</span>
        )}
      </div>
    );
  }

  const queueIndex = queued.findIndex((q) => q.doc_id === docId);
  if (queueIndex >= 0) {
    const ahead = queueIndex + (current ? 1 : 0);
    const aheadText =
      ahead === 0 ? "next up" : `${ahead} doc${ahead === 1 ? "" : "s"} ahead`;
    return (
      <div
        className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        title="Waiting in the pipeline queue"
      >
        <Hourglass className="h-4 w-4" />
        <span className="font-medium">Queued</span>
        <span className="text-xs opacity-80 tabular-nums">{aheadText}</span>
      </div>
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
