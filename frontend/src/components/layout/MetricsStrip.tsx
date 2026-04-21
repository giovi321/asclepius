import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePipelineStatus } from "@/contexts/PipelineStatusContext";
import { FileText, Brain, Eye, ScanText } from "lucide-react";

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
 * is non-zero, so the bar is empty when the app is idle. The hover card is
 * portaled into <body> so it escapes the app-wide overflow-hidden wrapper
 * and never gets clipped by the header. */
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

  // Per-credential LLM / Vision / OCR queues. The chip shows credential +
  // model display-name on a single line; the hover card breaks out the
  // counters. Colour + icon mirror the kind badges on the Providers and
  // Priority tabs so the user sees the same visual language across the app.
  for (const q of status.llm_queues || []) {
    // Prefer user-chosen display names (e.g. "Chandra") over raw model ids
    // (e.g. "fredrezones55/chandra-ocr-2") — the backend enriches the snapshot.
    const displayList = (q.display_names && q.display_names.length > 0 ? q.display_names : q.models) || [];
    const modelsLabel = displayList.length > 0 ? displayList.join(", ") : (q.display_name || q.model || "");
    const shortName = q.credential_name || q.credential_id;
    const kindLabel =
      q.kind === "vision" ? "Vision-LLM" :
      q.kind === "ocr" ? "OCR" :
      "LLM";
    const icon =
      q.kind === "vision" ? Eye :
      q.kind === "ocr" ? ScanText :
      Brain;
    const colorClass =
      q.kind === "vision" ? "text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-300 border-purple-200 dark:border-purple-800" :
      q.kind === "ocr" ? "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-800" :
      "text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-300 border-green-200 dark:border-green-800";
    chips.push({
      key: `${q.kind}-${q.credential_id}`,
      icon,
      label: modelsLabel ? `${shortName} · ${modelsLabel}` : shortName,
      cardTitle: `${shortName} · ${kindLabel}`,
      cardSubtitle: modelsLabel || undefined,
      running: q.in_flight,
      waiting: q.waiting,
      cap: q.cap,
      colorClass,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex items-center justify-end gap-2 whitespace-nowrap min-w-0 max-w-full">
      {chips.map((c) => (
        <Chip key={c.key} spec={c} />
      ))}
    </div>
  );
}

function Chip({ spec }: { spec: ChipSpec }) {
  const Icon = spec.icon;
  const chipRef = useRef<HTMLDivElement>(null);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);

  const showCard = () => {
    if (chipRef.current) setHoverRect(chipRef.current.getBoundingClientRect());
  };
  const hideCard = () => setHoverRect(null);

  return (
    <>
      <div
        ref={chipRef}
        onMouseEnter={showCard}
        onMouseLeave={hideCard}
        onFocus={showCard}
        onBlur={hideCard}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium max-w-[260px] ${spec.colorClass}`}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{spec.label}</span>
      </div>

      {hoverRect && createPortal(
        <HoverCard spec={spec} rect={hoverRect} />,
        document.body,
      )}
    </>
  );
}

/** The card rendered in the body portal. Position is computed from the
 * triggering chip's bounding rect and clamped inside the viewport. */
function HoverCard({ spec, rect }: { spec: ChipSpec; rect: DOMRect }) {
  const GAP = 6;                 // distance below the chip
  const CARD_WIDTH = 240;        // wide enough for the three-column grid
  const MARGIN = 8;              // keep this much space from the viewport edge
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;

  // Prefer left-aligned with the chip; fall back to right-aligned when
  // that would spill past the viewport.
  let left = rect.left;
  if (left + CARD_WIDTH > viewportW - MARGIN) {
    left = Math.max(MARGIN, rect.right - CARD_WIDTH);
  }
  const top = rect.bottom + GAP;

  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        top,
        left,
        width: CARD_WIDTH,
        zIndex: 60,
      }}
      className="pointer-events-none rounded-lg border bg-card text-card-foreground shadow-xl"
    >
      <div className="px-3 py-2 border-b">
        <div className="text-sm font-semibold break-words">{spec.cardTitle}</div>
        {spec.cardSubtitle && (
          <div className="mt-0.5 text-xs text-muted-foreground break-words">
            {spec.cardSubtitle}
          </div>
        )}
      </div>
      {typeof spec.cap === "number" && (
        <div className="grid grid-cols-3 divide-x text-center">
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Running</div>
            <div className="text-base font-semibold tabular-nums">{spec.running ?? 0}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Waiting</div>
            <div className="text-base font-semibold tabular-nums">{spec.waiting ?? 0}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cap</div>
            <div className="text-base font-semibold tabular-nums">{spec.cap}</div>
          </div>
        </div>
      )}
    </div>
  );
}
