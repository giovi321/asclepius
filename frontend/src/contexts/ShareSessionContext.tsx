import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import shareApi from "@/api/shareClient";
import { useTheme } from "@/hooks/useTheme";

// Idle threshold the server enforces (see ``share.idle_timeout_minutes``
// — default 10). The frontend timer is best-effort UX; the server is
// the source of truth and will reject requests after this anyway.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
// Heartbeat interval. Short enough that the server's last_seen_at stays
// fresh while the doctor reads a long PDF (which produces no API
// traffic between document loads), long enough that we are not
// burning round trips every few seconds.
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
 * Loads the share session payload (`/api/share/me`), refreshes it on
 * navigation between share pages, and pushes the doctor back to the
 * landing page if the session expires.
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
  const navigate = useNavigate();
  const location = useLocation();
  // Mounted here so the doctor surface honours light/dark on first load
  // (defaults to ``prefers-color-scheme`` since the doctor never visits
  // the admin app to set the theme manually). The hook writes the
  // ``.dark`` class on <html>; tailwind picks it up everywhere.
  const { theme, toggleTheme } = useTheme();

  const refresh = useCallback(async () => {
    try {
      const res = await shareApi.get<ShareMe>("/me");
      setMe(res.data);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // Auto-redirect to the share landing if we have no session and the
  // doctor lands on a deep link.
  useEffect(() => {
    if (loading) return;
    if (me) return;
    const path = location.pathname;
    // Already on a public share page — let it render.
    if (
      path === "/share" ||
      path === "/share/waiting" ||
      path.match(/^\/share\/[^/]+\/?$/) ||
      path.match(/^\/share\/[^/]+\/verify\/?$/)
    ) {
      return;
    }
    navigate("/share", { replace: true });
  }, [loading, me, location.pathname, navigate]);

  const logout = useCallback(async () => {
    try {
      await shareApi.post("/logout");
    } finally {
      setMe(null);
      navigate("/share", { replace: true });
    }
  }, [navigate]);

  // Lifecycle: pagehide beacon, idle timer, heartbeat.
  //
  // We arm these once the server has confirmed an active session via
  // ``/me`` (so ``me`` is populated). On a queued / unauthenticated
  // visit none of this runs.
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
    // full window we tear down the session locally and hit /logout so
    // the slot is freed for any queued waiter without waiting for the
    // server-side idle sweep.
    const idleTimer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        window.clearInterval(idleTimer);
        void (async () => {
          try {
            await shareApi.post("/logout");
          } catch {
            // best effort — the cookie clear on the server side will
            // happen on the next request anyway
          }
          setMe(null);
          navigate("/share", { replace: true });
        })();
      }
    }, 30_000);

    // Heartbeat: only fires while the page is visible AND the user has
    // been active recently. Prevents the dead-tab-keeps-session-alive
    // case (background tabs throttle but don't suspend completely).
    const heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS) return;
      shareApi.post("/heartbeat").catch(() => {
        // ignore — next /me or page action will surface auth failure
      });
    }, HEARTBEAT_MS);

    // Tab/browser close: send a logout beacon. ``sendBeacon`` is the
    // only reliable way to issue a request during ``pagehide`` —
    // regular fetch / XHR is cancelled. We send the CSRF marker as a
    // query param because Beacon cannot set custom headers; the
    // backend's logout endpoint is idempotent and tolerates it.
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
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [me, navigate]);

  return (
    <ShareSessionContext.Provider
      value={{ me, loading, refresh, logout, theme, toggleTheme }}
    >
      {children}
    </ShareSessionContext.Provider>
  );
}

export function useShareSession() {
  const ctx = useContext(ShareSessionContext);
  if (!ctx)
    throw new Error("useShareSession must be used inside ShareSessionProvider");
  return ctx;
}
