/**
 * Semantic color classes for pipeline/queue "kinds" and provider roles.
 *
 * Single source of truth for the categorical accents used by MetricsStrip,
 * PipelineProgress, and any future queue UI. These map onto the design tokens
 * in index.css (see DESIGN.md); never hard-code raw Tailwind palette classes
 * (blue-100, purple-700, ...) for these concepts again.
 */

export const KIND_BADGE_CLASSES: Record<string, string> = {
  upload: "bg-info-soft text-info border-info/25",
  reprocess: "bg-cat-violet-soft text-cat-violet border-cat-violet/25",
  translate: "bg-cat-teal-soft text-cat-teal border-cat-teal/25",
  translate_region: "bg-cat-teal-soft text-cat-teal border-cat-teal/25",
  ai_edit: "bg-warning-soft text-warning border-warning/25",
};

export const DEFAULT_KIND_BADGE =
  "bg-muted text-muted-foreground border-border";

/** Badge classes for a pipeline job kind, with a neutral fallback. */
export function kindBadgeClasses(kind: string | null | undefined): string {
  if (!kind) return DEFAULT_KIND_BADGE;
  return KIND_BADGE_CLASSES[kind] ?? DEFAULT_KIND_BADGE;
}

/** Provider-role accents (llm / vision / ocr chips). */
export const PROVIDER_BADGE_CLASSES: Record<string, string> = {
  llm: "bg-success-soft text-success border-success/25",
  vision: "bg-cat-violet-soft text-cat-violet border-cat-violet/25",
  ocr: "bg-warning-soft text-warning border-warning/25",
};

export function providerBadgeClasses(role: string | null | undefined): string {
  if (!role) return DEFAULT_KIND_BADGE;
  return PROVIDER_BADGE_CLASSES[role] ?? DEFAULT_KIND_BADGE;
}
