import { useEffect, useRef } from "react";

/** Statuses after which a poll must never be retried. 401/403/404 are the
 * ones the public proxy's fail2ban jail counts toward an IP ban; repeating
 * them cannot succeed and gets everyone behind the same NAT banned. */
export const DEFAULT_STOP_STATUSES: readonly number[] = [401, 403, 404, 410];

export const DEFAULT_MAX_BACKOFF_MS = 120_000;

export interface PollingOptions {
  /** Delay between successful polls. */
  intervalMs: number;
  /** When false no request is made and any pending timer is cleared. */
  enabled?: boolean;
  /** Run the first poll right away instead of after one interval. */
  immediate?: boolean;
  /** HTTP statuses that stop polling for good (until the hook's deps or
   * ``enabled`` change). Defaults to 401, 403 and 404. */
  stopOn?: readonly number[];
  /** Called once when polling stops on one of ``stopOn``. */
  onStop?: (status: number, error: unknown) => void;
  /** Upper bound for the exponential backoff applied after errors. */
  maxBackoffMs?: number;
}

/** Status of an axios-style error, if any. */
export function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

/** Next delay after ``failures`` consecutive errors (0 = no error). */
export function backoffDelay(
  intervalMs: number,
  failures: number,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
): number {
  if (failures <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** failures, maxBackoffMs);
}

function pageHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/**
 * Poll ``fn`` with the rules every poll in this app must follow:
 *
 * - one request at a time (setTimeout chain, never overlapping);
 * - paused while the tab is hidden, resumed with an immediate poll when
 *   it becomes visible again;
 * - stops for good on 401/403/404 (or ``stopOn``) and reports it through
 *   ``onStop``; never retries an auth failure;
 * - exponential backoff on any other error, reset on the next success.
 *
 * ``fn`` must reject on failure (axios does) so the hook can see the
 * status. The latest ``fn`` / ``onStop`` are always used, so callers do
 * not need to memoise them.
 */
export function usePolling(
  fn: () => Promise<unknown>,
  {
    intervalMs,
    enabled = true,
    immediate = false,
    stopOn = DEFAULT_STOP_STATUSES,
    onStop,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  }: PollingOptions,
) {
  const fnRef = useRef(fn);
  const onStopRef = useRef(onStop);
  const stopOnRef = useRef(stopOn);
  fnRef.current = fn;
  onStopRef.current = onStop;
  stopOnRef.current = stopOn;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let stopped = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const schedule = (ms: number) => {
      clear();
      if (!alive || stopped || pageHidden()) return;
      timer = setTimeout(tick, ms);
    };

    const tick = async () => {
      timer = null;
      if (!alive || stopped || running) return;
      if (pageHidden()) return; // resumed by the visibility listener
      running = true;
      try {
        await fnRef.current();
        failures = 0;
      } catch (err) {
        const status = errorStatus(err);
        if (status !== undefined && stopOnRef.current.includes(status)) {
          stopped = true;
          if (alive) onStopRef.current?.(status, err);
        } else {
          failures += 1;
        }
      } finally {
        running = false;
      }
      schedule(backoffDelay(intervalMs, failures, maxBackoffMs));
    };

    const onVisibility = () => {
      if (pageHidden()) {
        clear();
      } else if (!running && timer === null) {
        schedule(0);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    schedule(immediate ? 0 : intervalMs);

    return () => {
      alive = false;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, immediate, maxBackoffMs]);
}
