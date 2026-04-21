import { usePipelineStatus } from "@/contexts/PipelineStatusContext";
import { FileText, Brain, Eye } from "lucide-react";

type ChipSpec = {
  key: string;
  icon: any;
  label: string;
  colorClass: string;
  // Card contents — optional so the pipeline-doc chip can skip the numeric grid.
  cardTitle: string;
  cardSubtitle?: string;
  running?: number;
  waiting?: number;
  cap?: number;
};

/** Chip strip shown in the top bar. Each chip renders only when its counter
 * is non-zero, so the bar is empty when the app is idle. Hover shows a
 * pure-CSS popover with the breakdown. */
export default function MetricsStrip() {
  const { status } = usePipelineStatus();
  if (!status) return null;

  const chips: ChipSpec[] = [];

  // Current pipeline document.
  if (status.processing) {
    const step = status.processing_step ? ` · ${status.processing_step.replace(/_/g, " ")}` : "";
    const pageInfo =
      status.processing_pages && status.processing_page_current
        ? `Page ${status.processing_page_current} of ${status.processing_pages}`
        : "";
    chips.push({
      key: "pipeline-doc",
      icon: FileText,
      label: `${status.processing}${step}`,
      cardTitle: status.processing,
      cardSubtitle: [status.processing_step?.replace(/_/g, " "), pageInfo].filter(Boolean).join(" · "),
      colorClass: "text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    });
  }

  // Per-credential LLM + Vision queues. The chip shows credential + model
  // on a single line; the hover card breaks out the counters.
  for (const q of status.llm_queues || []) {
    const modelsLabel = q.models && q.models.length > 0 ? q.models.join(", ") : q.model || "";
    const shortName = q.credential_name || q.credential_id;
    chips.push({
      key: `${q.kind}-${q.credential_id}`,
      icon: q.kind === "vision" ? Eye : Brain,
      label: modelsLabel ? `${shortName} · ${modelsLabel}` : shortName,
      cardTitle: `${shortName} · ${q.kind === "vision" ? "Vision" : "LLM"}`,
      cardSubtitle: modelsLabel || undefined,
      running: q.in_flight,
      waiting: q.waiting,
      cap: q.cap,
      colorClass:
        q.kind === "vision"
          ? "text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-300 border-purple-200 dark:border-purple-800"
          : "text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-300 border-green-200 dark:border-green-800",
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex items-center justify-end gap-2 overflow-x-auto whitespace-nowrap min-w-0 max-w-full">
      {chips.map((c, i) => {
        const Icon = c.icon;
        // Flip popover to the right edge for the last chip so it doesn't
        // spill off-screen.
        const isLast = i === chips.length - 1 && chips.length > 1;
        const alignClass = isLast ? "right-0" : "left-0";
        return (
          <div key={c.key} className="group relative">
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium max-w-[260px] ${c.colorClass}`}
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{c.label}</span>
            </div>

            {/* Hover card */}
            <div
              className={`pointer-events-none absolute ${alignClass} top-full mt-1.5 hidden group-hover:block z-30 min-w-[220px] rounded-lg border bg-popover text-popover-foreground shadow-xl`}
            >
              <div className="px-3 py-2 border-b">
                <div className="text-sm font-semibold whitespace-nowrap">{c.cardTitle}</div>
                {c.cardSubtitle && (
                  <div className="mt-0.5 text-xs text-muted-foreground break-words">
                    {c.cardSubtitle}
                  </div>
                )}
              </div>
              {typeof c.cap === "number" && (
                <div className="grid grid-cols-3 divide-x text-center">
                  <div className="px-3 py-2">
                    <div className="text-xs text-muted-foreground">Running</div>
                    <div className="text-base font-semibold tabular-nums">{c.running ?? 0}</div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs text-muted-foreground">Waiting</div>
                    <div className="text-base font-semibold tabular-nums">{c.waiting ?? 0}</div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs text-muted-foreground">Cap</div>
                    <div className="text-base font-semibold tabular-nums">{c.cap}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
