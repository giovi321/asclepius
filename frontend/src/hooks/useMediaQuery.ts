import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query, tear-free via useSyncExternalStore.
 *
 * Rule of thumb: prefer CSS variants (`sm:`, `md:`, `coarse:`) for styling;
 * reach for these hooks only where the React tree itself must differ between
 * form factors (e.g. Sheet vs Popover presentation).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Breakpoint flags aligned with the Tailwind scale (md=768, lg=1024). */
export function useBreakpoint(): { isMobile: boolean; isDesktop: boolean } {
  const isMobile = !useMediaQuery("(min-width: 768px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  return { isMobile, isDesktop };
}

/** True on touch-primary devices; pair with the `coarse:` Tailwind variant. */
export function usePointerCoarse(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
