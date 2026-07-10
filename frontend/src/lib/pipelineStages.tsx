import { useEffect, useState } from "react";
import {
  ScanText,
  Brain,
  Eye,
  FolderOutput,
  FileSearch,
  Layers,
  FileImage,
  Languages,
  type LucideIcon,
} from "lucide-react";

/**
 * Canonical pipeline-stage metadata, shared by every component that renders a
 * backend stage id.
 *
 * Before this module, three components (PipelineProgress, DocumentStageTimeline,
 * DocumentQueueStatus) each defined their own STAGE_LABELS / STAGE_ICONS maps,
 * and they DISAGREED — e.g. ``page_classification`` rendered as "Page
 * classification", "Page classification" and "Classifying" respectively. This
 * is the single source of truth, keyed by the backend stage ids defined in
 * ``backend/asclepius/pipeline/stage_events.py``. Keep it in sync with the
 * ``STAGE_*`` constants there.
 */
export interface StageMeta {
  label: string;
  icon?: LucideIcon;
}

export const STAGE_META: Record<string, StageMeta> = {
  ocr: { label: "OCR", icon: ScanText },
  vision_extraction: { label: "Vision extraction", icon: Eye },
  llm_extraction: { label: "LLM extraction", icon: Brain },
  page_classification: { label: "Page classification", icon: FileSearch },
  section_extraction: { label: "Section extraction", icon: Layers },
  organizing: { label: "Organizing", icon: FolderOutput },
  thumbnail: { label: "Thumbnail", icon: FileImage },
  cache_ocr: { label: "Cache OCR", icon: ScanText },
  translation: { label: "Translation", icon: Languages },
  region_ocr: { label: "Region OCR", icon: ScanText },
  region_translation: { label: "Region translation", icon: Languages },
  ai_edit: { label: "AI edit", icon: Brain },
};

/**
 * Human-readable label for a backend stage id. Falls back to the id with
 * underscores turned into spaces for any stage not in the map (so a freshly
 * added backend stage still renders something sensible). Returns ``""`` for
 * empty input.
 */
export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "";
  return STAGE_META[stage]?.label ?? stage.replace(/_/g, " ");
}

/**
 * Icon component for a backend stage id, or a generic fallback when the stage
 * isn't in the map.
 */
export function stageIcon(stage: string | null | undefined): LucideIcon {
  if (!stage) return FileSearch;
  return STAGE_META[stage]?.icon ?? FileSearch;
}

/**
 * Infer the flow architecture from the planned/observed stage list.
 *
 * The backend doesn't expose ``flow`` directly, but the stage list carries the
 * same information: ``vision_extraction`` only appears in the Vision-LLM flow
 * (image → text + extraction in one step); everything else uses the
 * OCR-then-LLM flow. Returns ``null`` when neither marker is present.
 */
export function flowBadge(
  stages: string[],
): { label: string; pill: string } | null {
  if (stages.includes("vision_extraction")) {
    return {
      label: "Vision-LLM",
      pill: "bg-cat-violet-soft text-cat-violet border-cat-violet/25",
    };
  }
  if (stages.includes("ocr")) {
    return {
      label: "OCR + LLM",
      pill: "bg-muted text-muted-foreground border-border",
    };
  }
  return null;
}

/**
 * Format a coarse elapsed time (in ms) for the live "running" readouts:
 * ``0s`` · ``45s`` · ``3m 20s`` · ``1h 05m``.
 */
export function formatElapsed(ms: number): string {
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

/**
 * Tick once a second while ``active`` so an elapsed-time readout stays live.
 * Returns the current ``Date.now()``; consumers re-render when it changes.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
