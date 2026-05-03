import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import shareApi from "@/api/shareClient";
import { useTheme } from "@/hooks/useTheme";

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
