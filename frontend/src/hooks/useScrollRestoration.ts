import { useEffect, useLayoutEffect, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Module-level so positions survive AppLayout remounts within a session.
const positions = new Map<string, number>();

/**
 * Scroll restoration for the app shell. Window-level restoration can't work
 * here — `main` is the scroll container, not the window — so we track its
 * scrollTop per history entry: back/forward (POP) restores the saved
 * position, push/replace starts at the top.
 */
export function useScrollRestoration(ref: RefObject<HTMLElement | null>) {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        positions.set(location.key, el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref, location.key]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop =
      navigationType === "POP" ? (positions.get(location.key) ?? 0) : 0;
    // Only react to history-entry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}
