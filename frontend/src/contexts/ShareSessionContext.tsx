import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { useLocation } from "react-router-dom";
import shareApi, {
  markShareSessionEnded,
  onShareSessionEnded,
  shareSessionEndedReason,
  type ShareEndReason,
} from "@/api/shareClient";
import { useTheme } from "@/hooks/useTheme";
import ShareSessionEnded from "@/pages/share/ShareSessionEnded";

// Idle threshold the server enforces (see ``share.idle_timeout_minutes``
// — default 10). The frontend timer is best-effort UX; the server is
// the source of truth and will reject requests after this anyway.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
// Heartbeat interval. Short enough that the server's last_seen_at stays
// fresh while the doctor reads a long PDF (which produces no API
// traffic between document loads), long enough that we are not
// burning round trips every few seconds. The heartbeat also reports
// when the server has ended the session (revoked, idle-swept, TTL) as a
// 200 ``{active: false}``, so the page learns about it without a 4xx.
const HEARTBEAT_MS = 60 * 1000;
const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
];

interface ShareDocument {
  id: number;
  doc_type: string | null;
  event_date: string | null;
  issued_date: string | null;
  summary_en: string | null;
  summary_original: string | null;
  doctor_name: string | null;
  facility_name: string | null;
  specialty_display: string | null;
  language_source: string | null;
  page_count: number | null;
  original_filename: string | null;
}

interface ShareTranslateLimit {
  per_share_per_hour: number;
  used_in_last_hour: number;
  remaining_in_last_hour: number;
  debounce_seconds_remaining: number;
}

export interface ShareMe {
  recipient_label: string;
  patient_name: string;
  share_expires_at: string;
  session_expires_at: string;
  documents: ShareDocument[];
  translate_rate_limit: ShareTranslateLimit;
  default_translation_language: string;
  allowed_translation_languages: string[];
}

interface ShareSessionContextType {
  me: ShareMe | null;
  loading: boolean;
  /** Why the session ended, or null while it is (or may be) active. */
  ended: ShareEndReason | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Theme controls re-exported from useTheme so share pages can read
   * + flip the theme without separately invoking the hook (which would
   * race with the provider's instance and lose state). */
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const ShareSessionContext = createContext<ShareSessionContextType | null>(null);

/**
 * Pages that need a live share session. Everything else under /share
 * (landing ``/share/:token``, ``/share/:token/verify``, ``/share/waiting``,
 * the bare ``/share``) works without one and must not call ``/me``: a
 * doctor opening the link has no session yet, so ``/me`` would only add
 * a 401 toward the proxy's fail2ban threshold.
 */
function isSessionPath(path: string): boolean {
  return (
    /^\/share\/dashboard\/?$/.test(path) ||
    /^\/share\/documents\/[^/]+\/?$/.test(path)
  );
}

function parseUtc(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Loads the share session payload (`/api/share/me`) on session pages and
 * owns the session lifecycle: heartbeat, idle logout, local expiry, and
 * the "session ended" screen.
 *
 * Once the session ends (401/403 from any session endpoint, heartbeat
 * reporting it inactive, TTL reached, idle timeout, or logout) no
 * further session request leaves this page load: the share client
 * rejects them locally and session pages are replaced by the ended
 * screen. Nothing is retried.
 *
 * Mounted only inside the `/share/*` route subtree — the regular admin
 * AuthContext is never instantiated for the doctor surface, and vice
 * versa, so the two namespaces stay isolated.
 */
export function ShareSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [me, setMe] = useState<ShareMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ended, setEnded] = useState<ShareEndReason | null>(() =>
    shareSessionEndedReason(),
  );
  const location = useLocation();
  const onSessionPath = isSessionPath(location.pathname);
  // Mounted here so the doctor surface honours light/dark on first load
  // (defaults to ``prefers-color-scheme`` since the doctor never visits
  // the admin app to set the theme manually). The hook writes the
  // ``.dark`` class on <html>; tailwind picks it up everywhere.
  const { theme, toggleTheme } = useTheme();

  useEffect(
    () =>
      onShareSessionEnded((reason) => {
        setEnded(reason);
        setMe(null);
      }),
    [],
  );

  const refresh = useCallback(async () => {
    if (shareSessionEndedReason() !== null) return;
    try {
      const res = await shareApi.get<ShareMe>("/me");
      setMe(res.data);
      setLoadFailed(false);
    } catch (err: any) {
      setMe(null);
      // 401/403 already flipped the ended state via the client
      // interceptor. Anything else (network, 5xx) gets a manual retry
      // button; it is never retried automatically.
      const status = err?.response?.status;
      if (status !== 401 && status !== 403) setLoadFailed(true);
    }
  }, []);

  // Load /me once, the first time a session page is shown.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (!onSessionPath) {
      if (!requestedRef.current) setLoading(false);
      return;
    }
    if (requestedRef.current) return;
    requestedRef.current = true;
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [onSessionPath, refresh]);

  const logout = useCallback(async () => {
    try {
      await shareApi.post("/logout");
    } catch {
      // best effort; the session is over for this page either way
    } finally {
      markShareSessionEnded("logged_out");
    }
  }, []);

  // Lifecycle: pagehide beacon, idle timer, heartbeat, local expiry.
  //
  // Armed once the server has confirmed an active session via ``/me``
  // (so ``me`` is populated). On a queued / unauthenticated visit none
  // of this runs, and all of it is torn down when the session ends
  // (``me`` is cleared).
  const lastActivityRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!me) return;

    const bumpActivity = () => {
      lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((evt) =>
      document.addEventListener(evt, bumpActivity, { passive: true }),
    );

    // Idle check: every 30s. If the user has not interacted for the
    // full window we end the session locally and hit /logout so the
    // slot is freed for any queued waiter without waiting for the
    // server-side idle sweep.
    const idleTimer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        window.clearInterval(idleTimer);
        void (async () => {
          try {
            await shareApi.post("/logout");
          } catch {
            // best effort — the server-side idle sweep frees it anyway
          }
          markShareSessionEnded("idle");
        })();
      }
    }, 30_000);

    // Heartbeat: only fires while the page is visible AND the user has
    // been active recently. Prevents the dead-tab-keeps-session-alive
    // case (background tabs throttle but don't suspend completely). The
    // endpoint never answers 4xx; ``active: false`` means the server
    // has ended the session.
    const heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS) return;
      shareApi
        .post<{ active?: boolean }>("/heartbeat")
        .then((res) => {
          if (res.data?.active === false) markShareSessionEnded("expired");
        })
        .catch(() => {
          // ignore — a network blip must not end the session
        });
    }, HEARTBEAT_MS);

    // Local expiry: end the session at its TTL (or the share's expiry,
    // whichever is first) instead of waiting for a request to 401.
    const deadlines = [
      parseUtc(me.session_expires_at),
      parseUtc(me.share_expires_at),
    ].filter((t): t is number => t !== null);
    let expiryTimer: number | null = null;
    if (deadlines.length) {
      // setTimeout overflows above ~24.8 days; the TTL is far shorter.
      const ms = Math.min(
        Math.max(0, Math.min(...deadlines) - Date.now()),
        2_147_000_000,
      );
      expiryTimer = window.setTimeout(
        () => markShareSessionEnded("expired"),
        ms,
      );
    }

    // Tab/browser close: send a logout beacon. ``sendBeacon`` is the
    // only reliable way to issue a request during ``pagehide`` —
    // regular fetch / XHR is cancelled. The backend exempts logout from
    // the CSRF header check (Beacon cannot set headers) and answers 200
    // whether or not a session exists.
    const onPageHide = () => {
      try {
        const blob = new Blob([""], { type: "text/plain" });
        navigator.sendBeacon("/api/share/logout", blob);
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) =>
        document.removeEventListener(evt, bumpActivity),
      );
      window.clearInterval(idleTimer);
      window.clearInterval(heartbeatTimer);
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [me]);

  let content: React.ReactNode = children;
  if (onSessionPath && ended) {
    content = <ShareSessionEnded reason={ended} />;
  } else if (onSessionPath && !loading && !me && loadFailed) {
    content = (
      <ShareSessionEnded
        reason={null}
        onRetry={() => {
          setLoading(true);
          void refresh().finally(() => setLoading(false));
        }}
      />
    );
  }

  return (
    <ShareSessionContext.Provider
      value={{ me, loading, ended, refresh, logout, theme, toggleTheme }}
    >
      {content}
    </ShareSessionContext.Provider>
  );
}

export function useShareSession() {
  const ctx = useContext(ShareSessionContext);
  if (!ctx)
    throw new Error("useShareSession must be used inside ShareSessionProvider");
  return ctx;
}
