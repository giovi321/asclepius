import { useEffect, useRef, useState } from "react";
import {
  Brain,
  Check,
  Eye,
  Loader2,
  Pencil,
  ScanText,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { AttachedModel } from "./types";

export interface AttachedModelRowProps {
  model: AttachedModel;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onTest: () => Promise<{ ok: boolean; message: string }>;
}

const RESULT_VISIBLE_MS = 6000;

export default function AttachedModelRow({
  model: m,
  onToggle,
  onEdit,
  onRemove,
  onTest,
}: AttachedModelRowProps) {
  const KindIcon =
    m.kind === "vision" ? Eye : m.kind === "ocr" ? ScanText : Brain;
  // Mirrors PROVIDER_BADGE_CLASSES in lib/statusTokens.ts (llm/vision/ocr).
  const kindClass =
    m.kind === "vision"
      ? "text-cat-violet bg-cat-violet-soft"
      : m.kind === "ocr"
        ? "text-warning bg-warning-soft"
        : "text-success bg-success-soft";

  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const clearTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    },
    [],
  );

  const handleTest = async () => {
    if (testing) return;
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setResult(null);
    setTesting(true);
    try {
      const r = await onTest();
      setResult(r);
    } finally {
      setTesting(false);
      clearTimer.current = window.setTimeout(() => {
        setResult(null);
        clearTimer.current = null;
      }, RESULT_VISIBLE_MS);
    }
  };

  const showModelSubline = m.model && m.model !== m.name;

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${m.enabled ? "" : "opacity-60"}`}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${kindClass}`}
      >
        <KindIcon className="h-3 w-3" />
        {m.kind}
      </span>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm">{m.name}</div>
        {result ? (
          <div
            className={`mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
              result.ok
                ? "bg-success-soft text-success"
                : "bg-destructive-soft text-destructive"
            }`}
            title={result.message}
          >
            {result.ok ? (
              <Check className="h-3 w-3" />
            ) : (
              <X className="h-3 w-3" />
            )}
            <span className="truncate max-w-[42ch]">{result.message}</span>
          </div>
        ) : showModelSubline ? (
          <div className="truncate text-xs text-muted-foreground">
            {m.model}
          </div>
        ) : null}
      </div>
      <button
        onClick={onToggle}
        title={
          m.enabled ? "Enabled, click to disable" : "Disabled, click to enable"
        }
        aria-label={
          m.enabled ? "Enabled, click to disable" : "Disabled, click to enable"
        }
        className={`flex items-center justify-center rounded-md p-1 ${m.enabled ? "text-success" : "text-muted-foreground"} hover:bg-accent coarse:min-h-11 coarse:min-w-11`}
      >
        {m.enabled ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        onClick={handleTest}
        disabled={testing}
        title="Test connection"
        aria-label="Test connection"
        className="flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 coarse:min-h-11 coarse:min-w-11"
      >
        {testing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Zap className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        onClick={onEdit}
        title="Edit model"
        aria-label="Edit model"
        className="flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent coarse:min-h-11 coarse:min-w-11"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onRemove}
        aria-label="Remove model"
        className="flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 coarse:min-h-11 coarse:min-w-11"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
