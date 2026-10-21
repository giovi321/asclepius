import type { AxiosInstance } from "axios";

// Client-side budget for 401 / 403 / 404 responses.
//
// The public reverse proxy runs a fail2ban jail that bans an IP after 10
// responses with status 401, 403 or 404 within 2 minutes, for every site
// behind the proxy. Users sit behind shared NAT addresses, so one tab
// that keeps polling into a 4xx bans a whole household or office.
//
// Individual call sites already stop polling on these statuses; this
// budget is the backstop for any path that does not. Once
// MAX_4XX_PER_WINDOW such responses have been seen in the last
// WINDOW_MS, every further request through a guarded axios instance is
// rejected locally, without touching the network, until the window
// slides past the oldest one. The budget is shared by the admin and the
// share clients because the ban counts per IP, not per client.

export const BAN_COUNTED_STATUSES: ReadonlySet<number> = new Set([
  401, 403, 404,
]);
export const WINDOW_MS = 120_000;
// Half the proxy's threshold, leaving room for 4xx the budget cannot see
// (image tags, beacons, other tabs, other people behind the same NAT).
export const MAX_4XX_PER_WINDOW = 5;
export const BUDGET_ERROR_CODE = "ERR_CLIENT_4XX_BUDGET";

let hits: number[] = [];

function prune(now: number) {
  hits = hits.filter((t) => now - t < WINDOW_MS);
}

/** Record one 401/403/404 response. Other statuses are ignored. */
export function record4xx(status: number | undefined, now = Date.now()) {
  if (status === undefined || !BAN_COUNTED_STATUSES.has(status)) return;
  prune(now);
  hits.push(now);
}

/** True when no further request may be sent in the current window. */
export function budgetExhausted(now = Date.now()): boolean {
  prune(now);
  return hits.length >= MAX_4XX_PER_WINDOW;
}

/** Test helper: forget every recorded response. */
export function resetFourxxBudget() {
  hits = [];
}

/** True for the local rejection produced by an exhausted budget. */
export function isBudgetError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === BUDGET_ERROR_CODE;
}

/**
 * Attach the budget to an axios instance: count 401/403/404 responses
 * and refuse to send requests while the budget is exhausted.
 */
export function installFourxxGuard(instance: AxiosInstance) {
  instance.interceptors.request.use((config) => {
    if (budgetExhausted()) {
      const err = new Error(
        "Too many failed requests; paused locally to avoid an IP ban.",
      ) as Error & { code: string; config: unknown };
      err.code = BUDGET_ERROR_CODE;
      err.config = config;
      return Promise.reject(err);
    }
    return config;
  });
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      record4xx(error?.response?.status);
      return Promise.reject(error);
    },
  );
}
