import React from "react";
import { ChevronDown } from "lucide-react";
import { useCollapseState } from "./useCollapseState";

export function Section({
  title,
  icon: Icon,
  children,
  sectionId,
  defaultOpen = true,
  headerExtra,
}: {
  title: string;
  icon?: any;
  children: React.ReactNode;
  /** When provided, the card becomes a collapsible disclosure and its
   * open/closed state persists to localStorage under this id. */
  sectionId?: string;
  /** Initial open state if no preference is stored. Default true. */
  defaultOpen?: boolean;
  /** Optional content rendered to the right of the title (e.g. count
   * badge, model chip). Click events stop propagation so it doesn't
   * toggle the section. */
  headerExtra?: React.ReactNode;
}) {
  const [open, setOpen] = useCollapseState(sectionId, defaultOpen);
  if (!sectionId) {
    return (
      <div className="rounded-lg border p-4">
        <h3 className="mb-3 flex items-center gap-2 font-medium">
          {Icon && <Icon className="h-4 w-4" />}
          {title}
        </h3>
        <div className="space-y-2">{children}</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 hover:bg-accent/50"
      >
        <h3 className="flex items-center gap-2 font-medium">
          {Icon && <Icon className="h-4 w-4" />}
          {title}
        </h3>
        <span className="flex items-center gap-2">
          {headerExtra && (
            <span onClick={(e) => e.stopPropagation()}>{headerExtra}</span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
        </span>
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  );
}
