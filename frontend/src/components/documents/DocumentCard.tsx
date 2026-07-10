import type { PipelineStatus } from "@/types";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import { formatDocType, getBestDate } from "@/lib/utils";

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  done: "success",
  failed: "destructive",
  processing: "info",
  pending: "neutral",
  needs_review: "warning",
  cancelled: "neutral",
};

export interface DocumentCardProps {
  doc: any;
  pipeline: PipelineStatus | null;
}

/** Live per-page progress text while the pipeline is chewing on this doc,
 * mirroring what the desktop status cell shows. */
export function statusText(doc: any, pipeline: PipelineStatus | null): string {
  if (
    doc.status === "processing" &&
    pipeline?.processing_doc_id === doc.id &&
    pipeline?.processing_pages &&
    pipeline?.processing_page_current != null
  ) {
    return `${pipeline?.processing_step || "processing"} (${pipeline?.processing_page_current}/${pipeline?.processing_pages})`;
  }
  return doc.status;
}

/**
 * Phone card rendering for one document row (ResponsiveTable `renderCard`).
 * Filename + status badge, then two meta lines: type · date and
 * doctor · facility. No inline rename here — rename lives on the detail
 * page; the whole card is the tap target.
 */
export default function DocumentCard({ doc, pipeline }: DocumentCardProps) {
  const line1 = [
    doc.doc_type ? formatDocType(doc.doc_type) : null,
    getBestDate(doc) || null,
  ].filter(Boolean);
  const line2 = [doc.doctor_name, doc.facility_name].filter(Boolean);

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 min-w-0 text-sm font-medium">
          {doc.original_filename}
        </p>
        <Badge
          variant={STATUS_VARIANTS[doc.status] ?? "neutral"}
          className="shrink-0"
        >
          {statusText(doc, pipeline)}
        </Badge>
      </div>
      {line1.length > 0 && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {line1.join(" · ")}
        </p>
      )}
      {line2.length > 0 && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {line2.join(" · ")}
        </p>
      )}
    </div>
  );
}
