import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SelectionCorner,
  SelectionRect,
} from "@/hooks/useRegionSelection";

const CORNERS: {
  corner: SelectionCorner;
  className: string;
  cursor: string;
}[] = [
  { corner: "nw", className: "-left-5 -top-5", cursor: "cursor-nwse-resize" },
  { corner: "ne", className: "-right-5 -top-5", cursor: "cursor-nesw-resize" },
  { corner: "sw", className: "-left-5 -bottom-5", cursor: "cursor-nesw-resize" },
  { corner: "se", className: "-right-5 -bottom-5", cursor: "cursor-nwse-resize" },
];

export interface SelectionOverlayProps {
  /** Rect in page-wrapper-local pixels; null renders nothing. */
  rect: SelectionRect | null;
  /** Locked = awaiting confirm; shows the refinement handles. */
  locked: boolean;
  onStartResize: (corner: SelectionCorner, e: React.PointerEvent) => void;
}

/**
 * The selection rectangle + corner refinement handles, rendered inside the
 * page wrapper (position: relative). Identical on the admin and doctor
 * viewers so the region-translate interaction stays pixel-for-pixel the
 * same on both surfaces. Handles have 40px hit areas around 16px dots —
 * the first fat-finger draw is never precise.
 */
export default function SelectionOverlay({
  rect,
  locked,
  onStartResize,
}: SelectionOverlayProps) {
  if (!rect) return null;
  return (
    <div
      className={cn(
        "absolute border-2 border-warning bg-warning/15",
        !locked && "pointer-events-none",
      )}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {locked &&
        CORNERS.map(({ corner, className, cursor }) => (
          <button
            key={corner}
            type="button"
            aria-label={`Resize selection (${corner})`}
            onPointerDown={(e) => onStartResize(corner, e)}
            className={cn(
              "absolute flex h-10 w-10 touch-none items-center justify-center bg-transparent",
              className,
              cursor,
            )}
          >
            <span className="h-4 w-4 rounded-full border-2 border-warning bg-card shadow-raised" />
          </button>
        ))}
    </div>
  );
}

export interface SelectionActionBarProps {
  visible: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Floating pair near the rect (fine pointers) vs a full-width bar the
   *  viewer pins to its frame bottom (coarse pointers). */
  variant: "floating" | "bar";
  /** Floating variant: wrapper-local position below the rect. */
  position?: { left: number; top: number };
}

/** Confirm/Cancel for a locked selection. */
export function SelectionActionBar({
  visible,
  confirmLabel,
  onConfirm,
  onCancel,
  variant,
  position,
}: SelectionActionBarProps) {
  if (!visible) return null;

  if (variant === "floating") {
    return (
      <div
        className="absolute z-sticky flex gap-1"
        style={position && { left: position.left, top: position.top }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground shadow-overlay hover:bg-primary-hover"
        >
          <Check className="h-3 w-3" /> {confirmLabel}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs shadow-overlay hover:bg-accent"
        >
          <X className="h-3 w-3" /> Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-sticky flex gap-2 border-t bg-card/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
      <button
        type="button"
        onClick={onCancel}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border bg-background text-sm hover:bg-accent"
      >
        <X className="h-4 w-4" /> Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        <Check className="h-4 w-4" /> {confirmLabel}
      </button>
    </div>
  );
}
