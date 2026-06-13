import { useEffect, type RefObject } from "react";

/**
 * Close-on-outside-click for popovers/menus/comboboxes.
 *
 * Registers a document-level ``mousedown`` listener that fires ``handler``
 * whenever a mousedown lands outside ``ref``'s element (i.e. the ref exists
 * and does not contain the event target). This is the shared replacement for
 * the ~12 inline copies of the same effect that lived across the components.
 *
 * The ``enabled`` flag gates the listener: when ``false`` no listener is
 * attached at all, which matches the prior ``if (!open) return`` early-return
 * idiom (the listener is only live while the popover is open). Pass a stable
 * ``handler`` (or accept that it re-subscribes when it changes) — the effect
 * re-runs whenever ``ref``, ``handler``, or ``enabled`` change.
 *
 * ``mousedown`` (not ``click``) is used deliberately so the popover closes on
 * press rather than release, matching the original behaviour everywhere.
 */
export function useOnClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: (event: MouseEvent) => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler(e);
      }
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, handler, enabled]);
}
