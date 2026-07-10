import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import IconButton from "@/components/ui/IconButton";

export type SheetSide = "center" | "left" | "right";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required for accessibility; hide visually with `hideTitle`. */
  title: React.ReactNode;
  hideTitle?: boolean;
  description?: React.ReactNode;
  /**
   * Presentation:
   *  - "center" (default): bottom sheet below sm, centered dialog at sm+
   *  - "left" / "right": edge drawer at every size (nav drawer, wide panels)
   */
  side?: SheetSide;
  /** Extra classes for the panel (width/height overrides, z-drawer for the
   *  nav drawer, ...). */
  contentClassName?: string;
  /** Fixed footer bar (action buttons). Body scrolls; footer stays. */
  footer?: React.ReactNode;
  /** Hide the header close button (e.g. when the footer carries Cancel). */
  hideCloseButton?: boolean;
  children?: React.ReactNode;
}

const PANEL_BASE =
  "fixed z-overlay flex flex-col border bg-card text-card-foreground shadow-floating outline-none " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-base";

const SIDE_CLASSES: Record<SheetSide, string> = {
  // Bottom sheet on phones, centered dialog from sm up.
  center: cn(
    "inset-x-0 bottom-0 max-h-[calc(100dvh-3rem)] rounded-t-xl border-b-0 pb-safe",
    "data-[state=open]:slide-in-from-bottom-1/2 data-[state=closed]:slide-out-to-bottom-1/2",
    "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg",
    "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:pb-0 sm:max-h-[85dvh]",
    "sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0",
    "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
  ),
  left: cn(
    "inset-y-0 left-0 h-dvh w-[280px] max-w-[85vw] rounded-none border-y-0 border-l-0 pl-safe",
    "data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
  ),
  right: cn(
    "inset-y-0 right-0 h-dvh w-[380px] max-w-[92vw] rounded-none border-y-0 border-r-0 pr-safe",
    "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  ),
};

/**
 * The app's one overlay primitive, built on Radix Dialog (focus trap, Esc,
 * scroll lock, backdrop for free). Presentation is CSS-driven — no JS
 * breakpoint branching — so resizing never remounts content.
 *
 * Replaces the old centered `Modal`.
 */
export default function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  description,
  side = "center",
  contentClassName,
  footer,
  hideCloseButton = false,
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-overlay bg-black/40",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-base",
          )}
        />
        <Dialog.Content
          className={cn(PANEL_BASE, SIDE_CLASSES[side], contentClassName)}
        >
          {/* Grab handle, bottom-sheet presentation only */}
          {side === "center" && (
            <div
              aria-hidden
              className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30 sm:hidden"
            />
          )}
          <div
            className={cn(
              "flex shrink-0 items-start justify-between gap-3 px-4 pt-3",
              hideTitle && !description ? "sr-only" : "pb-2",
            )}
          >
            <div className="min-w-0">
              <Dialog.Title
                className={cn(
                  "text-base font-semibold",
                  hideTitle && "sr-only",
                )}
              >
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">
                  {description}
                </Dialog.Description>
              )}
            </div>
            {!hideCloseButton && (
              <Dialog.Close asChild>
                <IconButton label="Close" size="sm" className="-mr-1">
                  <X className="h-4 w-4" />
                </IconButton>
              </Dialog.Close>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {children}
          </div>
          {footer && (
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t p-3 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
