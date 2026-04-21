import { usePipelineStatus } from "@/contexts/PipelineStatusContext";
import { FileText, Brain, Eye } from "lucide-react";

/** Chip strip shown in the top bar. Each chip renders only when its counter
 * is non-zero, so the bar is empty when the app is idle. */
export default function MetricsStrip() {
  const { status } = usePipelineStatus();
  if (!status) return null;

  const chips: Array<{ key: string; icon: any; label: string; tooltip: string; colorClass?: string }> = [];

  // Current pipeline document.
  if (status.processing) {
    const step = status.processing_step ? ` · ${status.processing_step.replace(/_/g, " ")}` : "";
    const pageInfo =
      status.processing_pages && status.processing_page_current
        ? ` (page ${status.processing_page_current}/${status.processing_pages})`
        : "";
    chips.push({
      key: "pipeline-doc",
      icon: FileText,
      label: `${status.processing}${step}`,
      tooltip: `Processing ${status.processing}${step}${pageInfo}`,
      colorClass: "text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    });
  }

  // Per-credential LLM + Vision queues. Shows the model(s) currently in
  // flight so the user can still see "which model is running" even though
  // the queue itself is shared per credential.
  for (const q of status.llm_queues || []) {
    const modelsLabel = q.models && q.models.length > 0 ? q.models.join(", ") : q.model || "";
    const queued = q.waiting > 0 ? ` · ⏳${q.waiting}` : "";
    const shortName = q.credential_name || q.credential_id;
    chips.push({
      key: `${q.kind}-${q.credential_id}`,
      icon: q.kind === "vision" ? Eye : Brain,
      label: `${shortName}${modelsLabel ? " · " + modelsLabel : ""} ${q.in_flight}/${q.cap}${queued}`,
      tooltip: `${q.kind === "vision" ? "Vision" : "LLM"} · ${shortName}${modelsLabel ? " (" + modelsLabel + ")" : ""} — ${q.in_flight} concurrent, ${q.waiting} waiting, cap ${q.cap}`,
      colorClass:
        q.kind === "vision"
          ? "text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-300 border-purple-200 dark:border-purple-800"
          : "text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-300 border-green-200 dark:border-green-800",
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap overflow-x-auto">
      {chips.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.key}
            title={c.tooltip}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium max-w-[260px] ${c.colorClass || "bg-muted text-muted-foreground"}`}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{c.label}</span>
          </div>
        );
      })}
    </div>
  );
}
