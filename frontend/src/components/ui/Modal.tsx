import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModalProps {
  /** When false the modal renders nothing. */
  open: boolean;
  /** Fired on Escape, backdrop click, and the header close button. */
  onClose: () => void;
  /** Optional header title. When omitted no header chrome is rendered
   *  (so the panel can supply its own header markup). */
  title?: React.ReactNode;
  /** Body content. */
  children?: React.ReactNode;
  /** Optional footer; rendered in a bordered bar at the bottom. */
  footer?: React.ReactNode;
  /**
   * Tailwind classes for the white panel. Defaults to the most common
   * panel sizing in the codebase. Callers override to preserve the exact
   * width / max-height of the modal they're replacing.
   */
  panelClassName?: string;
  /**
   * Backdrop z-index utility class (e.g. "z-50" or "z-[80]"). Defaults to
   * "z-50". Pass the value used by the modal being migrated so stacking
   * order is unchanged.
   */
  zIndexClassName?: string;
  /**
   * Set false to keep the modal open when the backdrop is clicked
   * (bespoke modals that must only close via an explicit action).
   * Defaults to true.
   */
  closeOnBackdropClick?: boolean;
  /**
   * Set false to keep the modal open on Escape. Defaults to true.
   * Used by modals that deliberately resist casual dismissal.
   */
  closeOnEscape?: boolean;
}

const DEFAULT_PANEL =
  "w-full max-w-lg rounded-lg border bg-background shadow-xl";

/**
 * Shared modal overlay: a portal-rendered backdrop wrapping a panel.
 *
 * Consolidates the hand-rolled `fixed inset-0 ... bg-black/40` overlays
 * that were copy-pasted across the app. Behaviour matches the originals:
 * backdrop click and Escape close the modal, clicks inside the panel do
 * not (stopPropagation). The panel is auto-focused on open so keyboard
 * users land inside it, and focus is restored to the previously-focused
 * element on close.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  panelClassName,
  zIndexClassName = "z-50",
  closeOnBackdropClick = true,
  closeOnEscape = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose in a ref so the Escape listener doesn't need to
  // re-bind on every render when the caller passes an inline callback.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeOnEscape]);

  // Auto-focus the panel on open; restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-black/40 p-4",
        zIndexClassName,
      )}
      onClick={closeOnBackdropClick ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cn(panelClassName ?? DEFAULT_PANEL, "focus:outline-none")}
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-base font-semibold">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
        {footer != null && (
          <div className="flex items-center justify-end gap-2 border-t p-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
