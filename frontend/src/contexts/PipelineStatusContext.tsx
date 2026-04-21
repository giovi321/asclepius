import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import api from "@/api/client";
import type { PipelineStatus } from "@/types";

interface PipelineStatusCtx {
  status: PipelineStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ctx = createContext<PipelineStatusCtx>({
  status: null,
  loading: false,
  refresh: async () => {},
});

const POLL_INTERVAL_MS = 5000;

interface ProviderProps {
  children: ReactNode;
  /** Poll interval in ms. Pass 0 to disable polling. */
  pollMs?: number;
}

/** Provider that polls /api/pipeline/status once for the whole app and hands
 * the result to any component via useContext. Replaces the ad-hoc polling in
 * PipelineTab / DashboardPage / DocumentsPage / the metrics strip. */
export function PipelineStatusProvider({ children, pollMs = POLL_INTERVAL_MS }: ProviderProps) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const res = await api.get("/pipeline/status");
      if (aliveRef.current) setStatus(res.data);
    } catch {
      // Silently ignore — the UI just keeps showing the last known state.
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    if (pollMs <= 0) return () => { aliveRef.current = false; };
    const t = setInterval(refresh, pollMs);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  return (
    <ctx.Provider value={{ status, loading, refresh }}>
      {children}
    </ctx.Provider>
  );
}

export function usePipelineStatus() {
  return useContext(ctx);
}
