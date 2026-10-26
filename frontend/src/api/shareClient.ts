import axios from "axios";
import { installFourxxGuard } from "./fourxxBudget";

// Dedicated axios instance for the doctor-share surface.
//
// Separate from the regular `client.ts` because:
// - the share session uses a *different* cookie (`asclepius_share`) on a
//   different path scope (`/api/share`), so we never want a regular login
//   cookie to ride along on these requests, and vice versa.
// - the 401 redirect target is different — share 401s should drop the
//   doctor back at the share landing page (where they can re-OTP), not at
//   the admin login page they don't have credentials for.
//
// `withCredentials` is still required so the browser includes the share
// cookie. `X-Requested-With` is required by the backend CSRF middleware
// once a share session exists.
const shareApi = axios.create({
  baseURL: "/api/share",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
});

// We deliberately do NOT do a window.location redirect on 401 here.
// An earlier version did `window.location.href = "/share/{firstSegment}"`
// which on the landing page (/share/{token}) redirects to the same URL
// we're already on, producing an infinite refresh loop.
//
// Instead, a 401 or 403 from any session-bound endpoint marks the share
// session as ended for the rest of this page load. From then on every
// session-bound request is rejected locally (it never reaches the
// network), and the ShareSessionProvider, subscribed via
// ``onShareSessionEnded``, swaps the UI to the "session ended" screen.
// This is what stops a forgotten tab from polling into 401s: the public
// proxy's fail2ban jail bans the IP after 10 of them in 2 minutes.
//
// The flag lives in module state, so the hard navigation that follows a
// successful OTP verify or queue claim starts with a clean slate.

/** Endpoints that work without a share session (OTP bootstrap, queue,
 * logout, heartbeat). A 401/403 from these says nothing about an
 * existing session, and they must keep working after it ends so the
 * doctor can request a fresh code. */
const PUBLIC_PATH =
  /^\/?(?:[^/]+\/(?:info|request-otp|verify-otp)|claim|queue|logout|heartbeat)\/?$/;

export function isSessionBoundUrl(url: string | undefined): boolean {
  if (!url) return true;
  const path = url.split("?")[0].replace(/^\/api\/share/, "");
  return !PUBLIC_PATH.test(path);
}

export const SHARE_SESSION_ENDED_CODE = "ERR_SHARE_SESSION_ENDED";

export type ShareEndReason =
  | "unauthorized"
  | "expired"
  | "idle"
  | "logged_out"
  | "replaced";

let endedReason: ShareEndReason | null = null;
const listeners = new Set<(reason: ShareEndReason) => void>();

/** Mark the share session as ended and notify subscribers (first call wins). */
export function markShareSessionEnded(reason: ShareEndReason) {
  if (endedReason !== null) return;
  endedReason = reason;
  listeners.forEach((fn) => fn(reason));
}

export function shareSessionEndedReason(): ShareEndReason | null {
  return endedReason;
}

/** Subscribe to the session-ended signal. Returns the unsubscribe. */
export function onShareSessionEnded(fn: (reason: ShareEndReason) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test helper: forget the ended state. */
export function resetShareSessionEnded() {
  endedReason = null;
}

shareApi.interceptors.request.use((config) => {
  if (endedReason !== null && isSessionBoundUrl(config.url)) {
    const err = new Error("Share session has ended") as Error & {
      code: string;
      config: unknown;
    };
    err.code = SHARE_SESSION_ENDED_CODE;
    err.config = config;
    return Promise.reject(err);
  }
  return config;
});

/** True when the server reports the share session as gone. It answers
 * 410 with ``X-Share-Session: ended`` (410 because the proxy's fail2ban
 * jail does not count it); 401/403 are still honoured for safety. */
export function isSessionEndedResponse(error: any): boolean {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return true;
  const header = error?.response?.headers?.["x-share-session"];
  return status === 410 && header === "ended";
}

shareApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      isSessionEndedResponse(error) &&
      isSessionBoundUrl(error?.config?.url)
    ) {
      markShareSessionEnded("unauthorized");
    }
    return Promise.reject(error);
  },
);

installFourxxGuard(shareApi);

export default shareApi;
