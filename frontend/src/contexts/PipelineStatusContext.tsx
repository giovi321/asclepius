import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import api from "@/api/client";
import type { PipelineStatus } from "@/types";
import { usePolling } from "@/lib/polling";

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

const POLL_INTERVAL_IDLE_MS = 5000;
const POLL_INTERVAL_BUSY_MS = 1500;

interface ProviderProps {
  children: ReactNode;
  /** Poll interval in ms. Pass 0 to disable polling. When unset the provider
   * adapts: 1.5s while a file is being processed or queued, 5s when idle.
   * That shrinks the "no chip" gap during fast-burst pipelines (DICOM zips,
   * batch uploads) without hammering the server when idle. */
  pollMs?: number;
}

/** Provider that polls /api/pipeline/status once for the whole app and hands
 * the result to any component via useContext. Replaces the ad-hoc polling in
 * PipelineTab / DashboardPage / DocumentsPage / the metrics strip. */
export function PipelineStatusProvider({ children, pollMs }: ProviderProps) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Throws on failure so usePolling can see the status.
  const load = async () => {
    try {
      setLoading(true);
      const res = await api.get("/pipeline/status");
      if (aliveRef.current) setStatus(res.data);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  // Public refresh: the UI just keeps showing the last known state.
  const refresh = async () => {
    try {
      await load();
    } catch {
      // ignore
    }
  };

  // Adaptive cadence: the interval follows the last answer, so a
  // transition from busy to idle (or back) takes effect on the next
  // tick. usePolling pauses while the tab is hidden, backs off on
  // errors, and stops on 401/403/404 (logged out, or the endpoint does
  // not exist on this host): repeating those only feeds the public
  // proxy's fail2ban jail.
  const busy = !!status?.processing || (status?.queue_depth ?? 0) > 0;
  const intervalMs =
    pollMs ?? (busy ? POLL_INTERVAL_BUSY_MS : POLL_INTERVAL_IDLE_MS);
  usePolling(load, {
    intervalMs: intervalMs || POLL_INTERVAL_IDLE_MS,
    enabled: pollMs !== 0,
    immediate: true,
  });
  // With polling disabled, still load once.
  useEffect(() => {
    if (pollMs === 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  return (
    <ctx.Provider value={{ status, loading, refresh }}>{children}</ctx.Provider>
  );
}

export function usePipelineStatus() {
  return useContext(ctx);
}
