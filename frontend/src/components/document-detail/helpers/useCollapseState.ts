import { useState } from "react";

const COLLAPSE_KEY_PREFIX = "docview.collapse.";

/** Read/write the open state for a collapsible section, keyed on
 * ``sectionId``. Falls back to ``defaultOpen`` when nothing is stored —
 * call sites pass a ``hasContent``-derived default so empty sections
 * start collapsed automatically (smart defaults). */
export function useCollapseState(
  sectionId: string | undefined,
  defaultOpen: boolean,
): readonly [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(() => {
    if (!sectionId) return defaultOpen;
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY_PREFIX + sectionId);
      if (stored === "open") return true;
      if (stored === "closed") return false;
    } catch {
      /* ignore quota / privacy mode errors */
    }
    return defaultOpen;
  });
  const update = (next: boolean) => {
    setOpen(next);
    if (sectionId) {
      try {
        localStorage.setItem(
          COLLAPSE_KEY_PREFIX + sectionId,
          next ? "open" : "closed",
        );
      } catch {
        /* ignore */
      }
    }
  };
  return [open, update] as const;
}
