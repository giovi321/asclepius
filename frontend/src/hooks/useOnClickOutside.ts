import { useEffect, type RefObject } from "react";

/**
 * Close-on-outside-press for popovers/menus/comboboxes.
 *
 * Registers a document-level ``pointerdown`` listener that fires ``handler``
 * whenever a press lands outside ``ref``'s element (i.e. the ref exists and
 * does not contain the event target). Pointer events unify mouse and touch,
 * so a tap outside dismisses on touch devices too — ``mousedown`` only
 * covered synthesized events, which some touch interactions never emit.
 *
 * The ``enabled`` flag gates the listener: when ``false`` no listener is
 * attached at all, which matches the prior ``if (!open) return`` early-return
 * idiom (the listener is only live while the popover is open). Pass a stable
 * ``handler`` (or accept that it re-subscribes when it changes) — the effect
 * re-runs whenever ``ref``, ``handler``, or ``enabled`` change.
 *
 * ``pointerdown`` (not ``click``) is used deliberately so the popover closes
 * on press rather than release, matching the original behaviour everywhere.
 */
export function useOnClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: (event: PointerEvent) => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler(e);
      }
    };
    document.addEventListener("pointerdown", listener);
    return () => document.removeEventListener("pointerdown", listener);
  }, [ref, handler, enabled]);
}
