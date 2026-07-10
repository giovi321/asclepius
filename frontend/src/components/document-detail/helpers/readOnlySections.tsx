import { useState } from "react";
import { ChevronRight, Eye, EyeOff, Pill, Syringe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCollapseState } from "./useCollapseState";

export function TechnicalDetails({
  ocrEngine,
  ocrConfidence,
  llmProvider,
  language,
}: {
  ocrEngine: string | null;
  ocrConfidence: number | null;
  llmProvider: string | null;
  /** Detected source language (the previously top-level "Language" row).
   * Lives inside the disclosure now so the metadata card stays focused on
   * fields the user is actually likely to edit. */
  language?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        Processing details
      </button>
      {open && (
        <div className="mt-1.5 ml-4 space-y-1 text-xs text-muted-foreground">
          {language && (
            <div className="flex justify-between">
              <span>Language</span>
              <span className="font-medium text-foreground/70">{language}</span>
            </div>
          )}
          {ocrEngine && (
            <div className="flex justify-between">
              <span>OCR Engine</span>
              <span className="font-medium text-foreground/70">
                {ocrEngine}
              </span>
            </div>
          )}
          {ocrConfidence != null && (
            <div className="flex justify-between">
              <span>OCR Confidence</span>
              <span className="font-medium text-foreground/70">
                {ocrConfidence.toFixed(2)}
              </span>
            </div>
          )}
          {llmProvider && (
            <div className="flex justify-between">
              <span>LLM Provider</span>
              <span className="font-medium text-foreground/70">
                {llmProvider}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── OcrSection (collapsible) ──────────────────────────────────

export function OcrSection({
  text,
  className,
}: {
  text: string | null;
  /** Extra classes on the card root (e.g. CSS `order-*` utilities). */
  className?: string;
}) {
  const [open, setOpen] = useCollapseState("ocr-text", false);
  if (!text) return null;
  return (
    <div className={cn("rounded-lg border", className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 hover:bg-accent/50"
      >
        <h3 className="flex items-center gap-2 font-medium">
          {open ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          OCR Text
        </h3>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Show"} ({text.length} chars)
        </span>
      </button>
      {open && (
        <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap border-t bg-muted/30 p-4 text-xs">
          {text}
        </pre>
      )}
    </div>
  );
}

// ─── TranslatedTextSection (collapsible) ───────────────────────

export function TranslatedTextSection({
  text,
  model,
  translatedAt,
}: {
  text: string | null;
  model: string | null;
  translatedAt: string | null;
}) {
  const [open, setOpen] = useCollapseState("translated-text", true);
  if (!text) return null;
  // Old rows persisted the verbose provider_label ("Display · model_id");
  // newer ones store just the model. Strip the "Display · " prefix when
  // present so the chip stays narrow and reads cleanly.
  const modelShort = model?.includes(" · ")
    ? model.split(" · ").pop() || model
    : model;
  const ts = translatedAt ? new Date(translatedAt) : null;
  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 hover:bg-accent/50"
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? (
            <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">English translation</span>
          {modelShort && (
            <span
              className="hidden truncate rounded border px-1.5 py-0 font-mono text-[10px] text-muted-foreground sm:inline-block max-w-[180px]"
              title={model || undefined}
            >
              {modelShort}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {open ? "Hide" : "Show"} · {text.length.toLocaleString()} chars
          {ts
            ? ` · ${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </span>
      </button>
      {open && (
        <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap border-t bg-muted/30 p-4 text-xs">
          {text}
        </pre>
      )}
    </div>
  );
}

// ─── getSectionTypeStyle ───────────────────────────────────────

export function getSectionTypeStyle(type: string): string {
  const styles: Record<string, string> = {
    lab_results_page:
      "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    clinical_notes:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    nursing_notes:
      "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
    vital_signs: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    consent_form:
      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    cover_page:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
    medication_chart:
      "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    operative_notes:
      "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    discharge_summary:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    imaging_report:
      "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
    correspondence:
      "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
    invoice_page:
      "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  };
  return (
    styles[type] ||
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
  );
}

// ─── MedFormBadge ──────────────────────────────────────────────

export function MedFormBadge({ form }: { form?: string }) {
  if (!form) return <span className="text-muted-foreground">{"—"}</span>;
  const lower = form.toLowerCase();
  let color = "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  let Icon: any = Pill;

  if (
    lower.includes("tablet") ||
    lower.includes("pill") ||
    lower.includes("capsule")
  ) {
    color = "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    Icon = Pill;
  } else if (
    lower.includes("inject") ||
    lower.includes("iv") ||
    lower.includes("syringe")
  ) {
    color =
      "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    Icon = Syringe;
  } else if (
    lower.includes("cream") ||
    lower.includes("ointment") ||
    lower.includes("topical")
  ) {
    color = "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
  } else if (
    lower.includes("liquid") ||
    lower.includes("syrup") ||
    lower.includes("solution")
  ) {
    color =
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
  } else if (
    lower.includes("inhaler") ||
    lower.includes("spray") ||
    lower.includes("nasal")
  ) {
    color = "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300";
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      <Icon className="h-3 w-3" />
      {form}
    </span>
  );
}
